import { useCallback, useEffect, useRef } from 'react';
import { MediaAsset, TimelineClip, Track } from '../types/editor';
import { evaluateKeyframedValue } from '../utils/keyframes';
import { clamp } from '../utils/timecode';

interface AudioNodeEntry {
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  delay: DelayNode;
  delayGain: GainNode;
  gain: GainNode;
  panner: StereoPannerNode;
  assetSrc: string;
}

export function useAudioEngine(
  isPlaying: boolean,
  playhead: number,
  tracks: Track[],
  clips: TimelineClip[],
  assetsMap: Map<string, MediaAsset>,
  masterVolume: number
) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const analyserLRef = useRef<AnalyserNode | null>(null);
  const analyserRRef = useRef<AnalyserNode | null>(null);
  const entriesRef = useRef<Map<string, AudioNodeEntry>>(new Map());
  const timeDataLRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const timeDataRRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const ensureContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const masterGain = ctx.createGain();
      const splitter = ctx.createChannelSplitter(2);
      const analyserL = ctx.createAnalyser();
      const analyserR = ctx.createAnalyser();
      analyserL.fftSize = 256;
      analyserR.fftSize = 256;

      masterGain.connect(splitter);
      splitter.connect(analyserL, 0);
      splitter.connect(analyserR, 1);
      masterGain.connect(ctx.destination);

      audioCtxRef.current = ctx;
      masterGainRef.current = masterGain;
      analyserLRef.current = analyserL;
      analyserRRef.current = analyserR;
      timeDataLRef.current = new Uint8Array(new ArrayBuffer(analyserL.frequencyBinCount));
      timeDataRRef.current = new Uint8Array(new ArrayBuffer(analyserR.frequencyBinCount));
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  useEffect(() => {
    if (masterGainRef.current && audioCtxRef.current) {
      masterGainRef.current.gain.setTargetAtTime(
        clamp(masterVolume / 100, 0, 1.5),
        audioCtxRef.current.currentTime,
        0.02
      );
    }
  }, [masterVolume]);

  useEffect(() => {
    const anySolo = tracks.some((t) => t.type === 'audio' && t.solo);
    const trackMap = new Map(tracks.map((t) => [t.id, t]));

    if (!isPlaying) {
      for (const entry of entriesRef.current.values()) {
        if (!entry.element.paused) entry.element.pause();
      }
      return;
    }

    const ctx = ensureContext();
    const masterGain = masterGainRef.current;
    if (!masterGain) return;

    // Detect if any dialogue-categorized clip is active for Auto Ducking
    const dialogueActive = clips.some(
      (c) =>
        !c.disabled &&
        c.audio.essentialCategory === 'dialogue' &&
        playhead >= c.start &&
        playhead < c.start + c.duration
    );

    const activeIds = new Set<string>();

    for (const clip of clips) {
      if (clip.disabled || clip.audio.muted) continue;
      const asset = assetsMap.get(clip.assetId);
      if (!asset) continue;

      const isAudioBearing = clip.type === 'audio' || (clip.type === 'video' && asset.hasAudio);
      if (!isAudioBearing) continue;

      const track = trackMap.get(clip.trackId);
      if (track) {
        if (track.muted) continue;
        if (track.type === 'audio' && anySolo && !track.solo) continue;
      }

      const inRange = playhead >= clip.start && playhead < clip.start + clip.duration;
      if (!inRange) continue;

      activeIds.add(clip.id);

      let entry = entriesRef.current.get(clip.id);
      if (!entry || entry.assetSrc !== asset.src) {
        if (entry) {
          entry.element.pause();
          entry.source.disconnect();
        }
        const el = new Audio(asset.src);
        el.crossOrigin = 'anonymous';
        el.preload = 'auto';
        const source = ctx.createMediaElementSource(el);
        const eqLow = ctx.createBiquadFilter();
        eqLow.type = 'lowshelf';
        eqLow.frequency.value = 140;

        const eqMid = ctx.createBiquadFilter();
        eqMid.type = 'peaking';
        eqMid.frequency.value = 1200;
        eqMid.Q.value = 1.0;

        const eqHigh = ctx.createBiquadFilter();
        eqHigh.type = 'highshelf';
        eqHigh.frequency.value = 4800;

        const compressor = ctx.createDynamicsCompressor();
        const delay = ctx.createDelay(1.0);
        delay.delayTime.value = 0.24;
        const delayGain = ctx.createGain();
        delayGain.gain.value = 0;

        const gain = ctx.createGain();
        const panner = ctx.createStereoPanner();

        source.connect(eqLow);
        eqLow.connect(eqMid);
        eqMid.connect(eqHigh);
        eqHigh.connect(compressor);
        compressor.connect(gain);
        compressor.connect(delay);
        delay.connect(delayGain);
        delayGain.connect(gain);
        gain.connect(panner);
        panner.connect(masterGain);

        entry = {
          element: el,
          source,
          eqLow,
          eqMid,
          eqHigh,
          compressor,
          delay,
          delayGain,
          gain,
          panner,
          assetSrc: asset.src,
        };
        entriesRef.current.set(clip.id, entry);
      }

      const elapsed = playhead - clip.start;
      const remaining = clip.start + clip.duration - playhead;
      let env = 1;
      if (clip.audio.fadeIn > 0 && elapsed < clip.audio.fadeIn) {
        env *= clamp(elapsed / clip.audio.fadeIn, 0, 1);
      }
      if (clip.audio.fadeOut > 0 && remaining < clip.audio.fadeOut) {
        env *= clamp(remaining / clip.audio.fadeOut, 0, 1);
      }

      // Auto-ducking attenuation when dialogue is active
      if (dialogueActive && clip.audio.autoDuckMusic && clip.audio.essentialCategory === 'music') {
        env *= 0.32;
      }

      // Enhance Speech vocal presence curve
      const enhanceBoost = clip.audio.enhanceSpeech ? 4 : 0;
      entry.eqLow.gain.setTargetAtTime(clip.audio.eqLow - (clip.audio.enhanceSpeech ? 3 : 0), ctx.currentTime, 0.03);
      entry.eqMid.gain.setTargetAtTime(clip.audio.eqMid + enhanceBoost, ctx.currentTime, 0.03);
      entry.eqHigh.gain.setTargetAtTime(clip.audio.eqHigh + (clip.audio.enhanceSpeech ? 3.5 : 0), ctx.currentTime, 0.03);

      const compRatio = clip.audio.enhanceSpeech ? 6 : 1 + (clip.audio.compressor / 100) * 10;
      entry.compressor.ratio.setTargetAtTime(compRatio, ctx.currentTime, 0.03);
      entry.compressor.threshold.setTargetAtTime(clip.audio.enhanceSpeech || clip.audio.compressor > 10 ? -24 : 0, ctx.currentTime, 0.03);

      entry.delayGain.gain.setTargetAtTime(clamp((clip.audio.delay + clip.audio.reverb * 0.4) / 250, 0, 0.45), ctx.currentTime, 0.03);

      const kfVol = evaluateKeyframedValue(clip, 'audio.volume', elapsed, clip.audio.volume);
      const trackGain = (track?.gain ?? 100) / 100;
      const targetVol = clamp((kfVol / 100) * env * trackGain, 0, 2);

      entry.gain.gain.setTargetAtTime(targetVol, ctx.currentTime, 0.015);
      entry.panner.pan.setTargetAtTime(
        clamp((clip.audio.pan + (track?.pan ?? 0)) / 100, -1, 1),
        ctx.currentTime,
        0.02
      );

      const targetLocalTime = clamp(clip.inPoint + elapsed * clip.speed, 0, Math.max(0.05, asset.duration - 0.05));
      entry.element.playbackRate = clamp(clip.speed, 0.25, 4);

      if (Math.abs(entry.element.currentTime - targetLocalTime) > 0.2) {
        try {
          entry.element.currentTime = targetLocalTime;
        } catch {
          // ignore
        }
      }
      if (entry.element.paused) {
        entry.element.play().catch(() => {});
      }
    }

    for (const [id, entry] of entriesRef.current.entries()) {
      if (!activeIds.has(id) && !entry.element.paused) {
        entry.element.pause();
      }
    }
  }, [isPlaying, playhead, tracks, clips, assetsMap, ensureContext]);

  const getMeterLevels = useCallback((): [number, number] => {
    if (!isPlaying || !analyserLRef.current || !analyserRRef.current || !timeDataLRef.current || !timeDataRRef.current) {
      return [0, 0];
    }
    const computeRms = (analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>) => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      return clamp(Math.sqrt(sum / buf.length) * 2.4, 0, 1);
    };
    return [
      computeRms(analyserLRef.current, timeDataLRef.current),
      computeRms(analyserRRef.current, timeDataRRef.current),
    ];
  }, [isPlaying]);

  useEffect(() => {
    const entries = entriesRef.current;
    return () => {
      for (const entry of entries.values()) {
        entry.element.pause();
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  return { getMeterLevels, ensureContext };
}
