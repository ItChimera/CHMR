import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Diamond,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  BlendMode,
  KeyframeEasing,
  KeyframeProperty,
  TimelineClip,
  TransformConfig,
} from '../types/editor';
import {
  evaluateKeyframedValue,
  findKeyframeAt,
  getAdjacentKeyframeTimes,
  removeKeyframeAt,
  removeKeyframeById,
  updateKeyframeById,
  upsertKeyframe,
} from '../utils/keyframes';

interface MotionKeyframePanelProps {
  clip: TimelineClip;
  playhead: number;
  onUpdateClip: (clipId: string, updater: (clip: TimelineClip) => TimelineClip) => void;
  onSeek: (time: number) => void;
  onResetMotion: () => void;
}

type TransformField = 'x' | 'y' | 'scale' | 'rotation' | 'opacity';
type MotionProp = Extract<
  KeyframeProperty,
  'transform.x' | 'transform.y' | 'transform.scale' | 'transform.rotation' | 'transform.opacity'
>;

interface MotionPropDef {
  prop: MotionProp;
  field: TransformField;
  label: string;
  shortLabel: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  color: string;
}

const MOTION_PROPS: MotionPropDef[] = [
  {
    prop: 'transform.x',
    field: 'x',
    label: 'Position X',
    shortLabel: 'Pos X',
    min: -960,
    max: 960,
    step: 2,
    unit: 'px',
    color: '#3B82F6',
  },
  {
    prop: 'transform.y',
    field: 'y',
    label: 'Position Y',
    shortLabel: 'Pos Y',
    min: -540,
    max: 540,
    step: 2,
    unit: 'px',
    color: '#60A5FA',
  },
  {
    prop: 'transform.scale',
    field: 'scale',
    label: 'Scale',
    shortLabel: 'Scale',
    min: 10,
    max: 300,
    step: 1,
    unit: '%',
    color: '#10B981',
  },
  {
    prop: 'transform.rotation',
    field: 'rotation',
    label: 'Rotation',
    shortLabel: 'Rot',
    min: -180,
    max: 180,
    step: 1,
    unit: '°',
    color: '#F59E0B',
  },
  {
    prop: 'transform.opacity',
    field: 'opacity',
    label: 'Opacity',
    shortLabel: 'Opac',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    color: '#A78BFA',
  },
];

const EASING_OPTIONS: Array<{ value: KeyframeEasing; label: string; hint: string }> = [
  { value: 'linear', label: 'Linear', hint: 'Constant speed from start to end' },
  { value: 'ease-in', label: 'Ease-In', hint: 'Starts slow, accelerates into keyframe' },
  { value: 'ease-out', label: 'Ease-Out', hint: 'Starts fast, decelerates smoothly' },
  { value: 'bezier', label: 'Bezier', hint: 'Smooth S-curve ease-in and ease-out' },
];

