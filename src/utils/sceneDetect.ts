import { ColorGradeConfig, MediaAsset, TimelineClip } from '../types/editor';

/**
 * Analyzes luminance & RGB balance on a media asset frame for Auto Color & Color Match.
 */
export async function analyzeMediaColorStats(
  asset: MediaAsset
): Promise<{ avgLuma: number; avgR: number; avgG: number; avgB: number; contrastSpread: number }> {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 36;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { avgLuma: 128, avgR: 128, avgG: 128, avgB: 128, contrastSpread: 50 };

  await new Promise<void>((resolve) => {
    if (asset.type === 'video') {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.muted = true;
      v.src = asset.src;
      v.onloadeddata = () => {
        v.currentTime = Math.min(0.5, asset.duration * 0.25);
      };
      v.onseeked = () => {
        ctx.drawImage(v, 0, 0, 64, 36);
        resolve();
      };
      v.onerror = () => resolve();
    } else {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = asset.src;
      img.onload = () => {
        ctx.drawImage(img, 0, 0, 64, 36);
        resolve();
      };
      img.onerror = () => resolve();
    }
  });

  const data = ctx.getImageData(0, 0, 64, 36).data;
  let sumR = 0,
    sumG = 0,
    sumB = 0,
    minL = 255,
    maxL = 0;
  const pxCount = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
  }

  const avgR = sumR / pxCount;
  const avgG = sumG / pxCount;
  const avgB = sumB / pxCount;
  const avgLuma = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
  return { avgLuma, avgR, avgG, avgB, contrastSpread: maxL - minL };
}

export async function computeAutoColorGrade(
  asset: MediaAsset,
  base: ColorGradeConfig
): Promise<Partial<ColorGradeConfig>> {
  const stats = await analyzeMediaColorStats(asset);
  const exposureDelta = Math.round(((126 - stats.avgLuma) / 128) * 32);
  const contrastDelta = stats.contrastSpread < 160 ? Math.round((180 - stats.contrastSpread) * 0.22) : 6;
  const tempShift = Math.round(((stats.avgB - stats.avgR) / 128) * 28);
  return {
    presetId: 'auto-color',
    exposure: Math.max(-40, Math.min(40, exposureDelta)),
    contrast: Math.max(-20, Math.min(45, contrastDelta)),
    temperature: Math.max(-40, Math.min(40, tempShift)),
    vibrance: Math.min(40, (base.vibrance || 0) + 14),
  };
}

export async function computeColorMatchGrade(
  sourceAsset: MediaAsset,
  referenceAsset: MediaAsset
): Promise<Partial<ColorGradeConfig>> {
  const [srcStats, refStats] = await Promise.all([
    analyzeMediaColorStats(sourceAsset),
    analyzeMediaColorStats(referenceAsset),
  ]);
  const exposure = Math.round(((refStats.avgLuma - srcStats.avgLuma) / 128) * 45);
  const tempDiff = (refStats.avgR - refStats.avgB) - (srcStats.avgR - srcStats.avgB);
  const temperature = Math.round((tempDiff / 128) * 45);
  const contrast = Math.round(((refStats.contrastSpread - srcStats.contrastSpread) / 255) * 40);

  return {
    presetId: 'color-match',
    exposure: Math.max(-50, Math.min(50, exposure)),
    temperature: Math.max(-60, Math.min(60, temperature)),
    contrast: Math.max(-40, Math.min(45, contrast)),
  };
}

/**
 * Scans a video clip via frame-by-frame canvas histogram difference to detect scene cuts.
 */
export async function detectSceneCuts(
  clip: TimelineClip,
  asset: MediaAsset,
  onProgress?: (pct: number) => void
): Promise<number[]> {
  if (asset.type !== 'video') {
    // For single still motion clips, suggest rhythmic midpoint cut if long
    if (clip.duration >= 3.5) {
      return [Number((clip.start + clip.duration * 0.5).toFixed(2))];
    }
    return [];
  }

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.src = asset.src;

  await new Promise<void>((resolve) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => resolve();
  });

  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 27;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const stepSec = Math.max(0.25, clip.duration / 24);
  const cuts: number[] = [];
  let prevFrame: Uint8ClampedArray | null = null;

  for (let offset = 0.25; offset < clip.duration - 0.25; offset += stepSec) {
    const localTime = Math.min(asset.duration - 0.05, clip.inPoint + offset * clip.speed);
    video.currentTime = localTime;
    await new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener('seeked', done);
        resolve();
      };
      video.addEventListener('seeked', done);
      setTimeout(done, 250);
    });

    ctx.drawImage(video, 0, 0, 48, 27);
    const data = ctx.getImageData(0, 0, 48, 27).data;
    if (prevFrame) {
      let diffSum = 0;
      for (let i = 0; i < data.length; i += 4) {
        diffSum +=
          Math.abs(data[i] - prevFrame[i]) +
          Math.abs(data[i + 1] - prevFrame[i + 1]) +
          Math.abs(data[i + 2] - prevFrame[i + 2]);
      }
      const meanDiff = diffSum / (48 * 27 * 3);
      if (meanDiff > 28) {
        cuts.push(Number((clip.start + offset).toFixed(2)));
      }
    }
    prevFrame = new Uint8ClampedArray(data);
    onProgress?.(Math.min(99, Math.round((offset / clip.duration) * 100)));
  }

  onProgress?.(100);
  return cuts;
}
