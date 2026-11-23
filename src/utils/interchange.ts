import { CaptionSegment, MediaAsset, SequenceSettings, TimelineClip, Track } from '../types/editor';
import { formatTimecode } from './timecode';

function formatSrtTimestamp(sec: number): string {
  const safe = Math.max(0, sec);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe % 1) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function buildSrtContent(captions: CaptionSegment[]): string {
  return captions
    .slice()
    .sort((a, b) => a.start - b.start)
    .map(
      (cap, idx) =>
        `${idx + 1}\n${formatSrtTimestamp(cap.start)} --> ${formatSrtTimestamp(cap.end)}\n${cap.text}\n`
    )
    .join('\n');
}

export function buildEdlContent(
  sequence: SequenceSettings,
  clips: TimelineClip[]
): string {
  const lines: string[] = [
    `TITLE: ${sequence.name.toUpperCase()}`,
    `FCM: NON-DROP FRAME`,
    '',
  ];
  const vClips = clips
    .filter((c) => c.type !== 'audio')
    .slice()
    .sort((a, b) => a.start - b.start);

  vClips.forEach((c, idx) => {
    const num = String(idx + 1).padStart(3, '0');
    const reel = c.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase().padEnd(8, ' ');
    const srcIn = formatTimecode(c.inPoint, sequence.fps);
    const srcOut = formatTimecode(c.inPoint + c.duration * c.speed, sequence.fps);
    const recIn = formatTimecode(c.start, sequence.fps);
    const recOut = formatTimecode(c.start + c.duration, sequence.fps);
    const trans = c.transitionIn.type !== 'none' ? 'D    015' : 'C       ';
    lines.push(`${num}  ${reel} V     ${trans} ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    lines.push(`* FROM CLIP NAME: ${c.name}`);
    lines.push('');
  });
  return lines.join('\n');
}

export function buildXmlContent(
  sequence: SequenceSettings,
  tracks: Track[],
  clips: TimelineClip[]
): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const trackXml = tracks
    .map((tr) => {
      const trClips = clips
        .filter((c) => c.trackId === tr.id)
        .sort((a, b) => a.start - b.start)
        .map((c) => {
          const startFrame = Math.round(c.start * sequence.fps);
          const endFrame = Math.round((c.start + c.duration) * sequence.fps);
          const inFrame = Math.round(c.inPoint * sequence.fps);
          return `        <clipitem id="${esc(c.id)}">
          <name>${esc(c.name)}</name>
          <start>${startFrame}</start>
          <end>${endFrame}</end>
          <in>${inFrame}</in>
          <rate><timebase>${sequence.fps}</timebase></rate>
        </clipitem>`;
        })
        .join('\n');
      return `      <track>\n${trClips}\n      </track>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<xmeml version="4">
  <sequence>
    <name>${esc(sequence.name)}</name>
    <rate><timebase>${sequence.fps}</timebase></rate>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>${sequence.width}</width>
            <height>${sequence.height}</height>
          </samplecharacteristics>
        </format>
      </video>
${trackXml}
    </media>
  </sequence>
</xmeml>`;
}

/**
 * Renders all active audio clips within [startTime, endTime] into a stereo AudioBuffer.
 */
export async function renderAudioMixdownBuffer(
  tracks: Track[],
  clips: TimelineClip[],
  assetsMap: Map<string, MediaAsset>,
  startTime: number,
  endTime: number,
  sampleRate = 48000
): Promise<{ buffer: AudioBuffer; hasAudio: boolean }> {
  const dur = Math.max(0.5, endTime - startTime);
  const offline = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);
  const anySolo = tracks.some((t) => t.type === 'audio' && t.solo);
  const trackMap = new Map(tracks.map((t) => [t.id, t]));
  let scheduledCount = 0;

  for (const clip of clips) {
    if (clip.disabled || clip.audio.muted) continue;
    if (clip.start + clip.duration <= startTime || clip.start >= endTime) continue;

    const asset = assetsMap.get(clip.assetId);
    if (!asset) continue;
    if (clip.type !== 'audio' && !(clip.type === 'video' && asset.hasAudio)) continue;

    const track = trackMap.get(clip.trackId);
    if (track) {
      if (track.muted) continue;
      if (track.type === 'audio' && anySolo && !track.solo) continue;
    }

    try {
      const res = await fetch(asset.src);
      const arr = await res.arrayBuffer();
      const decoded = await offline.decodeAudioData(arr);

      const overlapStart = Math.max(startTime, clip.start);
      const overlapEnd = Math.min(endTime, clip.start + clip.duration);
      const outStart = Math.max(0, overlapStart - startTime);
      const sourceOffset = Math.max(0, clip.inPoint + (overlapStart - clip.start) * clip.speed);
      if (sourceOffset >= decoded.duration) continue;

      const maxSourceDur = Math.max(0.01, decoded.duration - sourceOffset);
      const sourceDur = Math.min(maxSourceDur, (overlapEnd - overlapStart) * clip.speed);
      if (sourceDur <= 0.01) continue;

      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.playbackRate.value = Math.max(0.25, Math.min(4, clip.speed));

      const gain = offline.createGain();
      const baseGain = Math.max(0, Math.min(2, (clip.audio.volume / 100) * ((track?.gain ?? 100) / 100)));
      gain.gain.setValueAtTime(baseGain, outStart);

      const clipRelStart = clip.start - startTime;
      const clipRelEnd = clip.start + clip.duration - startTime;
      if (clip.audio.fadeIn > 0 && overlapStart < clip.start + clip.audio.fadeIn) {
        gain.gain.setValueAtTime(0.001, Math.max(0, clipRelStart));
        gain.gain.linearRampToValueAtTime(baseGain, Math.max(0, clipRelStart) + clip.audio.fadeIn);
      }
      if (clip.audio.fadeOut > 0) {
        const fadeStart = Math.max(outStart, clipRelEnd - clip.audio.fadeOut);
        gain.gain.setValueAtTime(baseGain, fadeStart);
        gain.gain.linearRampToValueAtTime(0.001, Math.max(fadeStart + 0.01, clipRelEnd));
      }

      const panner = offline.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, clip.audio.pan / 100));

      src.connect(gain);
      gain.connect(panner);
      panner.connect(offline.destination);
      src.start(outStart, sourceOffset, sourceDur);
      scheduledCount++;
    } catch {
      // skip undecodable audio
    }
  }

  const buffer = await offline.startRendering();
  return { buffer, hasAudio: scheduledCount > 0 };
}

/**
 * Renders all active audio clips into a stereo WAV Blob using OfflineAudioContext.
 */
export async function renderAudioMixdownWav(
  tracks: Track[],
  clips: TimelineClip[],
  assetsMap: Map<string, MediaAsset>,
  totalDuration: number
): Promise<Blob> {
  const { buffer } = await renderAudioMixdownBuffer(tracks, clips, assetsMap, 0, Math.max(1, totalDuration), 44100);
  return encodeWavFromBuffer(buffer);
}

function encodeWavFromBuffer(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const dataLength = numSamples * numChannels * 2;
  const ab = new ArrayBuffer(44 + dataLength);
  const view = new DataView(ab);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLength, true);

  const ch0 = buffer.getChannelData(0);
  const ch1 = numChannels > 1 ? buffer.getChannelData(1) : ch0;
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s0 = Math.max(-1, Math.min(1, ch0[i]));
    const s1 = Math.max(-1, Math.min(1, ch1[i]));
    view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff, true);
    offset += 2;
    if (numChannels > 1) {
      view.setInt16(offset, s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
