/**
 * Generates real playable WAV Blob URLs and waveform peaks for sample audio stems,
 * and decodes real uploaded audio/video files into normalized waveform peak arrays.
 */

function writeWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const numSamples = buffer.length;
  const dataLength = numSamples * numChannels * (bitDepth / 8);
  const arrayBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export function extractPeaksFromBuffer(buffer: AudioBuffer, targetBars = 140): number[] {
  const channel = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(channel.length / targetBars));
  const peaks: number[] = [];
  for (let i = 0; i < targetBars; i++) {
    const start = i * blockSize;
    let max = 0;
    for (let j = 0; j < blockSize && start + j < channel.length; j += Math.max(1, Math.floor(blockSize / 20))) {
      const val = Math.abs(channel[start + j]);
      if (val > max) max = val;
    }
    peaks.push(Math.min(1, Math.max(0.06, max)));
  }
  return peaks;
}

export async function generateSyntheticStem(
  kind: 'ambient' | 'pulse',
  durationSeconds = 18
): Promise<{ src: string; waveform: number[]; duration: number }> {
  const sampleRate = 22050;
  const length = Math.floor(sampleRate * durationSeconds);
  const ctx = new OfflineAudioContext(2, length, sampleRate);

  if (kind === 'ambient') {
    // Warm cinematic D minor / F major9 pad swell
    const freqs = [146.83, 220.0, 261.63, 329.63, 392.0];
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.01, 0);
    masterGain.gain.linearRampToValueAtTime(0.38, 2.5);
    masterGain.gain.setValueAtTime(0.36, durationSeconds - 3);
    masterGain.gain.linearRampToValueAtTime(0.001, durationSeconds);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, 0);
    filter.frequency.linearRampToValueAtTime(1150, durationSeconds * 0.5);
    filter.frequency.linearRampToValueAtTime(520, durationSeconds);

    filter.connect(masterGain);
    masterGain.connect(ctx.destination);

    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      osc.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(f, 0);
      osc.detune.setValueAtTime((idx - 2) * 7, 0);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.14 / freqs.length, 0);
      osc.connect(g);
      g.connect(filter);
      osc.start(0);
      osc.stop(durationSeconds);
    });
  } else {
    // Subtle documentary pulse & low percussive tick
    const bpm = 100;
    const step = 60 / bpm / 2; // eighth note
    for (let t = 0; t < durationSeconds - 0.5; t += step) {
      const beatIndex = Math.round(t / step);
      const isDownbeat = beatIndex % 4 === 0;
      const isAccent = beatIndex % 2 === 0;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isDownbeat ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(isDownbeat ? 92 : isAccent ? 185 : 320, t);
      osc.frequency.exponentialRampToValueAtTime(isDownbeat ? 42 : 95, t + 0.14);

      const peak = isDownbeat ? 0.34 : isAccent ? 0.16 : 0.08;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + (isDownbeat ? 0.25 : 0.12));

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.28);
    }
  }

  const rendered = await ctx.startRendering();
  const blob = writeWavBlob(rendered);
  const src = URL.createObjectURL(blob);
  const waveform = extractPeaksFromBuffer(rendered, 140);
  return { src, waveform, duration: durationSeconds };
}

export async function decodeWaveformFromUrl(url: string): Promise<number[]> {
  try {
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const peaks = extractPeaksFromBuffer(audioBuffer, 120);
    await ctx.close();
    return peaks;
  } catch {
    // Fallback deterministic waveform pattern if codec doesn't expose raw PCM via decodeAudioData
    return Array.from({ length: 120 }, (_, i) =>
      0.22 + 0.45 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.19))
    );
  }
}
