import React, { useRef, useState } from 'react';
import {
  AlignCenter,
  Diamond,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Pipette,
  Plus,
  RotateCcw,
  Scan,
  Sliders,
  Snowflake,
  Sparkles,
  Type,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  COLOR_PRESETS,
  DEFAULT_AUDIO,
  DEFAULT_COLOR_GRADE,
  DEFAULT_TRANSFORM,
  DEFAULT_VFX,
  TRANSITION_CATALOG,
} from '../data/presets';
import {
  CaptionSegment,
  ColorWheelValue,
  InspectorTab,
  KeyframeProperty,
  MediaAsset,
  MonitorInteractionMode,
  ProjectVersion,
  ReviewComment,
  SequenceSettings,
  TimelineClip,
  Track,
  TransitionType,
} from '../types/editor';
import { parseCubeLut } from '../utils/cubeLut';
import { evaluateKeyframedValue, findKeyframeAt, toggleOrUpdateKeyframe, upsertKeyframe } from '../utils/keyframes';
import { computeAutoColorGrade, computeColorMatchGrade } from '../utils/sceneDetect';
import { AiActionPayload, AiAndTextTab, ReviewAndVersionsTab } from './AiAndReviewTabs';
import { MotionKeyframePanel } from './MotionKeyframePanel';

interface InspectorPanelProps {
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  selectedClip: TimelineClip | null;
  playhead: number;
  sequence: SequenceSettings;
  tracks: Track[];
  clips: TimelineClip[];
  assets: MediaAsset[];
  captions: CaptionSegment[];
  comments: ReviewComment[];
  versions: ProjectVersion[];
  masterVolume: number;
  onMasterVolumeChange: (val: number) => void;
  onUpdateClip: (clipId: string, updater: (clip: TimelineClip) => TimelineClip) => void;
  onUpdateTrackMixer: (trackId: string, patch: Partial<Track>) => void;
  onApplyColorPreset: (presetId: string) => void;
  onInsertTitleAtPlayhead: () => void;
  onUpdateCaptions: (captions: CaptionSegment[]) => void;
  onExecuteAiActions: (actions: AiActionPayload[]) => void;
  onAddGeneratedVoiceover: (name: string, base64Wav: string) => void;
  onSplitClipMultiple: (clipId: string, splitTimes: number[]) => void;
  onRemixMusicToSequence: () => void;
  onAddReviewComment: (text: string) => void;
  onToggleResolveComment: (id: string) => void;
  onDeleteReviewComment: (id: string) => void;
  onSaveVersion: (name: string) => void;
  onRestoreVersion: (id: string) => void;
  onSeek: (time: number) => void;
  monitorInteractionMode: MonitorInteractionMode;
  onChangeMonitorInteractionMode: (mode: MonitorInteractionMode) => void;
  checkerboardBg: boolean;
  onToggleCheckerboardBg: () => void;
}

