export const STANDARD_FPS_OPTIONS = [
  23.976,
  24,
  25,
  29.97,
  30,
  48,
  50,
  59.94,
  60,
  90,
  120,
  144,
  240,
];

export function normalizeDetectedFps(rawFps: number): number | null {
  if (!Number.isFinite(rawFps) || rawFps < 5 || rawFps > 480) return null;

  const ntscRates = [23.976, 29.97, 59.94, 119.88];
  for (const rate of ntscRates) {
    if (Math.abs(rawFps - rate) <= 0.035) {
      return rate;
    }
  }

  const nearestInt = Math.round(rawFps);
  if (nearestInt >= 5 && Math.abs(rawFps - nearestInt) <= 0.12) {
    return nearestInt;
  }

  return Math.round(rawFps * 100) / 100;
}

export function formatFpsLabel(fps: number): string {
  const rounded = Math.round(fps * 1000) / 1000;
  return `${rounded} fps`;
}

export function buildFpsSelectOptions(currentFps: number, detectedSourceFps?: number | null): number[] {
  const set = new Set<number>(STANDARD_FPS_OPTIONS);
  if (Number.isFinite(currentFps) && currentFps > 0) set.add(currentFps);
  if (detectedSourceFps && Number.isFinite(detectedSourceFps) && detectedSourceFps > 0) {
    set.add(detectedSourceFps);
  }
  return Array.from(set).sort((a, b) => a - b);
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(bytes[offset + i]);
  }
  return out;
}

function findMp4Boxes(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number
): Array<{ type: string; payloadStart: number; end: number }> {
  const boxes: Array<{ type: string; payloadStart: number; end: number }> = [];
  let pos = start;
  let guard = 0;

  while (pos + 8 <= end && guard < 1024) {
    guard++;
    const size32 = view.getUint32(pos, false);
    const type = readAscii(bytes, pos + 4, 4);
    let headerSize = 8;
    let totalSize = size32;

    if (size32 === 1) {
      if (pos + 16 > end) break;
      const hi = view.getUint32(pos + 8, false);
      const lo = view.getUint32(pos + 12, false);
      totalSize = hi * 0x100000000 + lo;
      headerSize = 16;
    } else if (size32 === 0) {
      totalSize = end - pos;
    }

    if (!Number.isFinite(totalSize) || totalSize < headerSize || pos + totalSize > end) {
      break;
    }

    boxes.push({
      type,
      payloadStart: pos + headerSize,
      end: pos + totalSize,
    });
    pos += totalSize;
  }

  return boxes;
}

