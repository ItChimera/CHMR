import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import {
  CaptionSegment,
  ExportSettings,
  MediaAsset,
  SequenceSettings,
  TimelineClip,
  Track,
} from '../types/editor';
import { createMediaCache, renderSequenceFrame, syncVideoElementsForTime } from './compositor';
import {
  buildEdlContent,
  buildSrtContent,
  buildXmlContent,
  renderAudioMixdownBuffer,
  renderAudioMixdownWav,
} from './interchange';
import { clamp } from './timecode';

interface ResolvedVideoCodec {
  webcodecs: string;
  muxerCodec: 'avc' | 'vp9' | 'av1';
  config: VideoEncoderConfig;
}

interface ResolvedAudioCodec {
  webcodecs: string;
  muxerCodec: 'aac' | 'opus';
  sampleRate: number;
  bitrate: number;
}

async function resolveMp4VideoCodec(
  width: number,
  height: number,
  fps: number,
  bitrateMbps: number,
  bitrateMode: 'vbr' | 'cbr'
): Promise<ResolvedVideoCodec | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return null;
  }

  const highSpec = width * height > 1920 * 1080 || fps > 62;
  const candidates: Array<{ codec: string; muxerCodec: 'avc' | 'vp9' | 'av1' }> = highSpec
    ? [
        { codec: 'avc1.640034', muxerCodec: 'avc' },
        { codec: 'avc1.4d0034', muxerCodec: 'avc' },
        { codec: 'avc1.640033', muxerCodec: 'avc' },
        { codec: 'avc1.4d0033', muxerCodec: 'avc' },
        { codec: 'avc1.64002a', muxerCodec: 'avc' },
        { codec: 'avc1.4d002a', muxerCodec: 'avc' },
        { codec: 'avc1.42E028', muxerCodec: 'avc' },
        { codec: 'vp09.00.41.08', muxerCodec: 'vp9' },
        { codec: 'av01.0.08M.08', muxerCodec: 'av1' },
      ]
    : [
        { codec: 'avc1.64002a', muxerCodec: 'avc' },
        { codec: 'avc1.4d002a', muxerCodec: 'avc' },
        { codec: 'avc1.42E028', muxerCodec: 'avc' },
        { codec: 'avc1.42001f', muxerCodec: 'avc' },
        { codec: 'avc1.640033', muxerCodec: 'avc' },
        { codec: 'vp09.00.41.08', muxerCodec: 'vp9' },
        { codec: 'vp09.00.10.08', muxerCodec: 'vp9' },
        { codec: 'av01.0.04M.08', muxerCodec: 'av1' },
      ];

  const bitrate = Math.max(500_000, Math.round(bitrateMbps * 1_000_000));
  const preferredMode = bitrateMode === 'cbr' ? 'constant' : 'variable';

  for (const candidate of candidates) {
    const configs: VideoEncoderConfig[] = [
      {
        codec: candidate.codec,
        width,
        height,
        bitrate,
        bitrateMode: preferredMode,
        framerate: fps,
      },
      {
        codec: candidate.codec,
        width,
        height,
        bitrate,
        framerate: fps,
      },
    ];

    for (const cfg of configs) {
      try {
        const res = await VideoEncoder.isConfigSupported(cfg);
        if (res.supported) {
          return {
            webcodecs: candidate.codec,
            muxerCodec: candidate.muxerCodec,
            config: res.config ?? cfg,
          };
        }
      } catch {
        // try next candidate
      }
    }
  }

  return null;
}

