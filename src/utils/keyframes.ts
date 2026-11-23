import { Keyframe, KeyframeEasing, KeyframeProperty, TimelineClip } from '../types/editor';

export const KEYFRAME_MATCH_TOLERANCE_SEC = 0.04;

function applyEasing(t: number, easing: KeyframeEasing): number {
  const clamped = Math.max(0, Math.min(1, t));
  switch (easing) {
    case 'ease-in':
      return clamped * clamped;
    case 'ease-out':
      return 1 - (1 - clamped) * (1 - clamped);
    case 'bezier':
      return clamped * clamped * (3 - 2 * clamped);
    default:
      return clamped;
  }
}

export function evaluateKeyframedValue(
  clip: TimelineClip,
  prop: KeyframeProperty,
  localElapsedSeconds: number,
  fallbackValue: number
): number {
  const list = clip.keyframes?.[prop];
  if (!list || list.length === 0) return fallbackValue;

  const sorted = [...list].sort((a, b) => a.time - b.time);
  if (localElapsedSeconds <= sorted[0].time) return sorted[0].value;
  if (localElapsedSeconds >= sorted[sorted.length - 1].time) {
    return sorted[sorted.length - 1].value;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const k1 = sorted[i];
    const k2 = sorted[i + 1];
    if (localElapsedSeconds >= k1.time && localElapsedSeconds <= k2.time) {
      const span = Math.max(0.0001, k2.time - k1.time);
      const t = (localElapsedSeconds - k1.time) / span;
      const eased = applyEasing(t, k2.easing || k1.easing);
      return k1.value + (k2.value - k1.value) * eased;
    }
  }
  return fallbackValue;
}

export function findKeyframeAt(
  existing: Keyframe[] | undefined,
  localTime: number,
  tolerance = KEYFRAME_MATCH_TOLERANCE_SEC
): Keyframe | undefined {
  if (!existing || existing.length === 0) return undefined;
  return existing.find((k) => Math.abs(k.time - localTime) <= tolerance);
}

export function upsertKeyframe(
  existing: Keyframe[] | undefined,
  localTime: number,
  value: number,
  easing: KeyframeEasing = 'bezier',
  tolerance = KEYFRAME_MATCH_TOLERANCE_SEC
): Keyframe[] {
  const list = existing ? [...existing] : [];
  const roundedTime = Number(Math.max(0, localTime).toFixed(3));
  const idx = list.findIndex((k) => Math.abs(k.time - roundedTime) <= tolerance);
  if (idx >= 0) {
    list[idx] = { ...list[idx], value, easing: list[idx].easing || easing };
  } else {
    list.push({
      id: `kf_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36).slice(-3)}`,
      time: roundedTime,
      value,
      easing,
    });
  }
  return list.sort((a, b) => a.time - b.time);
}

export function removeKeyframeAt(
  existing: Keyframe[] | undefined,
  localTime: number,
  tolerance = KEYFRAME_MATCH_TOLERANCE_SEC
): Keyframe[] {
  if (!existing) return [];
  return existing.filter((k) => Math.abs(k.time - localTime) > tolerance);
}

export function removeKeyframeById(
  existing: Keyframe[] | undefined,
  id: string
): Keyframe[] {
  if (!existing) return [];
  return existing.filter((k) => k.id !== id);
}

export function updateKeyframeById(
  existing: Keyframe[] | undefined,
  id: string,
  patch: Partial<Pick<Keyframe, 'time' | 'value' | 'easing'>>,
  maxTime = 3600
): Keyframe[] {
  if (!existing) return [];
  return existing
    .map((k) =>
      k.id === id
        ? {
            ...k,
            ...patch,
            time:
              patch.time !== undefined
                ? Number(Math.max(0, Math.min(maxTime, patch.time)).toFixed(3))
                : k.time,
          }
        : k
    )
    .sort((a, b) => a.time - b.time);
}

export function toggleOrUpdateKeyframe(
  existing: Keyframe[] | undefined,
  localTime: number,
  value: number,
  easing: KeyframeEasing = 'bezier'
): Keyframe[] {
  const hit = findKeyframeAt(existing, localTime);
  if (hit) {
    return removeKeyframeById(existing, hit.id);
  }
  return upsertKeyframe(existing, localTime, value, easing);
}

export function getAdjacentKeyframeTimes(
  existing: Keyframe[] | undefined,
  localTime: number,
  tolerance = KEYFRAME_MATCH_TOLERANCE_SEC
): { prevTime: number | null; nextTime: number | null } {
  if (!existing || existing.length === 0) return { prevTime: null, nextTime: null };
  const sorted = [...existing].sort((a, b) => a.time - b.time);
  let prevTime: number | null = null;
  let nextTime: number | null = null;

  for (const kf of sorted) {
    if (kf.time < localTime - tolerance) {
      prevTime = kf.time;
    } else if (kf.time > localTime + tolerance && nextTime === null) {
      nextTime = kf.time;
    }
  }
  return { prevTime, nextTime };
}
