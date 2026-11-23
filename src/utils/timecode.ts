export function formatTimecode(seconds: number, fps = 30): string {
  const safe = Math.max(0, seconds);
  const safeFps = Math.max(1, Math.round(fps));
  const totalFrames = Math.round(safe * safeFps);
  const frames = totalFrames % safeFps;
  const totalSeconds = Math.floor(totalFrames / safeFps);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hrs = Math.floor(totalSeconds / 3600);

  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const frameDigits = safeFps >= 100 ? 3 : 2;
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}:${pad(frames, frameDigits)}`;
}

export function formatShortDuration(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  if (mins > 0) {
    return `${mins}:${String(secs).padStart(2, '0')}.${tenths}s`;
  }
  return `${secs}.${tenths}s`;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function getRulerStep(pixelsPerSecond: number): { major: number; minor: number } {
  if (pixelsPerSecond >= 240) return { major: 0.5, minor: 0.1 };
  if (pixelsPerSecond >= 120) return { major: 1, minor: 0.2 };
  if (pixelsPerSecond >= 60) return { major: 2, minor: 0.5 };
  if (pixelsPerSecond >= 30) return { major: 5, minor: 1 };
  if (pixelsPerSecond >= 15) return { major: 10, minor: 2 };
  if (pixelsPerSecond >= 6) return { major: 30, minor: 5 };
  return { major: 60, minor: 10 };
}

export function generateId(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36).slice(-4)}`;
}