async function parseMp4VideoFps(file: File): Promise<number | null> {
  const fileSize = file.size;
  let offset = 0;
  let moovOffset = -1;
  let moovSize = 0;
  let guard = 0;

  while (offset + 8 <= fileSize && guard < 256) {
    guard++;
    const headerBuf = await file.slice(offset, Math.min(offset + 16, fileSize)).arrayBuffer();
    if (headerBuf.byteLength < 8) break;
    const hBytes = new Uint8Array(headerBuf);
    const hView = new DataView(headerBuf);

    const size32 = hView.getUint32(0, false);
    const type = readAscii(hBytes, 4, 4);
    let totalSize = size32;

    if (size32 === 1) {
      if (headerBuf.byteLength < 16) break;
      const hi = hView.getUint32(8, false);
      const lo = hView.getUint32(12, false);
      totalSize = hi * 0x100000000 + lo;
    } else if (size32 === 0) {
      totalSize = fileSize - offset;
    }

    if (!Number.isFinite(totalSize) || totalSize < 8 || offset + totalSize > fileSize) {
      break;
    }

    if (type === 'moov') {
      moovOffset = offset;
      moovSize = totalSize;
      break;
    }

    offset += totalSize;
  }

  if (moovOffset < 0 || moovSize < 16 || moovSize > 32 * 1024 * 1024) {
    return null;
  }

  const moovBuf = await file.slice(moovOffset, moovOffset + moovSize).arrayBuffer();
  const bytes = new Uint8Array(moovBuf);
  const view = new DataView(moovBuf);

  const rootBoxes = findMp4Boxes(bytes, view, 0, bytes.length);
  const moov = rootBoxes.find((b) => b.type === 'moov');
  if (!moov) return null;

  const traks = findMp4Boxes(bytes, view, moov.payloadStart, moov.end).filter((b) => b.type === 'trak');
  for (const trak of traks) {
    const mdia = findMp4Boxes(bytes, view, trak.payloadStart, trak.end).find((b) => b.type === 'mdia');
    if (!mdia) continue;
    const mdiaChildren = findMp4Boxes(bytes, view, mdia.payloadStart, mdia.end);

    const hdlr = mdiaChildren.find((b) => b.type === 'hdlr');
    if (!hdlr || hdlr.payloadStart + 12 > hdlr.end) continue;
    const handlerType = readAscii(bytes, hdlr.payloadStart + 8, 4);
    if (handlerType !== 'vide') continue;

    const mdhd = mdiaChildren.find((b) => b.type === 'mdhd');
    if (!mdhd || mdhd.payloadStart + 20 > mdhd.end) continue;
    const version = bytes[mdhd.payloadStart];
    let timescale = 0;
    let mdhdDuration = 0;
    if (version === 0 && mdhd.payloadStart + 20 <= mdhd.end) {
      timescale = view.getUint32(mdhd.payloadStart + 12, false);
      mdhdDuration = view.getUint32(mdhd.payloadStart + 16, false);
    } else if (version === 1 && mdhd.payloadStart + 32 <= mdhd.end) {
      timescale = view.getUint32(mdhd.payloadStart + 20, false);
      const hi = view.getUint32(mdhd.payloadStart + 24, false);
      const lo = view.getUint32(mdhd.payloadStart + 28, false);
      mdhdDuration = hi * 0x100000000 + lo;
    }
    if (timescale <= 0) continue;

    const minf = mdiaChildren.find((b) => b.type === 'minf');
    if (!minf) continue;
    const stbl = findMp4Boxes(bytes, view, minf.payloadStart, minf.end).find((b) => b.type === 'stbl');
    if (!stbl) continue;
    const stblChildren = findMp4Boxes(bytes, view, stbl.payloadStart, stbl.end);

    const stts = stblChildren.find((b) => b.type === 'stts');
    if (stts && stts.payloadStart + 8 <= stts.end) {
      const entryCount = view.getUint32(stts.payloadStart + 4, false);
      let totalSamples = 0;
      let totalTicks = 0;
      let cursor = stts.payloadStart + 8;
      const safeEntries = Math.min(entryCount, 200000);
      for (let i = 0; i < safeEntries && cursor + 8 <= stts.end; i++) {
        const count = view.getUint32(cursor, false);
        const delta = view.getUint32(cursor + 4, false);
        totalSamples += count;
        totalTicks += count * delta;
        cursor += 8;
      }
      if (totalSamples > 0 && totalTicks > 0) {
        const normalized = normalizeDetectedFps((totalSamples * timescale) / totalTicks);
        if (normalized) return normalized;
      }
    }

    const stsz = stblChildren.find((b) => b.type === 'stsz');
    if (stsz && stsz.payloadStart + 12 <= stsz.end && mdhdDuration > 0) {
      const sampleCount = view.getUint32(stsz.payloadStart + 8, false);
      if (sampleCount > 0) {
        const normalized = normalizeDetectedFps((sampleCount * timescale) / mdhdDuration);
        if (normalized) return normalized;
      }
    }
  }

  return null;
}

function readEbmlId(bytes: Uint8Array, pos: number, end: number): { id: number; len: number } | null {
  if (pos >= end) return null;
  const first = bytes[pos];
  if (first === 0) return null;
  let mask = 0x80;
  let len = 1;
  while (len <= 4 && (first & mask) === 0) {
    mask >>= 1;
    len++;
  }
  if (len > 4 || pos + len > end) return null;
  let id = 0;
  for (let i = 0; i < len; i++) {
    id = id * 256 + bytes[pos + i];
  }
  return { id, len };
}

function readEbmlSize(bytes: Uint8Array, pos: number, end: number): { size: number; len: number; unknown: boolean } | null {
  if (pos >= end) return null;
  const first = bytes[pos];
  if (first === 0) return null;
  let mask = 0x80;
  let len = 1;
  while (len <= 8 && (first & mask) === 0) {
    mask >>= 1;
    len++;
  }
  if (len > 8 || pos + len > end) return null;
  let size = first & ~mask;
  let allOnes = size === mask - 1;
  for (let i = 1; i < len; i++) {
    const b = bytes[pos + i];
    if (b !== 0xff) allOnes = false;
    size = size * 256 + b;
  }
  return { size, len, unknown: allOnes };
}

function readUintBe(bytes: Uint8Array, pos: number, len: number): number {
  let val = 0;
  for (let i = 0; i < len; i++) {
    val = val * 256 + bytes[pos + i];
  }
  return val;
}