async function resolveMp4AudioCodec(): Promise<ResolvedAudioCodec | null> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') {
    return null;
  }

  const candidates: ResolvedAudioCodec[] = [
    { webcodecs: 'mp4a.40.2', muxerCodec: 'aac', sampleRate: 48000, bitrate: 192_000 },
    { webcodecs: 'mp4a.40.2', muxerCodec: 'aac', sampleRate: 44100, bitrate: 192_000 },
    { webcodecs: 'mp4a.40.2', muxerCodec: 'aac', sampleRate: 48000, bitrate: 128_000 },
    { webcodecs: 'opus', muxerCodec: 'opus', sampleRate: 48000, bitrate: 160_000 },
  ];

  for (const candidate of candidates) {
    try {
      const res = await AudioEncoder.isConfigSupported({
        codec: candidate.webcodecs,
        numberOfChannels: 2,
        sampleRate: candidate.sampleRate,
        bitrate: candidate.bitrate,
      });
      if (res.supported) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}

async function exportMp4WithWebCodecs(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  targetFps: number,
  settings: ExportSettings,
  sequence: SequenceSettings,
  tracks: Track[],
  clips: TimelineClip[],
  assetsMap: Map<string, MediaAsset>,
  captions: CaptionSegment[],
  cache: ReturnType<typeof createMediaCache>,
  startTime: number,
  endTime: number,
  totalDuration: number,
  onProgress: (pct: number, currentTime: number) => void,
  signal: AbortSignal
): Promise<Blob | null> {
  const videoCodec = await resolveMp4VideoCodec(
    width,
    height,
    targetFps,
    settings.bitrateMbps,
    settings.bitrateMode
  );
  if (!videoCodec) return null;

  const audioCodec = await resolveMp4AudioCodec();
  let audioMix: { buffer: AudioBuffer; hasAudio: boolean } | null = null;
  if (audioCodec) {
    try {
      audioMix = await renderAudioMixdownBuffer(
        tracks,
        clips,
        assetsMap,
        startTime,
        endTime,
        audioCodec.sampleRate
      );
    } catch {
      audioMix = null;
    }
  }
  const includeAudio = Boolean(audioCodec && audioMix?.hasAudio);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: videoCodec.muxerCodec,
      width,
      height,
      frameRate: targetFps,
    },
    ...(includeAudio && audioCodec
      ? {
          audio: {
            codec: audioCodec.muxerCodec,
            numberOfChannels: 2,
            sampleRate: audioCodec.sampleRate,
          },
        }
      : {}),
    fastStart: 'in-memory',
  });

  let encoderError: Error | null = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });
  videoEncoder.configure(videoCodec.config);

  let audioEncoder: AudioEncoder | null = null;
  if (includeAudio && audioCodec && audioMix) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta);
      },
      error: (err) => {
        encoderError = err instanceof Error ? err : new Error(String(err));
      },
    });
    audioEncoder.configure({
      codec: audioCodec.webcodecs,
      numberOfChannels: 2,
      sampleRate: audioCodec.sampleRate,
      bitrate: audioCodec.bitrate,
    });

    const buffer = audioMix.buffer;
    const channels = Math.min(2, buffer.numberOfChannels);
    const chunkSize = 1024;
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      if (signal.aborted) {
        audioEncoder.close();
        videoEncoder.close();
        throw new Error('Export cancelled');
      }
      const frames = Math.min(chunkSize, buffer.length - offset);
      const planar = new Float32Array(frames * 2);
      const ch0 = buffer.getChannelData(0);
      const ch1 = channels > 1 ? buffer.getChannelData(1) : ch0;
      planar.set(ch0.subarray(offset, offset + frames), 0);
      planar.set(ch1.subarray(offset, offset + frames), frames);

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: audioCodec.sampleRate,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: Math.round((offset / audioCodec.sampleRate) * 1_000_000),
        data: planar,
      });
      audioEncoder.encode(audioData);
      audioData.close();
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    let rafId = 0;
    let timerId = 0;
    let stopped = false;
    const exportStartPerf = performance.now();
    const frameIntervalMs = 1000 / targetFps;
    const frameDurationUs = Math.max(1000, Math.round(1_000_000 / targetFps));
    const keyFrameEvery = Math.max(1, Math.round(targetFps * 2));
    let nextFrameTargetSec = 0;
    let nextTimerPerf = exportStartPerf;
    let encodedFrames = 0;
    let lastTsUs = -1;

    const cleanupMedia = () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
      for (const v of cache.videos.values()) v.pause();
    };

    const fail = (err: unknown) => {
      cleanupMedia();
      try {
        if (videoEncoder.state !== 'closed') videoEncoder.close();
      } catch {
        // ignore
      }
      try {
        if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
      } catch {
        // ignore
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    signal.addEventListener('abort', () => {
      fail(new Error('Export cancelled'));
    });

    const finalizeMp4 = async () => {
      cleanupMedia();
      try {
        if (encoderError) throw encoderError;
        await videoEncoder.flush();
        if (audioEncoder) {
          await audioEncoder.flush();
          if (audioEncoder.state !== 'closed') audioEncoder.close();
        }
        if (videoEncoder.state !== 'closed') videoEncoder.close();
        if (encoderError) throw encoderError;
        muxer.finalize();
        resolve(new Blob([muxer.target.buffer], { type: 'video/mp4' }));
      } catch (err) {
        fail(err);
      }
    };

    const scheduleNext = () => {
      if (stopped || signal.aborted) return;
      if (targetFps > 60) {
        nextTimerPerf += frameIntervalMs;
        const delay = Math.max(0, nextTimerPerf - performance.now());
        timerId = window.setTimeout(tick, delay);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    const tick = () => {
      if (stopped || signal.aborted) return;
      if (encoderError) {
        fail(encoderError);
        return;
      }

      const nowPerf = performance.now();
      const elapsedSec = (nowPerf - exportStartPerf) / 1000;
      const currentTimelineTime = startTime + elapsedSec;

      if (currentTimelineTime >= endTime) {
        onProgress(100, endTime);
        void finalizeMp4();
        return;
      }

      syncVideoElementsForTime(cache, clips, assetsMap, currentTimelineTime, true);

      if (encodedFrames === 0 || elapsedSec >= nextFrameTargetSec - 0.001) {
        if (videoEncoder.encodeQueueSize <= 8) {
          renderSequenceFrame(
            ctx,
            width,
            height,
            currentTimelineTime,
            tracks,
            clips,
            assetsMap,
            cache,
            sequence,
            { showSafeMargins: false, captions, isExport: true }
          );

          const rawTsUs = Math.round(elapsedSec * 1_000_000);
          const tsUs = encodedFrames === 0 ? 0 : Math.max(lastTsUs + 1000, rawTsUs);
          lastTsUs = tsUs;

          const frame = new VideoFrame(canvas, {
            timestamp: tsUs,
            duration: frameDurationUs,
          });
          try {
            videoEncoder.encode(frame, { keyFrame: encodedFrames % keyFrameEvery === 0 });
            encodedFrames++;
            nextFrameTargetSec = (Math.floor(elapsedSec * targetFps) + 1) / targetFps;
          } finally {
            frame.close();
          }
        }
      }

      const pct = clamp(((currentTimelineTime - startTime) / totalDuration) * 100, 0, 99.5);
      onProgress(pct, currentTimelineTime);
      scheduleNext();
    };

    if (targetFps > 60) {
      timerId = window.setTimeout(tick, 0);
    } else {
      rafId = requestAnimationFrame(tick);
    }
  });
}

export async function exportTimelineVideo(
  settings: ExportSettings,
  sequence: SequenceSettings,
  tracks: Track[],
  clips: TimelineClip[],
  assetsMap: Map<string, MediaAsset>,
  captions: CaptionSegment[],
  inPoint: number | null,
  outPoint: number | null,
  onProgress: (pct: number, currentTime: number) => void,
  signal: AbortSignal
): Promise<Blob> {
  // Handle non-video interchange & audio-only exports immediately
  if (settings.format === 'srt-captions') {
    onProgress(100, 0);
    return new Blob([buildSrtContent(captions)], { type: 'text/plain;charset=utf-8' });
  }
  if (settings.format === 'edl-cmx3600') {
    onProgress(100, 0);
    return new Blob([buildEdlContent(sequence, clips)], { type: 'text/plain;charset=utf-8' });
  }
  if (settings.format === 'xml-fcpxml') {
    onProgress(100, 0);
    return new Blob([buildXmlContent(sequence, tracks, clips)], { type: 'application/xml;charset=utf-8' });
  }

  const maxClipEnd = clips.reduce((acc, c) => Math.max(acc, c.start + c.duration), 0);
  const startTime = settings.range === 'in-out' && inPoint !== null ? inPoint : 0;
  const endTime =
    settings.range === 'in-out' && outPoint !== null && outPoint > startTime
      ? outPoint
      : Math.max(1, maxClipEnd);
  const totalDuration = Math.max(0.5, endTime - startTime);

  if (settings.format === 'wav-audio') {
    onProgress(45, startTime);
    const wavBlob = await renderAudioMixdownWav(tracks, clips, assetsMap, endTime);
    onProgress(100, endTime);
    return wavBlob;
  }

  const targetWidth = settings.format === 'mp4-h264' ? Math.max(2, settings.width & ~1) : settings.width;
  const targetHeight = settings.format === 'mp4-h264' ? Math.max(2, settings.height & ~1) : settings.height;

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to initialize 2D export canvas');

  const cache = createMediaCache();

  for (const clip of clips) {
    const asset = assetsMap.get(clip.assetId);
    if (!asset) continue;
    if (clip.type === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = asset.src;
      cache.images.set(asset.id, img);
    }
  }

  // PNG Frame Still Grab at current start time
  if (settings.format === 'png-frame') {
    await new Promise((r) => setTimeout(r, 150));
    renderSequenceFrame(ctx, targetWidth, targetHeight, startTime, tracks, clips, assetsMap, cache, sequence, {
      showSafeMargins: false,
      captions,
      isExport: true,
    });
    onProgress(100, startTime);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode PNG frame'));
      }, 'image/png');
    });
  }

  const targetFps = clamp(settings.fps || sequence.fps || 30, 1, 240);

  // Primary MP4 path via WebCodecs + mp4-muxer (H.264/AAC or VP9/Opus ISO BMFF)
  if (settings.format === 'mp4-h264') {
    const mp4Blob = await exportMp4WithWebCodecs(
      canvas,
      ctx,
      targetWidth,
      targetHeight,
      targetFps,
      settings,
      sequence,
      tracks,
      clips,
      assetsMap,
      captions,
      cache,
      startTime,
      endTime,
      totalDuration,
      onProgress,
      signal
    );
    if (mp4Blob) return mp4Blob;
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();
  const dest = audioCtx.createMediaStreamDestination();
  const anySolo = tracks.some((t) => t.type === 'audio' && t.solo);
  const trackMap = new Map(tracks.map((t) => [t.id, t]));

  const audioElements: Array<{
    clip: TimelineClip;
    asset: MediaAsset;
    el: HTMLAudioElement;
    gain: GainNode;
    panner: StereoPannerNode;
  }> = [];

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

    const el = new Audio(asset.src);
    el.crossOrigin = 'anonymous';
    const srcNode = audioCtx.createMediaElementSource(el);
    const gain = audioCtx.createGain();
    const panner = audioCtx.createStereoPanner();
    srcNode.connect(gain);
    gain.connect(panner);
    panner.connect(dest);
    audioElements.push({ clip, asset, el, gain, panner });
  }

  const videoStream = canvas.captureStream(targetFps);
  const videoTrack = videoStream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
  const combinedTracks = [...videoStream.getVideoTracks(), ...dest.stream.getAudioTracks()];
  const combinedStream = new MediaStream(combinedTracks);

  let mimeType: string;
  if (settings.format === 'mp4-h264') {
    const mp4Candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=h264,aac',
      'video/mp4',
    ];
    const supportedMp4 = mp4Candidates.find((m) => MediaRecorder.isTypeSupported(m));
    if (!supportedMp4) {
      audioCtx.close().catch(() => {});
      throw new Error(
        'MP4 encoding is not supported in this browser runtime. Please use Chrome, Edge, or the CHMR Desktop App, or select WebM.'
      );
    }
    mimeType = supportedMp4;
  } else {
    const mimeCandidates =
      settings.format === 'webm-vp9'
        ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        : ['video/webm;codecs=vp8,opus', 'video/webm'];
    mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
  }

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: settings.bitrateMbps * 1_000_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  return new Promise<Blob>((resolve, reject) => {
    let rafId = 0;
    let timerId = 0;
    let stopped = false;
    const exportStartPerf = performance.now();
    const frameIntervalMs = 1000 / targetFps;
    let nextFrameTargetPerf = exportStartPerf;

    const cleanup = () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
      for (const item of audioElements) item.el.pause();
      for (const v of cache.videos.values()) v.pause();
      audioCtx.close().catch(() => {});
    };

    signal.addEventListener('abort', () => {
      if (recorder.state !== 'inactive') recorder.stop();
      cleanup();
      reject(new Error('Export cancelled'));
    });

    recorder.onstop = () => {
      cleanup();
      resolve(new Blob(chunks, { type: mimeType }));
    };

    recorder.onerror = () => {
      cleanup();
      reject(new Error('MediaRecorder error during export'));
    };

    recorder.start(150);

    const scheduleNext = () => {
      if (stopped || signal.aborted) return;
      if (targetFps > 60) {
        nextFrameTargetPerf += frameIntervalMs;
        const delay = Math.max(0, nextFrameTargetPerf - performance.now());
        timerId = window.setTimeout(tick, delay);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    const tick = () => {
      if (stopped || signal.aborted) return;
      const nowPerf = performance.now();
      const elapsedSec = (nowPerf - exportStartPerf) / 1000;
      const currentTimelineTime = startTime + elapsedSec;

      if (currentTimelineTime >= endTime) {
        onProgress(100, endTime);
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }

      syncVideoElementsForTime(cache, clips, assetsMap, currentTimelineTime, true);

      for (const item of audioElements) {
        const { clip, asset, el, gain, panner } = item;
        if (currentTimelineTime >= clip.start && currentTimelineTime < clip.start + clip.duration) {
          const clipElapsed = currentTimelineTime - clip.start;
          const remaining = clip.start + clip.duration - currentTimelineTime;
          let env = 1;
          if (clip.audio.fadeIn > 0 && clipElapsed < clip.audio.fadeIn) {
            env *= clamp(clipElapsed / clip.audio.fadeIn, 0, 1);
          }
          if (clip.audio.fadeOut > 0 && remaining < clip.audio.fadeOut) {
            env *= clamp(remaining / clip.audio.fadeOut, 0, 1);
          }
          gain.gain.setValueAtTime(clamp((clip.audio.volume / 100) * env, 0, 2), audioCtx.currentTime);
          panner.pan.setValueAtTime(clamp(clip.audio.pan / 100, -1, 1), audioCtx.currentTime);
          el.playbackRate = clamp(clip.speed, 0.25, 4);
          const localTime = clamp(clip.inPoint + clipElapsed * clip.speed, 0, Math.max(0.05, asset.duration - 0.05));
          if (Math.abs(el.currentTime - localTime) > 0.22) {
            try {
              el.currentTime = localTime;
            } catch {
              // ignore
            }
          }
          if (el.paused) el.play().catch(() => {});
        } else if (!el.paused) {
          el.pause();
        }
      }

      renderSequenceFrame(
        ctx,
        targetWidth,
        targetHeight,
        currentTimelineTime,
        tracks,
        clips,
        assetsMap,
        cache,
        sequence,
        { showSafeMargins: false, captions, isExport: true }
      );
      if (typeof videoTrack?.requestFrame === 'function') {
        try {
          videoTrack.requestFrame();
        } catch {
          // ignore if track ended
        }
      }

      const pct = clamp(((currentTimelineTime - startTime) / totalDuration) * 100, 0, 99.5);
      onProgress(pct, currentTimelineTime);
      scheduleNext();
    };

    if (targetFps > 60) {
      timerId = window.setTimeout(tick, 0);
    } else {
      rafId = requestAnimationFrame(tick);
    }
  });
}