export function InspectorPanel({
  activeTab,
  onTabChange,
  selectedClip,
  playhead,
  sequence,
  tracks,
  clips,
  assets,
  captions,
  comments,
  versions,
  masterVolume,
  onMasterVolumeChange,
  onUpdateClip,
  onUpdateTrackMixer,
  onApplyColorPreset,
  onInsertTitleAtPlayhead,
  onUpdateCaptions,
  onExecuteAiActions,
  onAddGeneratedVoiceover,
  onSplitClipMultiple,
  onRemixMusicToSequence,
  onAddReviewComment,
  onToggleResolveComment,
  onDeleteReviewComment,
  onSaveVersion,
  onRestoreVersion,
  onSeek,
  monitorInteractionMode,
  onChangeMonitorInteractionMode,
  checkerboardBg,
  onToggleCheckerboardBg,
}: InspectorPanelProps) {
  const lutInputRef = useRef<HTMLInputElement | null>(null);
  const [colorSubTab, setColorSubTab] = useState<'basic' | 'wheels' | 'hsl'>('basic');
  const [matchSourceId, setMatchSourceId] = useState<string>(assets[0]?.id || '');
  const [colorBusy, setColorBusy] = useState(false);

  const update = (fn: (clip: TimelineClip) => TimelineClip) => {
    if (!selectedClip) return;
    onUpdateClip(selectedClip.id, fn);
  };

  const clipLocalTime = selectedClip
    ? Math.max(0, Math.min(selectedClip.duration, playhead - selectedClip.start))
    : 0;

  const toggleKeyframe = (prop: KeyframeProperty, value: number) => {
    if (!selectedClip) return;
    update((c) => {
      const nextList = toggleOrUpdateKeyframe(c.keyframes?.[prop], clipLocalTime, value);
      const nextKf = { ...c.keyframes };
      if (nextList.length === 0) delete nextKf[prop];
      else nextKf[prop] = nextList;
      return {
        ...c,
        keyframes: Object.keys(nextKf).length > 0 ? nextKf : undefined,
      };
    });
  };

  const hasKeyframeHere = (prop: KeyframeProperty) => {
    if (!selectedClip) return false;
    return Boolean(findKeyframeAt(selectedClip.keyframes?.[prop], clipLocalTime));
  };

  const applyTransformPreset = (preset: 'center' | 'fit' | 'fill' | 'reset-scale-pos') => {
    if (!selectedClip) return;
    const srcAsset = assets.find((a) => a.id === selectedClip.assetId);
    const srcW = srcAsset?.width || sequence.width;
    const srcH = srcAsset?.height || sequence.height;
    const seqW = Math.max(1, sequence.width);
    const seqH = Math.max(1, sequence.height);
    const coverScale = Math.max(seqW / Math.max(1, srcW), seqH / Math.max(1, srcH));
    const containScale = Math.min(seqW / Math.max(1, srcW), seqH / Math.max(1, srcH));
    const fitScalePct = Math.max(10, Math.min(300, Math.round((containScale / Math.max(0.0001, coverScale)) * 100)));

    update((c) => {
      const nextTransform = { ...c.transform };
      const nextKeyframes = c.keyframes ? { ...c.keyframes } : undefined;

      const syncProp = (prop: KeyframeProperty, val: number) => {
        if (nextKeyframes && (nextKeyframes[prop]?.length ?? 0) > 0) {
          nextKeyframes[prop] = upsertKeyframe(nextKeyframes[prop], clipLocalTime, val);
        }
      };

      if (preset === 'center') {
        nextTransform.x = 0;
        nextTransform.y = 0;
        syncProp('transform.x', 0);
        syncProp('transform.y', 0);
      } else if (preset === 'fit') {
        nextTransform.x = 0;
        nextTransform.y = 0;
        nextTransform.scale = fitScalePct;
        syncProp('transform.x', 0);
        syncProp('transform.y', 0);
        syncProp('transform.scale', fitScalePct);
      } else if (preset === 'fill') {
        nextTransform.x = 0;
        nextTransform.y = 0;
        nextTransform.scale = 100;
        syncProp('transform.x', 0);
        syncProp('transform.y', 0);
        syncProp('transform.scale', 100);
      } else if (preset === 'reset-scale-pos') {
        nextTransform.x = 0;
        nextTransform.y = 0;
        nextTransform.scale = 100;
        if (nextKeyframes) {
          delete nextKeyframes['transform.x'];
          delete nextKeyframes['transform.y'];
          delete nextKeyframes['transform.scale'];
        }
      }

      return {
        ...c,
        transform: nextTransform,
        keyframes: nextKeyframes && Object.keys(nextKeyframes).length > 0 ? nextKeyframes : undefined,
      };
    });
  };

  const handleAutoColor = async () => {
    if (!selectedClip) return;
    const asset = assets.find((a) => a.id === selectedClip.assetId);
    if (!asset) return;
    setColorBusy(true);
    try {
      const grade = await computeAutoColorGrade(asset, selectedClip.color);
      update((c) => ({ ...c, color: { ...c.color, ...grade } }));
    } finally {
      setColorBusy(false);
    }
  };

  const handleColorMatch = async () => {
    if (!selectedClip) return;
    const srcAsset = assets.find((a) => a.id === selectedClip.assetId);
    const refAsset = assets.find((a) => a.id === matchSourceId);
    if (!srcAsset || !refAsset) return;
    setColorBusy(true);
    try {
      const grade = await computeColorMatchGrade(srcAsset, refAsset);
      update((c) => ({ ...c, color: { ...c.color, ...grade } }));
    } finally {
      setColorBusy(false);
    }
  };

  const handleUploadLut = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedClip) return;
    const txt = await file.text();
    const parsed = parseCubeLut(txt, file.name);
    update((c) => ({
      ...c,
      color: {
        ...c.color,
        presetId: 'custom-lut',
        customLutName: parsed.title,
        customLutData: { size: parsed.size, table: parsed.table },
      },
    }));
    e.target.value = '';
  };

  return (
    <aside className="h-full bg-[#18181C] border-l border-[#27272E] flex flex-col min-w-0 overflow-hidden">
      {/* Tab Strip */}
      <div className="h-9 px-2 bg-[#141418] border-b border-[#27272E] flex items-center gap-1 shrink-0 overflow-x-auto">
        {(
          [
            { id: 'motion', label: 'Motion' },
            { id: 'color', label: 'Color' },
            { id: 'audio', label: 'Audio' },
            { id: 'graphics', label: 'Graphics' },
            { id: 'ai', label: 'AI & Text' },
            { id: 'review', label: 'Review' },
          ] as Array<{ id: InspectorTab; label: string }>
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === t.id ? 'bg-[#25252D] text-[#F4F4F7]' : 'text-[#8E8E9B] hover:text-[#D4D4DC]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Selected Clip Header */}
      {selectedClip ? (
        <div className="px-3 py-2 border-b border-[#25252C] bg-[#151519] flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#F4F4F7] truncate">{selectedClip.name}</div>
            <div className="text-[10px] text-[#7D7D8A] font-mono-tabular mt-0.5">
              Track {selectedClip.trackId} · {selectedClip.duration.toFixed(2)}s · {selectedClip.speed.toFixed(2)}x
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => update((c) => ({ ...c, freezeFrame: !c.freezeFrame }))}
              title="Freeze Frame Hold"
              className={`p-1.5 rounded border text-xs cursor-pointer ${
                selectedClip.freezeFrame
                  ? 'border-[#3B82F6] bg-[#3B82F6]/20 text-[#93C5FD]'
                  : 'border-[#2C2C35] bg-[#202026] text-[#B8B8C4] hover:text-white'
              }`}
            >
              <Snowflake className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => update((c) => ({ ...c, disabled: !c.disabled }))}
              title={selectedClip.disabled ? 'Enable Clip' : 'Disable Clip'}
              className={`p-1.5 rounded border text-xs cursor-pointer ${
                selectedClip.disabled
                  ? 'border-[#DC2626]/50 bg-[#DC2626]/15 text-[#F87171]'
                  : 'border-[#2C2C35] bg-[#202026] text-[#B8B8C4] hover:text-white'
              }`}
            >
              {selectedClip.disabled ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 border-b border-[#25252C] bg-[#151519] text-[11px] text-[#7D7D8A] shrink-0">
          No clip selected on timeline
        </div>
      )}

      {/* Inspector Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {activeTab === 'motion' &&
          (selectedClip ? (
            <>
              {/* Transform Presets */}
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-[#D4D4DC]">Transform Presets</h3>
                  <span className="text-[10px] font-mono-tabular text-[#7D7D8A]">
                    {Math.round(
                      evaluateKeyframedValue(selectedClip, 'transform.scale', clipLocalTime, selectedClip.transform.scale)
                    )}
                    % · (
                    {Math.round(
                      evaluateKeyframedValue(selectedClip, 'transform.x', clipLocalTime, selectedClip.transform.x)
                    )}
                    ,{' '}
                    {Math.round(
                      evaluateKeyframedValue(selectedClip, 'transform.y', clipLocalTime, selectedClip.transform.y)
                    )}
                    )
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyTransformPreset('center')}
                    title="Center clip position to (0, 0)"
                    className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-[#131318] hover:bg-[#22222C] border border-[#272732] text-[11px] font-medium text-[#E4E4EC] transition-colors cursor-pointer"
                  >
                    <AlignCenter className="w-3.5 h-3.5 text-[#60A5FA]" />
                    <span>Center</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTransformPreset('fit')}
                    title="Fit entire clip inside sequence frame without cropping"
                    className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-[#131318] hover:bg-[#22222C] border border-[#272732] text-[11px] font-medium text-[#E4E4EC] transition-colors cursor-pointer"
                  >
                    <Minimize2 className="w-3.5 h-3.5 text-[#34D399]" />
                    <span>Fit to Frame</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTransformPreset('fill')}
                    title="Fill sequence frame (100% cover)"
                    className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-[#131318] hover:bg-[#22222C] border border-[#272732] text-[11px] font-medium text-[#E4E4EC] transition-colors cursor-pointer"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-[#38BDF8]" />
                    <span>Fill Frame</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTransformPreset('reset-scale-pos')}
                    title="Reset scale to 100% and position to (0, 0)"
                    className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-[#131318] hover:bg-[#22222C] border border-[#272732] text-[11px] font-medium text-[#E4E4EC] transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-[#FBBF24]" />
                    <span>Reset Scale &amp; Pos</span>
                  </button>
                </div>
              </section>

              <hr className="border-[#25252D]" />

              <MotionKeyframePanel
                clip={selectedClip}
                playhead={playhead}
                onUpdateClip={onUpdateClip}
                onSeek={onSeek}
                onResetMotion={() =>
                  update((c) => ({ ...c, transform: { ...DEFAULT_TRANSFORM }, keyframes: undefined }))
                }
              />

              <hr className="border-[#25252D]" />

              {/* Keying & Shape Masking */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[#D4D4DC]">Ultra Key & Masking</h3>
                  <button
                    type="button"
                    onClick={() => update((c) => ({ ...c, vfx: { ...DEFAULT_VFX } }))}
                    className="text-[11px] text-[#7D7D8A] hover:text-white cursor-pointer"
                  >
                    Reset VFX
                  </button>
                </div>

                {/* Chroma Key */}
                <div className="p-2 rounded bg-[#131317] border border-[#25252D] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-[#D4D4DC]">Ultra Key (Chroma)</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onChangeMonitorInteractionMode(
                            monitorInteractionMode === 'chroma-eyedropper' ? 'none' : 'chroma-eyedropper'
                          )
                        }
                        title="Click any color on the video monitor to key it out"
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium transition-colors cursor-pointer ${
                          monitorInteractionMode === 'chroma-eyedropper'
                            ? 'bg-[#3B82F6]/25 border-[#3B82F6] text-[#93C5FD]'
                            : 'bg-[#1A1A21] border-[#2C2C36] text-[#B8B8C4] hover:text-white'
                        }`}
                      >
                        <Pipette className="w-3 h-3" />
                        <span>{monitorInteractionMode === 'chroma-eyedropper' ? 'Picking...' : 'Pick Video'}</span>
                      </button>
                      <input
                        type="checkbox"
                        checked={selectedClip.vfx.chromaKey.enabled}
                        onChange={(e) =>
                          update((c) => ({
                            ...c,
                            vfx: { ...c.vfx, chromaKey: { ...c.vfx.chromaKey, enabled: e.target.checked } },
                          }))
                        }
                      />
                    </div>
                  </div>
                  {selectedClip.vfx.chromaKey.enabled && (
                    <div className="space-y-2.5 pt-1 border-t border-[#22222A]">
                      {/* Primary Color + Eyedropper + Add Shade */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <input
                            type="color"
                            value={selectedClip.vfx.chromaKey.color}
                            onChange={(e) =>
                              update((c) => ({
                                ...c,
                                vfx: { ...c.vfx, chromaKey: { ...c.vfx.chromaKey, color: e.target.value.toUpperCase() } },
                              }))
                            }
                            aria-label="Primary Chroma Key Color"
                            className="w-8 h-6 bg-[#121215] border border-[#2B2B34] rounded cursor-pointer shrink-0"
                          />
                          <span className="text-[10px] font-mono-tabular text-[#D4D4DC] truncate">
                            {selectedClip.vfx.chromaKey.color.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              update((c) => ({
                                ...c,
                                vfx: { ...c.vfx, chromaKey: { ...c.vfx.chromaKey, color: '#00CC44' } },
                              }))
                            }
                            title="Green Screen (#00CC44)"
                            className="w-3.5 h-3.5 rounded-full bg-[#00CC44] border border-white/25 cursor-pointer"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              update((c) => ({
                                ...c,
                                vfx: { ...c.vfx, chromaKey: { ...c.vfx.chromaKey, color: '#0055FF' } },
                              }))
                            }
                            title="Blue Screen (#0055FF)"
                            className="w-3.5 h-3.5 rounded-full bg-[#0055FF] border border-white/25 cursor-pointer mr-1"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              onChangeMonitorInteractionMode(
                                monitorInteractionMode === 'chroma-add-color' ? 'none' : 'chroma-add-color'
                              )
                            }
                            title="Click an additional color shade in the video to remove together"
                            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] cursor-pointer ${
                              monitorInteractionMode === 'chroma-add-color'
                                ? 'bg-[#3B82F6]/25 border-[#3B82F6] text-[#93C5FD]'
                                : 'bg-[#18181E] border-[#2C2C35] text-[#A1A1AF] hover:text-white'
                            }`}
                          >
                            <Plus className="w-2.5 h-2.5" />
                            <span>Shade</span>
                          </button>
                        </div>
                      </div>

                      {/* Picked Additional Shades */}
                      {(selectedClip.vfx.chromaKey.additionalColors?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          {(selectedClip.vfx.chromaKey.additionalColors || []).map((shadeHex) => (
                            <span
                              key={shadeHex}
                              className="inline-flex items-center gap-1 pl-1 pr-1 py-0.5 rounded bg-[#18181F] border border-[#2B2B35] text-[10px] font-mono-tabular text-[#C8C8D2]"
                            >
                              <span
                                className="w-2.5 h-2.5 rounded-sm border border-white/30"
                                style={{ backgroundColor: shadeHex }}
                              />
                              <span>{shadeHex}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  update((c) => ({
                                    ...c,
                                    vfx: {
                                      ...c.vfx,
                                      chromaKey: {
                                        ...c.vfx.chromaKey,
                                        additionalColors: (c.vfx.chromaKey.additionalColors || []).filter(
                                          (h) => h !== shadeHex
                                        ),
                                      },
                                    },
                                  }))
                                }
                                title="Remove shade"
                                className="text-[#7D7D8A] hover:text-white cursor-pointer"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      <SliderRow
                        label="Tolerance"
                        value={selectedClip.vfx.chromaKey.similarity}
                        min={5}
                        max={85}
                        step={1}
                        onChange={(similarity) =>
                          update((c) => ({
                            ...c,
                            vfx: { ...c.vfx, chromaKey: { ...c.vfx.chromaKey, similarity } },
                          }))
                        }
                      />
                      <SliderRow
                        label="Edge Smoothness"
                        value={selectedClip.vfx.chromaKey.smoothness}
                        min={0}
                        max={40}
                        step={1}
                        onChange={(smoothness) =>
                          update((c) => ({
                            ...c,
                            vfx: { ...c.vfx, chromaKey: { ...c.vfx.chromaKey, smoothness } },
                          }))
                        }
                      />
                      <SliderRow
                        label="Spill Suppression"
                        value={selectedClip.vfx.chromaKey.spillReduction}
                        min={0}
                        max={100}
                        step={2}
                        unit="%"
                        onChange={(spillReduction) =>
                          update((c) => ({
                            ...c,
                            vfx: { ...c.vfx, chromaKey: { ...c.vfx.chromaKey, spillReduction } },
                          }))
                        }
                      />

                      {/* Localized Video Area Restriction */}
                      <div className="pt-1.5 border-t border-[#22222A] space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-1.5 text-[11px] text-[#B8B8C4] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedClip.vfx.chromaKey.region?.enabled)}
                              onChange={(e) =>
                                update((c) => ({
                                  ...c,
                                  vfx: {
                                    ...c.vfx,
                                    chromaKey: {
                                      ...c.vfx.chromaKey,
                                      region: {
                                        ...(c.vfx.chromaKey.region || {
                                          x: 15,
                                          y: 15,
                                          width: 70,
                                          height: 70,
                                          feather: 4,
                                        }),
                                        enabled: e.target.checked,
                                      },
                                    },
                                  },
                                }))
                              }
                            />
                            <span>Limit to Video Area</span>
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              onChangeMonitorInteractionMode(
                                monitorInteractionMode === 'chroma-region' ? 'none' : 'chroma-region'
                              )
                            }
                            title="Drag a box on the video monitor to key only that part"
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] cursor-pointer ${
                              monitorInteractionMode === 'chroma-region'
                                ? 'bg-[#3B82F6]/25 border-[#3B82F6] text-[#93C5FD]'
                                : 'bg-[#18181E] border-[#2C2C35] text-[#A1A1AF] hover:text-white'
                            }`}
                          >
                            <Scan className="w-3 h-3" />
                            <span>{monitorInteractionMode === 'chroma-region' ? 'Drawing...' : 'Draw Area'}</span>
                          </button>
                        </div>

                        {selectedClip.vfx.chromaKey.region?.enabled && (
                          <div className="space-y-1.5 pl-1">
                            <div className="flex items-center justify-between text-[10px] font-mono-tabular text-[#8E8E9B]">
                              <span>
                                X {Math.round(selectedClip.vfx.chromaKey.region.x)}% · Y{' '}
                                {Math.round(selectedClip.vfx.chromaKey.region.y)}% ·{' '}
                                {Math.round(selectedClip.vfx.chromaKey.region.width)}×
                                {Math.round(selectedClip.vfx.chromaKey.region.height)}%
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  update((c) => ({
                                    ...c,
                                    vfx: {
                                      ...c.vfx,
                                      chromaKey: {
                                        ...c.vfx.chromaKey,
                                        region: { enabled: false, x: 15, y: 15, width: 70, height: 70, feather: 4 },
                                      },
                                    },
                                  }))
                                }
                                className="text-[#7D7D8A] hover:text-white cursor-pointer"
                              >
                                Clear
                              </button>
                            </div>
                            <SliderRow
                              label="Area Feather"
                              value={selectedClip.vfx.chromaKey.region.feather}
                              min={0}
                              max={25}
                              step={1}
                              unit="%"
                              onChange={(feather) =>
                                update((c) => ({
                                  ...c,
                                  vfx: {
                                    ...c.vfx,
                                    chromaKey: {
                                      ...c.vfx.chromaKey,
                                      region: {
                                        ...(c.vfx.chromaKey.region || {
                                          enabled: true,
                                          x: 15,
                                          y: 15,
                                          width: 70,
                                          height: 70,
                                          feather: 4,
                                        }),
                                        feather,
                                      },
                                    },
                                  },
                                }))
                              }
                            />
                          </div>
                        )}
                      </div>

                      {/* Key Helper Toggles */}
                      <div className="grid grid-cols-3 gap-1 pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            update((c) => ({
                              ...c,
                              vfx: {
                                ...c.vfx,
                                chromaKey: { ...c.vfx.chromaKey, invert: !c.vfx.chromaKey.invert },
                              },
                            }))
                          }
                          title="Keep only the selected color(s) instead of removing them"
                          className={`py-1 text-[10px] rounded border cursor-pointer ${
                            selectedClip.vfx.chromaKey.invert
                              ? 'bg-[#3B82F6]/20 border-[#3B82F6] text-white'
                              : 'bg-[#121215] border-[#2B2B34] text-[#9E9EAB] hover:text-white'
                          }`}
                        >
                          Invert Key
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            update((c) => ({
                              ...c,
                              vfx: {
                                ...c.vfx,
                                chromaKey: { ...c.vfx.chromaKey, mattePreview: !c.vfx.chromaKey.mattePreview },
                              },
                            }))
                          }
                          title="Preview alpha cutout mask (black = removed, white = kept)"
                          className={`py-1 text-[10px] rounded border cursor-pointer ${
                            selectedClip.vfx.chromaKey.mattePreview
                              ? 'bg-[#3B82F6]/20 border-[#3B82F6] text-white'
                              : 'bg-[#121215] border-[#2B2B34] text-[#9E9EAB] hover:text-white'
                          }`}
                        >
                          Matte View
                        </button>
                        <button
                          type="button"
                          onClick={onToggleCheckerboardBg}
                          title="Show transparency checkerboard behind keyed video in Monitor"
                          className={`py-1 text-[10px] rounded border cursor-pointer ${
                            checkerboardBg
                              ? 'bg-[#3B82F6]/20 border-[#3B82F6] text-white'
                              : 'bg-[#121215] border-[#2B2B34] text-[#9E9EAB] hover:text-white'
                          }`}
                        >
                          Grid BG
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Shape Mask */}
                <div className="p-2 rounded bg-[#131317] border border-[#25252D] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-[#D4D4DC]">Shape Mask</span>
                    <input
                      type="checkbox"
                      checked={selectedClip.vfx.mask.enabled}
                      onChange={(e) =>
                        update((c) => ({
                          ...c,
                          vfx: { ...c.vfx, mask: { ...c.vfx.mask, enabled: e.target.checked } },
                        }))
                      }
                    />
                  </div>
                  {selectedClip.vfx.mask.enabled && (
                    <div className="space-y-2 pt-1">
                      <div className="grid grid-cols-2 gap-1.5">
                        <select
                          value={selectedClip.vfx.mask.shape}
                          onChange={(e) =>
                            update((c) => ({
                              ...c,
                              vfx: {
                                ...c.vfx,
                                mask: { ...c.vfx.mask, shape: e.target.value as 'rectangle' | 'ellipse' },
                              },
                            }))
                          }
                          className="bg-[#121215] border border-[#2B2B34] rounded px-2 py-1 text-[11px] text-white"
                        >
                          <option value="ellipse">Ellipse</option>
                          <option value="rectangle">Rectangle</option>
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            update((c) => ({
                              ...c,
                              vfx: { ...c.vfx, mask: { ...c.vfx.mask, inverted: !c.vfx.mask.inverted } },
                            }))
                          }
                          className={`py-1 px-2 text-[11px] rounded border cursor-pointer ${
                            selectedClip.vfx.mask.inverted
                              ? 'bg-[#3B82F6]/20 border-[#3B82F6] text-white'
                              : 'bg-[#121215] border-[#2B2B34] text-[#A1A1AF]'
                          }`}
                        >
                          Invert Mask
                        </button>
                      </div>
                      <SliderRow
                        label="Mask Width"
                        value={selectedClip.vfx.mask.width}
                        min={10}
                        max={100}
                        step={1}
                        unit="%"
                        onChange={(width) =>
                          update((c) => ({ ...c, vfx: { ...c.vfx, mask: { ...c.vfx.mask, width } } }))
                        }
                      />
                      <SliderRow
                        label="Mask Height"
                        value={selectedClip.vfx.mask.height}
                        min={10}
                        max={100}
                        step={1}
                        unit="%"
                        onChange={(height) =>
                          update((c) => ({ ...c, vfx: { ...c.vfx, mask: { ...c.vfx.mask, height } } }))
                        }
                      />
                      <SliderRow
                        label="Expansion"
                        value={selectedClip.vfx.mask.expansion}
                        min={-30}
                        max={30}
                        step={1}
                        unit="%"
                        onChange={(expansion) =>
                          update((c) => ({ ...c, vfx: { ...c.vfx, mask: { ...c.vfx.mask, expansion } } }))
                        }
                      />
                    </div>
                  )}
                </div>

                {/* Optics & Stylize Sliders */}
                <SliderRow
                  label="Directional Blur"
                  value={selectedClip.vfx.directionalBlurAmount}
                  min={0}
                  max={25}
                  step={1}
                  unit="px"
                  onChange={(directionalBlurAmount) =>
                    update((c) => ({ ...c, vfx: { ...c.vfx, directionalBlurAmount } }))
                  }
                />
                <SliderRow
                  label="Sharpen"
                  value={selectedClip.vfx.sharpen}
                  min={0}
                  max={100}
                  step={2}
                  unit="%"
                  onChange={(sharpen) => update((c) => ({ ...c, vfx: { ...c.vfx, sharpen } }))}
                />
                <SliderRow
                  label="Cine Glow"
                  value={selectedClip.vfx.glow}
                  min={0}
                  max={100}
                  step={2}
                  unit="%"
                  onChange={(glow) => update((c) => ({ ...c, vfx: { ...c.vfx, glow } }))}
                />
                <SliderRow
                  label="Chromatic Aberration"
                  value={selectedClip.vfx.chromaticAberration}
                  min={0}
                  max={20}
                  step={1}
                  unit="px"
                  onChange={(chromaticAberration) =>
                    update((c) => ({ ...c, vfx: { ...c.vfx, chromaticAberration } }))
                  }
                />
              </section>

              <hr className="border-[#25252D]" />

              {/* Speed & Transitions */}
              <section className="space-y-2.5">
                <h3 className="text-xs font-semibold text-[#D4D4DC]">Time & Transitions</h3>
                <SliderRow
                  label="Speed"
                  value={Math.round(selectedClip.speed * 100)}
                  min={25}
                  max={400}
                  step={5}
                  unit="%"
                  onChange={(pct) => update((c) => ({ ...c, speed: pct / 100 }))}
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => update((c) => ({ ...c, reversed: !c.reversed }))}
                    className={`py-1 text-[11px] rounded border cursor-pointer ${
                      selectedClip.reversed
                        ? 'bg-[#3B82F6]/20 border-[#3B82F6] text-white'
                        : 'bg-[#121215] border-[#2B2B34] text-[#A1A1AF]'
                    }`}
                  >
                    {selectedClip.reversed ? 'Reversed' : 'Forward'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      update((c) => ({
                        ...c,
                        vfx: { ...c.vfx, stabilize: !c.vfx.stabilize },
                        transform: {
                          ...c.transform,
                          scale: !c.vfx.stabilize ? Math.max(106, c.transform.scale) : 100,
                        },
                      }))
                    }
                    className={`py-1 text-[11px] rounded border cursor-pointer ${
                      selectedClip.vfx.stabilize
                        ? 'bg-[#3B82F6]/20 border-[#3B82F6] text-white'
                        : 'bg-[#121215] border-[#2B2B34] text-[#A1A1AF]'
                    }`}
                  >
                    Warp Stabilize
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#8E8E9B] mb-1">In Transition</label>
                    <select
                      value={selectedClip.transitionIn.type}
                      onChange={(e) =>
                        update((c) => ({
                          ...c,
                          transitionIn: { ...c.transitionIn, type: e.target.value as TransitionType, duration: c.transitionIn.duration || 0.6 },
                        }))
                      }
                      className="w-full bg-[#121215] border border-[#2B2B34] rounded px-2 py-1 text-xs text-[#E4E4EC] outline-none"
                    >
                      <option value="none">None</option>
                      {TRANSITION_CATALOG.map((t) => (
                        <option key={t.type} value={t.type}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#8E8E9B] mb-1">Out Transition</label>
                    <select
                      value={selectedClip.transitionOut.type}
                      onChange={(e) =>
                        update((c) => ({
                          ...c,
                          transitionOut: { ...c.transitionOut, type: e.target.value as TransitionType, duration: c.transitionOut.duration || 0.6 },
                        }))
                      }
                      className="w-full bg-[#121215] border border-[#2B2B34] rounded px-2 py-1 text-xs text-[#E4E4EC] outline-none"
                    >
                      <option value="none">None</option>
                      {TRANSITION_CATALOG.map((t) => (
                        <option key={t.type} value={t.type}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <EmptyInspectorState icon={Sliders} label="Select a clip on the timeline to inspect Motion, Keyframes, Keying, and VFX." />
          ))}

        {activeTab === 'color' &&
          (selectedClip ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 bg-[#121215] p-0.5 rounded border border-[#27272E]">
                  {(
                    [
                      { id: 'basic', label: 'Basic' },
                      { id: 'wheels', label: 'Wheels' },
                      { id: 'hsl', label: 'Match & LUT' },
                    ] as const
                  ).map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setColorSubTab(st.id)}
                      className={`px-2 py-0.5 text-[10px] font-medium rounded cursor-pointer ${
                        colorSubTab === st.id ? 'bg-[#25252D] text-white' : 'text-[#8E8E9B]'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => update((c) => ({ ...c, color: { ...DEFAULT_COLOR_GRADE } }))}
                  className="text-[11px] text-[#7D7D8A] hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              </div>

              {colorSubTab === 'basic' && (
                <>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={colorBusy}
                      onClick={handleAutoColor}
                      className="flex-1 py-1.5 text-xs font-medium bg-[#2563EB] hover:bg-[#3B82F6] text-white rounded flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {colorBusy ? 'Analyzing...' : 'Auto Color'}
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    <SliderRow
                      label="Temperature"
                      value={selectedClip.color.temperature}
                      min={-100}
                      max={100}
                      step={1}
                      onChange={(temperature) =>
                        update((c) => ({ ...c, color: { ...c.color, temperature, presetId: 'custom' } }))
                      }
                    />
                    <SliderRow
                      label="Tint (Green / Magenta)"
                      value={selectedClip.color.tint}
                      min={-100}
                      max={100}
                      step={1}
                      onChange={(tint) =>
                        update((c) => ({ ...c, color: { ...c.color, tint, presetId: 'custom' } }))
                      }
                    />
                    <SliderRow
                      label="Exposure"
                      value={selectedClip.color.exposure}
                      min={-80}
                      max={80}
                      step={1}
                      keyframed={hasKeyframeHere('color.exposure')}
                      onToggleKeyframe={() => toggleKeyframe('color.exposure', selectedClip.color.exposure)}
                      onChange={(exposure) =>
                        update((c) => ({ ...c, color: { ...c.color, exposure, presetId: 'custom' } }))
                      }
                    />
                    <SliderRow
                      label="Contrast"
                      value={selectedClip.color.contrast}
                      min={-80}
                      max={100}
                      step={1}
                      onChange={(contrast) =>
                        update((c) => ({ ...c, color: { ...c.color, contrast, presetId: 'custom' } }))
                      }
                    />
                    <SliderRow
                      label="Highlights"
                      value={selectedClip.color.highlights}
                      min={-100}
                      max={100}
                      step={1}
                      onChange={(highlights) =>
                        update((c) => ({ ...c, color: { ...c.color, highlights } }))
                      }
                    />
                    <SliderRow
                      label="Shadows"
                      value={selectedClip.color.shadows}
                      min={-100}
                      max={100}
                      step={1}
                      onChange={(shadows) =>
                        update((c) => ({ ...c, color: { ...c.color, shadows } }))
                      }
                    />
                    <SliderRow
                      label="Vibrance"
                      value={selectedClip.color.vibrance}
                      min={-100}
                      max={100}
                      step={1}
                      onChange={(vibrance) =>
                        update((c) => ({ ...c, color: { ...c.color, vibrance } }))
                      }
                    />
                    <SliderRow
                      label="Saturation"
                      value={selectedClip.color.saturation}
                      min={-100}
                      max={120}
                      step={1}
                      onChange={(saturation) =>
                        update((c) => ({ ...c, color: { ...c.color, saturation, presetId: 'custom' } }))
                      }
                    />
                    <SliderRow
                      label="Vignette"
                      value={selectedClip.color.vignette}
                      min={0}
                      max={100}
                      step={1}
                      unit="%"
                      onChange={(vignette) => update((c) => ({ ...c, color: { ...c.color, vignette } }))}
                    />
                    <SliderRow
                      label="35mm Grain"
                      value={selectedClip.color.grain}
                      min={0}
                      max={100}
                      step={1}
                      unit="%"
                      onChange={(grain) => update((c) => ({ ...c, color: { ...c.color, grain } }))}
                    />
                  </div>
                </>
              )}

              {colorSubTab === 'wheels' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-[#8E8E9B]">
                    Drag inside the 3-way color wheels to balance Shadows, Midtones, and Highlights.
                  </p>
                  <div className="grid grid-cols-1 gap-3">
                    {(['shadows', 'midtones', 'highlights'] as const).map((zone) => (
                      <ColorWheelControl
                        key={zone}
                        label={zone.charAt(0).toUpperCase() + zone.slice(1)}
                        value={selectedClip.color.wheels[zone]}
                        onChange={(val) =>
                          update((c) => ({
                            ...c,
                            color: {
                              ...c.color,
                              wheels: { ...c.color.wheels, [zone]: val },
                            },
                          }))
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {colorSubTab === 'hsl' && (
                <div className="space-y-3">
                  <div className="p-2.5 rounded bg-[#131317] border border-[#27272E] space-y-2">
                    <div className="text-xs font-semibold text-[#D4D4DC]">AI Color Match</div>
                    <select
                      value={matchSourceId}
                      onChange={(e) => setMatchSourceId(e.target.value)}
                      className="w-full bg-[#121215] border border-[#2B2B34] rounded px-2 py-1 text-xs text-white"
                    >
                      {assets
                        .filter((a) => a.type === 'image' || a.type === 'video')
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            Ref: {a.name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={colorBusy}
                      onClick={handleColorMatch}
                      className="w-full py-1.5 text-xs font-medium bg-[#2563EB] hover:bg-[#3B82F6] text-white rounded cursor-pointer"
                    >
                      Apply Match to Reference
                    </button>
                  </div>

                  <div className="p-2.5 rounded bg-[#131317] border border-[#27272E] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#D4D4DC]">3D LUT (.cube)</span>
                      <button
                        type="button"
                        onClick={() => lutInputRef.current?.click()}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] bg-[#222229] hover:bg-[#2E2E38] border border-[#32323D] text-white rounded cursor-pointer"
                      >
                        <Upload className="w-3 h-3" />
                        Load .cube
                      </button>
                      <input
                        ref={lutInputRef}
                        type="file"
                        accept=".cube"
                        className="hidden"
                        onChange={handleUploadLut}
                      />
                    </div>
                    {selectedClip.color.customLutName && (
                      <div className="text-[11px] text-[#60A5FA] font-mono-tabular truncate">
                        Active LUT: {selectedClip.color.customLutName}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      {COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => onApplyColorPreset(preset.id)}
                          className={`p-1.5 rounded border text-left cursor-pointer ${
                            selectedClip.color.presetId === preset.id
                              ? 'border-[#3B82F6] bg-[#3B82F6]/15'
                              : 'border-[#27272E] bg-[#121216]'
                          }`}
                        >
                          <div className="flex items-center gap-0.5 mb-1">
                            {preset.swatch.map((s, i) => (
                              <span key={i} className="h-1 flex-1" style={{ backgroundColor: s }} />
                            ))}
                          </div>
                          <div className="text-[10px] font-medium text-[#E4E4EC] truncate">{preset.name}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <EmptyInspectorState icon={Sliders} label="Select a video or image clip to grade in Lumetri Color." />
          ))}

        {activeTab === 'audio' && (
          <div className="space-y-4">
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-[#D4D4DC]">Master Bus & Track Mixer</h3>
              <SliderRow label="Master Gain" value={masterVolume} min={0} max={150} step={1} unit="%" onChange={onMasterVolumeChange} />
              <div className="space-y-1.5 pt-1">
                {tracks
                  .filter((t) => t.type === 'audio')
                  .map((tr) => (
                    <div key={tr.id} className="px-2 py-1.5 rounded bg-[#131317] border border-[#25252D] flex items-center gap-2">
                      <span className="text-[11px] font-mono-tabular text-[#2DD4BF] w-6">{tr.name}</span>
                      <input
                        type="range"
                        min={0}
                        max={150}
                        step={1}
                        value={tr.gain ?? 100}
                        onChange={(e) => onUpdateTrackMixer(tr.id, { gain: parseInt(e.target.value, 10) })}
                        className="flex-1 studio-slider"
                      />
                      <span className="text-[10px] font-mono-tabular text-[#A1A1AF] w-9 text-right">
                        {tr.gain ?? 100}%
                      </span>
                    </div>
                  ))}
              </div>
            </section>

            <hr className="border-[#25252D]" />

            {selectedClip ? (
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[#D4D4DC]">Essential Sound & FX</h3>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => update((c) => ({ ...c, audio: { ...c.audio, muted: !c.audio.muted } }))}
                      className={`p-1 rounded border cursor-pointer ${
                        selectedClip.audio.muted
                          ? 'bg-[#DC2626]/20 border-[#DC2626]/50 text-[#F87171]'
                          : 'bg-[#1D1D23] border-[#2C2C35] text-[#A1A1AF]'
                      }`}
                    >
                      {selectedClip.audio.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => update((c) => ({ ...c, audio: { ...DEFAULT_AUDIO } }))}
                      className="text-[11px] text-[#7D7D8A] hover:text-white cursor-pointer"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                {/* Essential Sound Role & AI Toggles */}
                <div className="grid grid-cols-4 gap-1">
                  {(['dialogue', 'music', 'sfx', 'ambience'] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() =>
                        update((c) => ({ ...c, audio: { ...c.audio, essentialCategory: cat } }))
                      }
                      className={`py-1 text-[10px] capitalize rounded border cursor-pointer ${
                        selectedClip.audio.essentialCategory === cat
                          ? 'bg-[#14B8A6]/20 border-[#14B8A6] text-[#99F6E4]'
                          : 'bg-[#121215] border-[#27272E] text-[#8E8E9B]'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      update((c) => ({
                        ...c,
                        audio: { ...c.audio, enhanceSpeech: !c.audio.enhanceSpeech },
                      }))
                    }
                    className={`py-1.5 text-[11px] rounded border cursor-pointer ${
                      selectedClip.audio.enhanceSpeech
                        ? 'bg-[#3B82F6]/20 border-[#3B82F6] text-white'
                        : 'bg-[#121215] border-[#27272E] text-[#A1A1AF]'
                    }`}
                  >
                    Enhance Speech
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      update((c) => ({
                        ...c,
                        audio: { ...c.audio, autoDuckMusic: !c.audio.autoDuckMusic },
                      }))
                    }
                    className={`py-1.5 text-[11px] rounded border cursor-pointer ${
                      selectedClip.audio.autoDuckMusic
                        ? 'bg-[#14B8A6]/20 border-[#14B8A6] text-white'
                        : 'bg-[#121215] border-[#27272E] text-[#A1A1AF]'
                    }`}
                  >
                    Auto Ducking
                  </button>
                </div>

                <SliderRow
                  label="Volume"
                  value={selectedClip.audio.volume}
                  min={0}
                  max={200}
                  step={1}
                  unit="%"
                  keyframed={hasKeyframeHere('audio.volume')}
                  onToggleKeyframe={() => toggleKeyframe('audio.volume', selectedClip.audio.volume)}
                  onChange={(volume) => update((c) => ({ ...c, audio: { ...c.audio, volume } }))}
                />
                <SliderRow
                  label="Stereo Pan"
                  value={selectedClip.audio.pan}
                  min={-100}
                  max={100}
                  step={2}
                  onChange={(pan) => update((c) => ({ ...c, audio: { ...c.audio, pan } }))}
                />
                <SliderRow
                  label="Fade In"
                  value={Number(selectedClip.audio.fadeIn.toFixed(2))}
                  min={0}
                  max={Math.min(5, selectedClip.duration / 2)}
                  step={0.1}
                  unit="s"
                  onChange={(fadeIn) => update((c) => ({ ...c, audio: { ...c.audio, fadeIn } }))}
                />
                <SliderRow
                  label="Fade Out"
                  value={Number(selectedClip.audio.fadeOut.toFixed(2))}
                  min={0}
                  max={Math.min(5, selectedClip.duration / 2)}
                  step={0.1}
                  unit="s"
                  onChange={(fadeOut) => update((c) => ({ ...c, audio: { ...c.audio, fadeOut } }))}
                />

                <div className="pt-1 space-y-2 border-t border-[#25252D]">
                  <div className="text-[11px] font-semibold text-[#C8C8D2]">3-Band EQ & Dynamics</div>
                  <SliderRow
                    label="Low Shelf (140Hz)"
                    value={selectedClip.audio.eqLow}
                    min={-12}
                    max={12}
                    step={1}
                    unit="dB"
                    onChange={(eqLow) => update((c) => ({ ...c, audio: { ...c.audio, eqLow } }))}
                  />
                  <SliderRow
                    label="Mid Peak (1.2kHz)"
                    value={selectedClip.audio.eqMid}
                    min={-12}
                    max={12}
                    step={1}
                    unit="dB"
                    onChange={(eqMid) => update((c) => ({ ...c, audio: { ...c.audio, eqMid } }))}
                  />
                  <SliderRow
                    label="High Shelf (4.8kHz)"
                    value={selectedClip.audio.eqHigh}
                    min={-12}
                    max={12}
                    step={1}
                    unit="dB"
                    onChange={(eqHigh) => update((c) => ({ ...c, audio: { ...c.audio, eqHigh } }))}
                  />
                  <SliderRow
                    label="Compressor"
                    value={selectedClip.audio.compressor}
                    min={0}
                    max={100}
                    step={2}
                    unit="%"
                    onChange={(compressor) => update((c) => ({ ...c, audio: { ...c.audio, compressor } }))}
                  />
                  <SliderRow
                    label="Room Reverb / Delay"
                    value={selectedClip.audio.reverb}
                    min={0}
                    max={100}
                    step={2}
                    unit="%"
                    onChange={(reverb) => update((c) => ({ ...c, audio: { ...c.audio, reverb } }))}
                  />
                </div>
              </section>
            ) : (
              <EmptyInspectorState icon={Volume2} label="Select an audio clip to edit EQ, Compressor, Reverb, and Essential Sound." />
            )}
          </div>
        )}

        {activeTab === 'graphics' &&
          (selectedClip?.type === 'title' && selectedClip.text ? (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-[#D4D4DC]">Essential Graphics</h3>

              <div>
                <label className="block text-[11px] text-[#8E8E9B] mb-1">Primary Text</label>
                <textarea
                  rows={2}
                  value={selectedClip.text.text}
                  onChange={(e) =>
                    update((c) => ({
                      ...c,
                      name: e.target.value.split('\n')[0] || 'Title Graphic',
                      text: c.text ? { ...c.text, text: e.target.value } : undefined,
                    }))
                  }
                  className="w-full bg-[#121215] border border-[#2B2B34] focus:border-[#3B82F6] rounded px-2.5 py-1.5 text-xs text-white outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[#8E8E9B] mb-1">Subtitle / Kicker</label>
                <input
                  type="text"
                  value={selectedClip.text.subtitle || ''}
                  onChange={(e) =>
                    update((c) => ({
                      ...c,
                      text: c.text ? { ...c.text, subtitle: e.target.value } : undefined,
                    }))
                  }
                  className="w-full bg-[#121215] border border-[#2B2B34] focus:border-[#3B82F6] rounded px-2.5 py-1.5 text-xs text-white outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-[#8E8E9B] mb-1">Layout</label>
                  <select
                    value={selectedClip.text.layout}
                    onChange={(e) =>
                      update((c) => ({
                        ...c,
                        text: c.text
                          ? { ...c.text, layout: e.target.value as NonNullable<TimelineClip['text']>['layout'] }
                          : undefined,
                      }))
                    }
                    className="w-full bg-[#121215] border border-[#2B2B34] rounded px-2 py-1 text-xs text-[#E4E4EC] outline-none"
                  >
                    <option value="center-title">Center Title</option>
                    <option value="lower-third">Lower Third</option>
                    <option value="caption">Subtitle Bar</option>
                    <option value="editorial-card">Editorial Card</option>
                    <option value="shape-rect">Vector Rectangle</option>
                    <option value="shape-circle">Vector Circle</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-[#8E8E9B] mb-1">Animation</label>
                  <select
                    value={selectedClip.text.animation || 'none'}
                    onChange={(e) =>
                      update((c) => ({
                        ...c,
                        text: c.text
                          ? {
                              ...c.text,
                              animation: e.target.value as NonNullable<TimelineClip['text']>['animation'],
                            }
                          : undefined,
                      }))
                    }
                    className="w-full bg-[#121215] border border-[#2B2B34] rounded px-2 py-1 text-xs text-[#E4E4EC] outline-none"
                  >
                    <option value="none">None</option>
                    <option value="fade-up">Fade & Rise</option>
                    <option value="typewriter">Typewriter</option>
                    <option value="scale-pop">Scale Pop</option>
                    <option value="slide-in">Slide In</option>
                  </select>
                </div>
              </div>

              <SliderRow
                label="Font Size"
                value={selectedClip.text.fontSize}
                min={18}
                max={140}
                step={2}
                unit="px"
                onChange={(fontSize) =>
                  update((c) => ({ ...c, text: c.text ? { ...c.text, fontSize } : undefined }))
                }
              />

              <SliderRow
                label="Outline Stroke"
                value={selectedClip.text.strokeWidth || 0}
                min={0}
                max={12}
                step={1}
                unit="px"
                onChange={(strokeWidth) =>
                  update((c) => ({ ...c, text: c.text ? { ...c.text, strokeWidth } : undefined }))
                }
              />

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-[#8E8E9B] mb-1">Fill</label>
                  <input
                    type="color"
                    value={selectedClip.text.color}
                    onChange={(e) =>
                      update((c) => ({ ...c, text: c.text ? { ...c.text, color: e.target.value } : undefined }))
                    }
                    className="w-full h-7 bg-[#121215] border border-[#2B2B34] rounded cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#8E8E9B] mb-1">Gradient</label>
                  <input
                    type="color"
                    value={selectedClip.text.gradientEndColor || '#3B82F6'}
                    onChange={(e) =>
                      update((c) => ({
                        ...c,
                        text: c.text
                          ? { ...c.text, gradientEnabled: true, gradientEndColor: e.target.value }
                          : undefined,
                      }))
                    }
                    className="w-full h-7 bg-[#121215] border border-[#2B2B34] rounded cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#8E8E9B] mb-1">Outline</label>
                  <input
                    type="color"
                    value={selectedClip.text.strokeColor || '#000000'}
                    onChange={(e) =>
                      update((c) => ({
                        ...c,
                        text: c.text ? { ...c.text, strokeColor: e.target.value } : undefined,
                      }))
                    }
                    className="w-full h-7 bg-[#121215] border border-[#2B2B34] rounded cursor-pointer"
                  />
                </div>
              </div>

              <SliderRow
                label="Backdrop Opacity"
                value={selectedClip.text.bgOpacity}
                min={0}
                max={100}
                step={2}
                unit="%"
                onChange={(bgOpacity) =>
                  update((c) => ({ ...c, text: c.text ? { ...c.text, bgOpacity } : undefined }))
                }
              />
            </div>
          ) : (
            <div className="space-y-3 text-center py-6">
              <Type className="w-6 h-6 text-[#6F6F7D] mx-auto" />
              <p className="text-xs text-[#8E8E9B]">
                Select a Title/Shape clip on the timeline or insert a new graphic at the playhead.
              </p>
              <button
                type="button"
                onClick={onInsertTitleAtPlayhead}
                className="px-3 py-1.5 text-xs font-medium bg-[#7C3AED] hover:bg-[#8B5CF6] text-white rounded cursor-pointer"
              >
                New Title at Playhead
              </button>
            </div>
          ))}

        {activeTab === 'ai' && (
          <AiAndTextTab
            playhead={playhead}
            sequence={sequence}
            clips={clips}
            assets={assets}
            selectedClip={selectedClip}
            captions={captions}
            onUpdateCaptions={onUpdateCaptions}
            onExecuteAiActions={onExecuteAiActions}
            onAddGeneratedVoiceover={onAddGeneratedVoiceover}
            onSplitClipMultiple={onSplitClipMultiple}
            onRemixMusicToSequence={onRemixMusicToSequence}
            onSeek={onSeek}
          />
        )}

        {activeTab === 'review' && (
          <ReviewAndVersionsTab
            playhead={playhead}
            sequence={sequence}
            comments={comments}
            versions={versions}
            onAddComment={onAddReviewComment}
            onToggleResolveComment={onToggleResolveComment}
            onDeleteComment={onDeleteReviewComment}
            onSaveVersion={onSaveVersion}
            onRestoreVersion={onRestoreVersion}
            onSeek={onSeek}
          />
        )}
      </div>
    </aside>
  );
}

function ColorWheelControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ColorWheelValue;
  onChange: (val: ColorWheelValue) => void;
}) {
  const handleWheelDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const updateFromEvent = (ev: MouseEvent | React.MouseEvent) => {
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const r = rect.width / 2;
      let dx = (ev.clientX - cx) / r;
      let dy = (ev.clientY - cy) / r;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      onChange({ ...value, x: Number(dx.toFixed(2)), y: Number(dy.toFixed(2)) });
    };
    updateFromEvent(e);
    const onMove = (ev: MouseEvent) => updateFromEvent(ev);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="p-2 rounded bg-[#131317] border border-[#25252D] flex items-center gap-3">
      <div
        onMouseDown={handleWheelDrag}
        className="w-16 h-16 rounded-full relative shrink-0 cursor-crosshair border border-[#32323D]"
        style={{
          background:
            'conic-gradient(from 0deg, #ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)',
        }}
      >
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(24,24,28,0.85) 0%, rgba(24,24,28,0.15) 70%)' }}
        />
        <div
          className="w-2.5 h-2.5 rounded-full bg-white border border-black absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            left: `${50 + value.x * 42}%`,
            top: `${50 + value.y * 42}%`,
          }}
        />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-medium text-[#E4E4EC]">{label}</span>
          <button
            type="button"
            onClick={() => onChange({ x: 0, y: 0, luma: 0 })}
            className="text-[10px] text-[#7D7D8A] hover:text-white cursor-pointer"
          >
            Reset
          </button>
        </div>
        <div className="text-[10px] font-mono-tabular text-[#8E8E9B]">
          X: {value.x.toFixed(2)} · Y: {value.y.toFixed(2)}
        </div>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  keyframed,
  onToggleKeyframe,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  keyframed?: boolean;
  onToggleKeyframe?: () => void;
  onChange: (val: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {onToggleKeyframe && (
            <button
              type="button"
              onClick={onToggleKeyframe}
              title="Toggle Keyframe at Playhead"
              className={`cursor-pointer ${
                keyframed ? 'text-[#3B82F6]' : 'text-[#52525E] hover:text-[#A1A1AF]'
              }`}
            >
              <Diamond className="w-3 h-3" fill={keyframed ? 'currentColor' : 'none'} />
            </button>
          )}
          <span className="text-[#9E9EAB] truncate">{label}</span>
        </div>
        <span className="font-mono-tabular text-[#E4E4EC] shrink-0">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full studio-slider"
      />
    </div>
  );
}

function EmptyInspectorState({
  icon: Icon,
  label,
}: {
  icon: typeof Sliders;
  label: string;
}) {
  return (
    <div className="py-10 px-4 text-center space-y-2">
      <Icon className="w-6 h-6 text-[#585865] mx-auto" />
      <p className="text-xs text-[#8E8E9B] leading-relaxed">{label}</p>
    </div>
  );
}