function scanEbmlTrackEntries(bytes: Uint8Array, start: number, end: number): number | null {
  let pos = start;
  let guard = 0;
  while (pos < end && guard < 512) {
    guard++;
    const idInfo = readEbmlId(bytes, pos, end);
    if (!idInfo) break;
    const sizeInfo = readEbmlSize(bytes, pos + idInfo.len, end);
    if (!sizeInfo) break;
    const payloadStart = pos + idInfo.len + sizeInfo.len;
    const payloadEnd = sizeInfo.unknown ? end : Math.min(end, payloadStart + sizeInfo.size);

    // Segment (0x18538067) or Tracks (0x1654AE6B): recurse
    if (idInfo.id === 0x18538067 || idInfo.id === 0x1654ae6b) {
      const nested = scanEbmlTrackEntries(bytes, payloadStart, payloadEnd);
      if (nested !== null) return nested;
    } else if (idInfo.id === 0xae) {
      // TrackEntry
      let tPos = payloadStart;
      let trackType: number | null = null;
      let defaultDurationNs: number | null = null;
      let tGuard = 0;
      while (tPos < payloadEnd && tGuard < 128) {
        tGuard++;
        const tid = readEbmlId(bytes, tPos, payloadEnd);
        if (!tid) break;
        const tsize = readEbmlSize(bytes, tPos + tid.len, payloadEnd);
        if (!tsize) break;
        const tpStart = tPos + tid.len + tsize.len;
        const tpEnd = tsize.unknown ? payloadEnd : Math.min(payloadEnd, tpStart + tsize.size);
        if (tid.id === 0x83 && tpEnd - tpStart >= 1 && tpEnd - tpStart <= 4) {
          trackType = readUintBe(bytes, tpStart, tpEnd - tpStart);
        } else if (tid.id === 0x23e383 && tpEnd - tpStart >= 1 && tpEnd - tpStart <= 8) {
          defaultDurationNs = readUintBe(bytes, tpStart, tpEnd - tpStart);
        }
        if (tsize.unknown || tpEnd <= tPos) break;
        tPos = tpEnd;
      }
      if (trackType === 1 && defaultDurationNs && defaultDurationNs > 0) {
        const normalized = normalizeDetectedFps(1_000_000_000 / defaultDurationNs);
        if (normalized) return normalized;
      }
    }

    if (sizeInfo.unknown || payloadEnd <= pos) break;
    pos = payloadEnd;
  }
  return null;
}

async function parseWebmVideoFps(file: File): Promise<number | null> {
  const sliceSize = Math.min(file.size, 1024 * 1024);
  const buf = await file.slice(0, sliceSize).arrayBuffer();
  const bytes = new Uint8Array(buf);
  return scanEbmlTrackEntries(bytes, 0, bytes.length);
}

async function probeFpsViaVideoPlayback(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';

    type RVFCVideo = HTMLVideoElement & {
      requestVideoFrameCallback?: (
        cb: (now: number, metadata: { mediaTime: number; presentedFrames: number }) => void
      ) => number;
    };
    const rVideo = v as RVFCVideo;
    if (typeof rVideo.requestVideoFrameCallback !== 'function') {
      resolve(null);
      return;
    }

    let settled = false;
    let firstMediaTime: number | null = null;
    let firstFrames: number | null = null;
    let lastMediaTime: number | null = null;
    let lastFrames: number | null = null;

    const finish = (fps: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch {
        // ignore cleanup errors
      }
      resolve(fps);
    };

    const timeoutId = window.setTimeout(() => {
      if (
        firstMediaTime !== null &&
        lastMediaTime !== null &&
        firstFrames !== null &&
        lastFrames !== null
      ) {
        const dt = lastMediaTime - firstMediaTime;
        const df = lastFrames - firstFrames;
        if (dt > 0.05 && df >= 2) {
          finish(normalizeDetectedFps(df / dt));
          return;
        }
      }
      finish(null);
    }, 1400);

    let cbCount = 0;
    const onFrame = (_now: number, meta: { mediaTime: number; presentedFrames: number }) => {
      if (settled) return;
      cbCount++;
      // Skip the initial frame so decode warmup doesn't skew interval
      if (cbCount >= 2) {
        if (firstMediaTime === null) {
          firstMediaTime = meta.mediaTime;
          firstFrames = meta.presentedFrames;
        } else {
          lastMediaTime = meta.mediaTime;
          lastFrames = meta.presentedFrames;
          const dt = lastMediaTime - firstMediaTime;
          const df = lastFrames - (firstFrames ?? 0);
          if (df >= 12 || (dt >= 0.4 && df >= 6)) {
            finish(dt > 0 ? normalizeDetectedFps(df / dt) : null);
            return;
          }
        }
      }
      rVideo.requestVideoFrameCallback?.(onFrame);
    };

    v.onerror = () => finish(null);
    v.onloadeddata = () => {
      rVideo.requestVideoFrameCallback?.(onFrame);
      v.play().catch(() => finish(null));
    };
    v.src = url;
  });
}

export async function detectVideoFps(file: File, objectUrl: string): Promise<number | null> {
  const nameLower = file.name.toLowerCase();
  const mimeLower = file.type.toLowerCase();

  try {
    if (
      mimeLower.includes('mp4') ||
      mimeLower.includes('quicktime') ||
      nameLower.endsWith('.mp4') ||
      nameLower.endsWith('.mov') ||
      nameLower.endsWith('.m4v')
    ) {
      const mp4Fps = await parseMp4VideoFps(file);
      if (mp4Fps) return mp4Fps;
    }

    if (
      mimeLower.includes('webm') ||
      mimeLower.includes('matroska') ||
      nameLower.endsWith('.webm') ||
      nameLower.endsWith('.mkv')
    ) {
      const webmFps = await parseWebmVideoFps(file);
      if (webmFps) return webmFps;
    }
  } catch {
    // Fall back to frame callback probe below
  }

  return probeFpsViaVideoPlayback(objectUrl);
}
