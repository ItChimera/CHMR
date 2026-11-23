/**
 * Parses standard Adobe / DaVinci .cube 3D LUT files and provides fast trilinear lookup.
 */
export interface ParsedCubeLut {
  title: string;
  size: number;
  table: Float32Array;
}

export function parseCubeLut(text: string, fallbackName = 'Custom LUT'): ParsedCubeLut {
  const lines = text.split(/\r?\n/);
  let title = fallbackName;
  let size = 0;
  const values: number[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('TITLE')) {
      title = line.replace(/^TITLE\s+/, '').replace(/^"|"$/g, '') || fallbackName;
      continue;
    }
    if (line.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(/\s+/)[1], 10) || 0;
      continue;
    }
    if (line.startsWith('DOMAIN_MIN') || line.startsWith('DOMAIN_MAX') || line.startsWith('LUT_1D_SIZE')) {
      continue;
    }
    const parts = line.split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      values.push(parts[0], parts[1], parts[2]);
    }
  }

  if (!size) {
    size = Math.round(Math.cbrt(values.length / 3)) || 2;
  }

  return {
    title,
    size,
    table: new Float32Array(values),
  };
}

export function sampleCubeLut(
  lut: { size: number; table: Float32Array },
  rNorm: number,
  gNorm: number,
  bNorm: number
): [number, number, number] {
  const s = lut.size;
  if (s < 2 || lut.table.length < s * s * s * 3) return [rNorm, gNorm, bNorm];
  const maxIdx = s - 1;
  const ri = Math.min(maxIdx, Math.max(0, Math.round(rNorm * maxIdx)));
  const gi = Math.min(maxIdx, Math.max(0, Math.round(gNorm * maxIdx)));
  const bi = Math.min(maxIdx, Math.max(0, Math.round(bNorm * maxIdx)));
  const offset = (bi * s * s + gi * s + ri) * 3;
  return [lut.table[offset], lut.table[offset + 1], lut.table[offset + 2]];
}