function InterpolationCurveIcon({ easing }: { easing: KeyframeEasing }) {
  const path =
    easing === 'linear'
      ? 'M 2 12 L 16 2'
      : easing === 'ease-in'
        ? 'M 2 12 Q 12 12 16 2'
        : easing === 'ease-out'
          ? 'M 2 12 Q 6 2 16 2'
          : 'M 2 12 C 9 12, 9 2, 16 2';
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" className="shrink-0 text-[#60A5FA]" aria-hidden="true">
      <rect x="0.5" y="0.5" width="17" height="13" rx="2" fill="#0E0E13" stroke="#272734" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function MotionKeyframePanel({
  clip,
  playhead,
  onUpdateClip,
  onSeek,
  onResetMotion,
}: MotionKeyframePanelProps) {
  const [defaultEasing, setDefaultEasing] = useState<KeyframeEasing>('bezier');
  const [selectedKf, setSelectedKf] = useState<{ prop: MotionProp; id: string } | null>(null);
  const trackAreaRef = useRef<HTMLDivElement | null>(null);

  const duration = Math.max(0.1, clip.duration);
  const rawLocal = playhead - clip.start;
  const isPlayheadInClip = rawLocal >= -0.001 && rawLocal <= duration + 0.001;
  const clipLocalTime = Number(Math.max(0, Math.min(duration, rawLocal)).toFixed(3));
  const playheadPct = (clipLocalTime / duration) * 100;

  const update = (fn: (c: TimelineClip) => TimelineClip) => {
    onUpdateClip(clip.id, fn);
  };

  const getLiveValue = (def: MotionPropDef): number => {
    const val = evaluateKeyframedValue(clip, def.prop, clipLocalTime, clip.transform[def.field]);
    return Number(val.toFixed(1));
  };

  const handlePropertyValueChange = (def: MotionPropDef, nextValue: number) => {
    const clampedVal = Math.max(def.min, Math.min(def.max, nextValue));
    update((c) => {
      const hasKfs = (c.keyframes?.[def.prop]?.length ?? 0) > 0;
      const nextTransform: TransformConfig = { ...c.transform, [def.field]: clampedVal };
      if (!hasKfs) {
        return { ...c, transform: nextTransform };
      }
      return {
        ...c,
        transform: nextTransform,
        keyframes: {
          ...c.keyframes,
          [def.prop]: upsertKeyframe(c.keyframes?.[def.prop], clipLocalTime, clampedVal, defaultEasing),
        },
      };
    });
  };

  const handleToggleKeyframe = (def: MotionPropDef) => {
    const existingList = clip.keyframes?.[def.prop];
    const hit = findKeyframeAt(existingList, clipLocalTime);
    const liveVal = getLiveValue(def);

    update((c) => {
      const list = c.keyframes?.[def.prop];
      const nextList = hit
        ? removeKeyframeAt(list, clipLocalTime)
        : upsertKeyframe(list, clipLocalTime, liveVal, defaultEasing);

      const nextKeyframes = { ...c.keyframes };
      if (nextList.length === 0) {
        delete nextKeyframes[def.prop];
      } else {
        nextKeyframes[def.prop] = nextList;
      }

      return {
        ...c,
        keyframes: Object.keys(nextKeyframes).length > 0 ? nextKeyframes : undefined,
      };
    });

    if (hit && selectedKf?.id === hit.id) {
      setSelectedKf(null);
    }
  };

  const handleKeyframeAllTransform = () => {
    update((c) => {
      const nextKeyframes = { ...c.keyframes };
      for (const def of MOTION_PROPS) {
        const val = evaluateKeyframedValue(c, def.prop, clipLocalTime, c.transform[def.field]);
        nextKeyframes[def.prop] = upsertKeyframe(
          nextKeyframes[def.prop],
          clipLocalTime,
          Number(val.toFixed(1)),
          defaultEasing
        );
      }
      return { ...c, keyframes: nextKeyframes };
    });
  };

  const handleApplyMotionPreset = (preset: 'zoom-in' | 'zoom-out' | 'slide-left' | 'spin-pop' | 'fade-io') => {
    const t0 = 0;
    const tEnd = Number(duration.toFixed(3));
    const tFadeIn = Number(Math.min(0.6, duration * 0.25).toFixed(3));
    const tFadeOut = Number(Math.max(tFadeIn + 0.1, duration - Math.min(0.6, duration * 0.25)).toFixed(3));

    update((c) => {
      const kf = { ...c.keyframes };
      if (preset === 'zoom-in') {
        kf['transform.scale'] = [
          { id: `kf_zi1_${Date.now()}`, time: t0, value: 100, easing: 'bezier' },
          { id: `kf_zi2_${Date.now()}`, time: tEnd, value: 128, easing: 'bezier' },
        ];
      } else if (preset === 'zoom-out') {
        kf['transform.scale'] = [
          { id: `kf_zo1_${Date.now()}`, time: t0, value: 128, easing: 'bezier' },
          { id: `kf_zo2_${Date.now()}`, time: tEnd, value: 100, easing: 'bezier' },
        ];
      } else if (preset === 'slide-left') {
        kf['transform.x'] = [
          { id: `kf_sl1_${Date.now()}`, time: t0, value: 360, easing: 'ease-out' },
          { id: `kf_sl2_${Date.now()}`, time: tFadeIn, value: 0, easing: 'ease-out' },
        ];
        kf['transform.opacity'] = [
          { id: `kf_slo1_${Date.now()}`, time: t0, value: 0, easing: 'ease-out' },
          { id: `kf_slo2_${Date.now()}`, time: Number((tFadeIn * 0.7).toFixed(3)), value: 100, easing: 'ease-out' },
        ];
      } else if (preset === 'spin-pop') {
        kf['transform.scale'] = [
          { id: `kf_sp1_${Date.now()}`, time: t0, value: 45, easing: 'ease-out' },
          { id: `kf_sp2_${Date.now()}`, time: tFadeIn, value: 100, easing: 'bezier' },
        ];
        kf['transform.rotation'] = [
          { id: `kf_spr1_${Date.now()}`, time: t0, value: -18, easing: 'ease-out' },
          { id: `kf_spr2_${Date.now()}`, time: tFadeIn, value: 0, easing: 'bezier' },
        ];
      } else if (preset === 'fade-io') {
        kf['transform.opacity'] = [
          { id: `kf_fio1_${Date.now()}`, time: t0, value: 0, easing: 'ease-out' },
          { id: `kf_fio2_${Date.now()}`, time: tFadeIn, value: 100, easing: 'ease-out' },
          { id: `kf_fio3_${Date.now()}`, time: tFadeOut, value: 100, easing: 'ease-in' },
          { id: `kf_fio4_${Date.now()}`, time: tEnd, value: 0, easing: 'ease-in' },
        ];
      }
      return { ...c, keyframes: kf };
    });
  };

  const activeLanes = useMemo(
    () => MOTION_PROPS.filter((def) => (clip.keyframes?.[def.prop]?.length ?? 0) > 0),
    [clip.keyframes]
  );

  const totalKeyframeCount = useMemo(
    () =>
      MOTION_PROPS.reduce((sum, def) => sum + (clip.keyframes?.[def.prop]?.length ?? 0), 0),
    [clip.keyframes]
  );

  // Resolve currently selected keyframe (or any keyframe right under playhead)
  const resolvedSelected = useMemo(() => {
    if (selectedKf) {
      const def = MOTION_PROPS.find((d) => d.prop === selectedKf.prop);
      const kf = clip.keyframes?.[selectedKf.prop]?.find((k) => k.id === selectedKf.id);
      if (def && kf) return { def, kf };
    }
    for (const def of MOTION_PROPS) {
      const hit = findKeyframeAt(clip.keyframes?.[def.prop], clipLocalTime);
      if (hit) return { def, kf: hit };
    }
    return null;
  }, [selectedKf, clip.keyframes, clipLocalTime]);

  const activeInterpolation: KeyframeEasing = resolvedSelected?.kf.easing || defaultEasing;

  const handleInterpolationTypeChange = (nextEasing: KeyframeEasing) => {
    setDefaultEasing(nextEasing);
    if (!clip.keyframes) return;

    // Update either the selected keyframe or any transform keyframes parked under the playhead
    update((c) => {
      if (!c.keyframes) return c;
      if (resolvedSelected) {
        const { def, kf } = resolvedSelected;
        return {
          ...c,
          keyframes: {
            ...c.keyframes,
            [def.prop]: updateKeyframeById(c.keyframes[def.prop], kf.id, { easing: nextEasing }, duration),
          },
        };
      }
      let changed = false;
      const nextKf = { ...c.keyframes };
      for (const def of MOTION_PROPS) {
        const hit = findKeyframeAt(nextKf[def.prop], clipLocalTime);
        if (hit) {
          nextKf[def.prop] = updateKeyframeById(nextKf[def.prop], hit.id, { easing: nextEasing }, duration);
          changed = true;
        }
      }
      return changed ? { ...c, keyframes: nextKf } : c;
    });
  };

  const handleApplyInterpolationToAll = () => {
    if (!clip.keyframes) return;
    update((c) => {
      if (!c.keyframes) return c;
      const nextKf = { ...c.keyframes };
      for (const def of MOTION_PROPS) {
        const list = nextKf[def.prop];
        if (list && list.length > 0) {
          nextKf[def.prop] = list.map((k) => ({ ...k, easing: activeInterpolation }));
        }
      }
      return { ...c, keyframes: nextKf };
    });
  };

  const scrubFromClientX = (clientX: number) => {
    const el = trackAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    onSeek(clip.start + ratio * duration);
  };

  const handleScrubPointerDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    scrubFromClientX(e.clientX);
    const onMove = (ev: MouseEvent) => scrubFromClientX(ev.clientX);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleDiamondPointerDown = (
    e: React.MouseEvent<HTMLButtonElement>,
    def: MotionPropDef,
    kfId: string,
    initialTime: number
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedKf({ prop: def.prop, id: kfId });
    onSeek(clip.start + initialTime);

    const el = trackAreaRef.current;
    if (!el) return;

    const onMove = (ev: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      const newTime = Number((ratio * duration).toFixed(3));
      update((c) => ({
        ...c,
        keyframes: {
          ...c.keyframes,
          [def.prop]: updateKeyframeById(c.keyframes?.[def.prop], kfId, { time: newTime }, duration),
        },
      }));
      onSeek(clip.start + newTime);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <section className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-[#D4D4DC]">Motion &amp; Keyframes</h3>
          <div className="text-[10px] font-mono-tabular text-[#7D7D8A] mt-0.5">
            Clip Time {clipLocalTime.toFixed(2)}s / {duration.toFixed(2)}s
            {totalKeyframeCount > 0 ? ` · ${totalKeyframeCount} kf` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleKeyframeAllTransform}
            title="Keyframe all Transform properties at playhead"
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-[#2563EB]/20 hover:bg-[#2563EB]/35 border border-[#3B82F6]/40 text-[#93C5FD] cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-2.5 h-2.5" />
            <span>Key All</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedKf(null);
              onResetMotion();
            }}
            className="text-[11px] text-[#7D7D8A] hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        </div>
      </div>

      {!isPlayheadInClip && (
        <div className="px-2.5 py-1.5 rounded bg-[#1E1E26] border border-[#2F2F3E] flex items-center justify-between gap-2 text-[10px]">
          <span className="text-[#9E9EAB]">Playhead is outside this clip</span>
          <button
            type="button"
            onClick={() => onSeek(clip.start)}
            className="text-[#60A5FA] hover:underline font-medium cursor-pointer whitespace-nowrap"
          >
            Jump to Clip
          </button>
        </div>
      )}

      {/* Interpolation Type Control */}
      <div className="p-2 rounded bg-[#131318] border border-[#252530] space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="motion-interpolation-type"
            className="text-[11px] font-medium text-[#C8C8D4] flex items-center gap-1.5 shrink-0"
          >
            <InterpolationCurveIcon easing={activeInterpolation} />
            <span>Interpolation Type</span>
          </label>
          <div className="flex items-center gap-1.5 min-w-0">
            <select
              id="motion-interpolation-type"
              aria-label="Interpolation Type"
              value={activeInterpolation}
              onChange={(e) => handleInterpolationTypeChange(e.target.value as KeyframeEasing)}
              className="bg-[#181820] border border-[#2D2D3A] focus:border-[#3B82F6] rounded px-2 py-1 text-[11px] font-medium text-[#F4F4F7] outline-none cursor-pointer"
            >
              {EASING_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {totalKeyframeCount > 0 && (
              <button
                type="button"
                onClick={handleApplyInterpolationToAll}
                title="Apply this interpolation type to all keyframes on this clip"
                className="px-1.5 py-1 rounded bg-[#1E1E28] hover:bg-[#2A2A38] border border-[#2D2D3A] text-[10px] text-[#93C5FD] hover:text-white whitespace-nowrap cursor-pointer"
              >
                All
              </button>
            )}
          </div>
        </div>
        <div className="text-[10px] text-[#7D7D8A]">
          {EASING_OPTIONS.find((o) => o.value === activeInterpolation)?.hint}
          {resolvedSelected ? ` · Editing ${resolvedSelected.def.shortLabel} @ ${resolvedSelected.kf.time.toFixed(2)}s` : ''}
        </div>
      </div>

      {/* Transform Property Sliders with Keyframe Navigation & Live Readout */}
      <div className="space-y-2.5">
        {MOTION_PROPS.map((def) => {
          const list = clip.keyframes?.[def.prop];
          const hasAnyKf = (list?.length ?? 0) > 0;
          const hitHere = findKeyframeAt(list, clipLocalTime);
          const { prevTime, nextTime } = getAdjacentKeyframeTimes(list, clipLocalTime);
          const liveValue = getLiveValue(def);

          return (
            <div key={def.prop} className="space-y-1">
              <div className="flex items-center justify-between text-[11px] gap-1.5">
                <div className="flex items-center gap-1 min-w-0">
                  {hasAnyKf && (
                    <button
                      type="button"
                      disabled={prevTime === null}
                      onClick={() => prevTime !== null && onSeek(clip.start + prevTime)}
                      title="Previous Keyframe"
                      className="p-0.5 text-[#8E8E9B] hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-default"
                    >
                      <ChevronLeft className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleToggleKeyframe(def)}
                    title={
                      hitHere
                        ? `Remove ${def.label} keyframe at ${clipLocalTime.toFixed(2)}s`
                        : `Add ${def.label} keyframe at ${clipLocalTime.toFixed(2)}s`
                    }
                    className={`p-0.5 cursor-pointer transition-colors ${
                      hitHere
                        ? 'text-[#3B82F6]'
                        : hasAnyKf
                        ? 'text-[#60A5FA] hover:text-[#93C5FD]'
                        : 'text-[#52525E] hover:text-[#A1A1AF]'
                    }`}
                  >
                    <Diamond className="w-3 h-3" fill={hitHere ? 'currentColor' : 'none'} />
                  </button>
                  {hasAnyKf && (
                    <button
                      type="button"
                      disabled={nextTime === null}
                      onClick={() => nextTime !== null && onSeek(clip.start + nextTime)}
                      title="Next Keyframe"
                      className="p-0.5 text-[#8E8E9B] hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-default"
                    >
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  )}
                  <span className="text-[#9E9EAB] truncate">{def.label}</span>
                  {hasAnyKf && (
                    <span className="text-[9px] font-mono-tabular text-[#60A5FA]">
                      ({list!.length})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  <input
                    type="number"
                    min={def.min}
                    max={def.max}
                    step={def.step}
                    value={liveValue}
                    onChange={(e) => {
                      const parsed = parseFloat(e.target.value);
                      if (!Number.isNaN(parsed)) {
                        handlePropertyValueChange(def, parsed);
                      }
                    }}
                    aria-label={def.label}
                    className="w-14 bg-[#121216] border border-[#272732] focus:border-[#3B82F6] rounded px-1.5 py-0.5 text-right font-mono-tabular text-[11px] text-[#E4E4EC] outline-none"
                  />
                  <span className="text-[10px] font-mono-tabular text-[#7D7D8A] w-4">
                    {def.unit}
                  </span>
                </div>
              </div>

              <input
                type="range"
                min={def.min}
                max={def.max}
                step={def.step}
                value={liveValue}
                onChange={(e) => handlePropertyValueChange(def, parseFloat(e.target.value))}
                className="w-full studio-slider"
              />
            </div>
          );
        })}
      </div>

      {/* Visual Keyframe Timeline & Curve Scrubber */}
      <div className="p-2.5 rounded-lg bg-[#121217] border border-[#252530] space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#D4D4DC]">
            <Diamond className="w-3 h-3 text-[#3B82F6]" fill="currentColor" />
            <span>Keyframe Timeline</span>
          </div>
          <span className="text-[10px] font-mono-tabular text-[#8E8E9B]">
            {EASING_OPTIONS.find((o) => o.value === activeInterpolation)?.label}
          </span>
        </div>

        {/* Mini Scrubber Ruler + Active Property Lanes */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-10 text-[9px] font-mono-tabular text-[#6F6F7D] shrink-0">
              Time
            </span>
            <div
              ref={trackAreaRef}
              onMouseDown={handleScrubPointerDown}
              className="flex-1 h-4 bg-[#181820] border border-[#282834] rounded relative cursor-ew-resize overflow-hidden select-none"
              title="Click or drag to scrub clip time"
            >
              <div className="absolute inset-x-1 top-1/2 -translate-y-1/2 flex justify-between text-[8px] font-mono-tabular text-[#646474] pointer-events-none">
                <span>0s</span>
                <span>{(duration / 2).toFixed(1)}s</span>
                <span>{duration.toFixed(1)}s</span>
              </div>
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-[#3B82F6] pointer-events-none"
                style={{ left: `${playheadPct}%` }}
              />
            </div>
          </div>

          {activeLanes.length === 0 ? (
            <div className="py-2 text-center text-[10px] text-[#7D7D8A]">
              Click any <span className="text-[#93C5FD]">◇</span> icon above or pick a motion preset below to animate.
            </div>
          ) : (
            <div className="space-y-1">
              {activeLanes.map((def) => {
                const kfs = clip.keyframes?.[def.prop] || [];
                return (
                  <div key={def.prop} className="flex items-center gap-2">
                    <span className="w-10 text-[10px] text-[#9E9EAB] truncate shrink-0">
                      {def.shortLabel}
                    </span>
                    <div
                      onMouseDown={handleScrubPointerDown}
                      className="flex-1 h-5 bg-[#16161C] border border-[#24242F] rounded relative cursor-ew-resize"
                    >
                      {/* Connecting Interpolation Line */}
                      {kfs.length >= 2 && (
                        <div
                          className="absolute top-1/2 -translate-y-1/2 h-[2px] opacity-40 pointer-events-none"
                          style={{
                            left: `${(kfs[0].time / duration) * 100}%`,
                            width: `${((kfs[kfs.length - 1].time - kfs[0].time) / duration) * 100}%`,
                            backgroundColor: def.color,
                          }}
                        />
                      )}
                      {/* Playhead Guide */}
                      <div
                        className="absolute top-0 bottom-0 w-px bg-[#3B82F6]/50 pointer-events-none"
                        style={{ left: `${playheadPct}%` }}
                      />
                      {/* Interactive Keyframe Diamonds */}
                      {kfs.map((kf) => {
                        const pct = Math.max(0, Math.min(100, (kf.time / duration) * 100));
                        const isSelected = resolvedSelected?.kf.id === kf.id;
                        return (
                          <button
                            key={kf.id}
                            type="button"
                            onMouseDown={(e) => handleDiamondPointerDown(e, def, kf.id, kf.time)}
                            title={`${def.label}: ${kf.value}${def.unit} @ ${kf.time.toFixed(2)}s (${kf.easing})`}
                            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 p-0.5 cursor-grab active:cursor-grabbing ${
                              isSelected ? 'z-10 scale-125' : 'hover:scale-110'
                            }`}
                            style={{ left: `${pct}%`, color: isSelected ? '#FFFFFF' : def.color }}
                          >
                            <Diamond className="w-2.5 h-2.5" fill="currentColor" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Keyframe Editor */}
        {resolvedSelected && (
          <div className="p-2 rounded bg-[#181820] border border-[#2D2D3A] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold text-[#E4E4EC]">
                {resolvedSelected.def.label} Keyframe
              </span>
              <button
                type="button"
                onClick={() => {
                  const { def, kf } = resolvedSelected;
                  update((c) => {
                    const nextList = removeKeyframeById(c.keyframes?.[def.prop], kf.id);
                    const nextKf = { ...c.keyframes };
                    if (nextList.length === 0) delete nextKf[def.prop];
                    else nextKf[def.prop] = nextList;
                    return {
                      ...c,
                      keyframes: Object.keys(nextKf).length > 0 ? nextKf : undefined,
                    };
                  });
                  setSelectedKf(null);
                }}
                title="Delete Keyframe"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#2B1418] hover:bg-[#3F1B21] text-[10px] text-[#FCA5A5] cursor-pointer"
              >
                <Trash2 className="w-2.5 h-2.5" />
                <span>Delete</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <label className="block text-[9px] text-[#8E8E9B] mb-0.5">Time (s)</label>
                <input
                  type="number"
                  min={0}
                  max={duration}
                  step={0.05}
                  value={resolvedSelected.kf.time}
                  onChange={(e) => {
                    const nextT = parseFloat(e.target.value);
                    if (Number.isNaN(nextT)) return;
                    const { def, kf } = resolvedSelected;
                    update((c) => ({
                      ...c,
                      keyframes: {
                        ...c.keyframes,
                        [def.prop]: updateKeyframeById(c.keyframes?.[def.prop], kf.id, { time: nextT }, duration),
                      },
                    }));
                    onSeek(clip.start + Math.max(0, Math.min(duration, nextT)));
                  }}
                  className="w-full bg-[#121216] border border-[#2A2A35] rounded px-1.5 py-0.5 text-[10px] font-mono-tabular text-white outline-none"
                />
              </div>
              <div>
                <label className="block text-[9px] text-[#8E8E9B] mb-0.5">
                  Value ({resolvedSelected.def.unit})
                </label>
                <input
                  type="number"
                  min={resolvedSelected.def.min}
                  max={resolvedSelected.def.max}
                  step={resolvedSelected.def.step}
                  value={resolvedSelected.kf.value}
                  onChange={(e) => {
                    const nextV = parseFloat(e.target.value);
                    if (Number.isNaN(nextV)) return;
                    const { def, kf } = resolvedSelected;
                    update((c) => ({
                      ...c,
                      keyframes: {
                        ...c.keyframes,
                        [def.prop]: updateKeyframeById(c.keyframes?.[def.prop], kf.id, { value: nextV }, duration),
                      },
                    }));
                  }}
                  className="w-full bg-[#121216] border border-[#2A2A35] rounded px-1.5 py-0.5 text-[10px] font-mono-tabular text-white outline-none"
                />
              </div>
              <div>
                <label className="block text-[9px] text-[#8E8E9B] mb-0.5">Interpolation Type</label>
                <select
                  aria-label="Selected Keyframe Interpolation Type"
                  value={resolvedSelected.kf.easing}
                  onChange={(e) => {
                    const easing = e.target.value as KeyframeEasing;
                    setDefaultEasing(easing);
                    const { def, kf } = resolvedSelected;
                    update((c) => ({
                      ...c,
                      keyframes: {
                        ...c.keyframes,
                        [def.prop]: updateKeyframeById(c.keyframes?.[def.prop], kf.id, { easing }, duration),
                      },
                    }));
                  }}
                  className="w-full bg-[#121216] border border-[#2A2A35] rounded px-1 py-0.5 text-[10px] text-white outline-none cursor-pointer"
                >
                  {EASING_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Quick Animation Presets */}
        <div className="pt-1 border-t border-[#22222C] space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-[#8E8E9B] flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5 text-[#3B82F6]" />
              Quick Motion Presets
            </span>
            {totalKeyframeCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSelectedKf(null);
                  update((c) => ({ ...c, keyframes: undefined }));
                }}
                className="text-[10px] text-[#8E8E9B] hover:text-[#FCA5A5] cursor-pointer"
              >
                Clear Keyframes
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(
              [
                { id: 'zoom-in', label: 'Zoom In' },
                { id: 'zoom-out', label: 'Zoom Out' },
                { id: 'slide-left', label: 'Slide In' },
                { id: 'spin-pop', label: 'Spin Pop' },
                { id: 'fade-io', label: 'Fade I/O' },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleApplyMotionPreset(preset.id)}
                className="px-1.5 py-1 rounded bg-[#181820] hover:bg-[#242430] border border-[#282834] text-[10px] font-medium text-[#D4D4DC] hover:text-white cursor-pointer truncate"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Blend Mode & Flip Horizontal */}
      <div className="grid grid-cols-2 gap-2 pt-0.5">
        <div>
          <label className="block text-[11px] text-[#8E8E9B] mb-1">Blend Mode</label>
          <select
            value={clip.transform.blendMode}
            onChange={(e) =>
              update((c) => ({
                ...c,
                transform: { ...c.transform, blendMode: e.target.value as BlendMode },
              }))
            }
            className="w-full bg-[#121215] border border-[#2B2B34] rounded px-2 py-1 text-xs text-[#E4E4EC] outline-none"
          >
            <option value="source-over">Normal</option>
            <option value="screen">Screen</option>
            <option value="multiply">Multiply</option>
            <option value="overlay">Overlay</option>
            <option value="lighten">Lighten</option>
            <option value="darken">Darken</option>
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() =>
              update((c) => ({ ...c, transform: { ...c.transform, flipH: !c.transform.flipH } }))
            }
            className={`w-full py-1 px-2 text-xs rounded border cursor-pointer ${
              clip.transform.flipH
                ? 'bg-[#3B82F6]/20 border-[#3B82F6] text-white'
                : 'bg-[#121215] border-[#2B2B34] text-[#C2C2CC] hover:text-white'
            }`}
          >
            Flip Horizontal
          </button>
        </div>
      </div>
    </section>
  );
}
