import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Copy,
  Eye,
  EyeOff,
  FolderArchive,
  Grid,
  Hand,
  Keyboard,
  Lock,
  Magnet,
  Maximize,
  Mic,
  MousePointer,
  MoveHorizontal,
  Plus,
  Redo2,
  RotateCcw,
  Scissors,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  ClipLabelColor,
  ClipMarker,
  MediaAsset,
  SequenceSettings,
  TimelineClip,
  ToolMode,
  Track,
  TransitionType,
} from '../types/editor';
import { clamp, formatTimecode, getRulerStep } from '../utils/timecode';

interface TimelinePanelProps {
  tracks: Track[];
  clips: TimelineClip[];
  markers: ClipMarker[];
  assetsMap: Map<string, MediaAsset>;
  sequence: SequenceSettings;
  playhead: number;
  totalDuration: number;
  selectedClipId: string | null;
  toolMode: ToolMode;
  snapEnabled: boolean;
  pixelsPerSecond: number;
  inPoint: number | null;
  outPoint: number | null;
  canUndo: boolean;
  canRedo: boolean;
  getMeterLevels: () => [number, number];
  onToolChange: (tool: ToolMode) => void;
  onToggleSnap: () => void;
  onZoomChange: (pps: number) => void;
  onSeek: (time: number) => void;
  onSelectClip: (clipId: string | null) => void;
  onMoveClip: (clipId: string, newStart: number, newTrackId: string, commitHistory: boolean, mode?: ToolMode) => void;
  onTrimClip: (
    clipId: string,
    edge: 'left' | 'right',
    newStart: number,
    newDuration: number,
    newInPoint: number,
    commitHistory: boolean,
    mode?: ToolMode
  ) => void;
  onSlipClip: (clipId: string, newInPoint: number, commitHistory: boolean) => void;
  onSplitClipAt: (clipId: string, time: number) => void;
  onSplitAtPlayhead: () => void;
  onDeleteSelectedClip: (ripple?: boolean) => void;
  onDuplicateSelectedClip: () => void;
  onNestSelectedClip: () => void;
  onToggleTrackProp: (trackId: string, prop: 'visible' | 'muted' | 'solo' | 'locked' | 'targeted') => void;
  onAddTrack: (type: 'video' | 'audio') => void;
  onDropAssetOnTrack: (assetId: string, trackId: string, startTime: number) => void;
  onDropTransitionOnClip: (clipId: string, edge: 'in' | 'out', type: TransitionType) => void;
  onInsertTitleAt: (trackId: string, startTime: number) => void;
  onRecordedVoiceover: (blob: Blob, startAt: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onResetProject: () => void;
  onOpenShortcuts: () => void;
}

type DragState =
  | {
      kind: 'move';
      clipId: string;
      originX: number;
      originStart: number;
      originTrackId: string;
      clipDuration: number;
      clipType: TimelineClip['type'];
    }
  | {
      kind: 'slip';
      clipId: string;
      originX: number;
      originInPoint: number;
      speed: number;
      maxAssetDuration: number;
      clipDuration: number;
    }
  | {
      kind: 'trim-left';
      clipId: string;
      originX: number;
      originStart: number;
      originDuration: number;
      originInPoint: number;
      speed: number;
    }
  | {
      kind: 'trim-right';
      clipId: string;
      originX: number;
      originStart: number;
      originDuration: number;
      maxAssetDuration: number;
      originInPoint: number;
      speed: number;
    }
  | { kind: 'scrub' }
  | { kind: 'pan'; originX: number; originScrollLeft: number };

type GridIncrementMode = 'auto' | 'frame' | '0.25s' | '0.5s' | '1s' | 'beat';

const CLIP_LABEL_COLORS: Record<ClipLabelColor, string> = {
  blue: 'bg-[#182B49] border-[#3B82F6]/55 text-[#E0F2FE]',
  teal: 'bg-[#0F3835] border-[#14B8A6]/50 text-[#CCFBF1]',
  violet: 'bg-[#2E1E4A] border-[#8B5CF6]/55 text-[#EDE9FE]',
  amber: 'bg-[#362819] border-[#F59E0B]/55 text-[#FEF3C7]',
  rose: 'bg-[#3E1826] border-[#F43F5E]/55 text-[#FFE4E6]',
  forest: 'bg-[#123323] border-[#10B981]/55 text-[#D1FAE5]',
};

export function TimelinePanel({
  tracks,
  clips,
  markers,
  assetsMap,
  sequence,
  playhead,
  totalDuration,
  selectedClipId,
  toolMode,
  snapEnabled,
  pixelsPerSecond,
  inPoint,
  outPoint,
  canUndo,
  canRedo,
  getMeterLevels,
  onToolChange,
  onToggleSnap,
  onZoomChange,
  onSeek,
  onSelectClip,
  onMoveClip,
  onTrimClip,
  onSlipClip,
  onSplitClipAt,
  onSplitAtPlayhead,
  onDeleteSelectedClip,
  onDuplicateSelectedClip,
  onNestSelectedClip,
  onToggleTrackProp,
  onAddTrack,
  onDropAssetOnTrack,
  onDropTransitionOnClip,
  onInsertTitleAt,
  onRecordedVoiceover,
  onUndo,
  onRedo,
  onResetProject,
  onOpenShortcuts,
}: TimelinePanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const trackAreaRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordStartTimeRef = useRef(0);

  const [razorHoverTime, setRazorHoverTime] = useState<number | null>(null);
  const [snapLineTime, setSnapLineTime] = useState<number | null>(null);
  const [meterLevels, setMeterLevels] = useState<[number, number]>([0, 0]);
  const [isRecordingVo, setIsRecordingVo] = useState(false);
  const [gridOverlayEnabled, setGridOverlayEnabled] = useState(true);
  const [gridMode, setGridMode] = useState<GridIncrementMode>('auto');
  const [gridBpm, setGridBpm] = useState(120);

  const timelineSpanSeconds = Math.max(totalDuration + 12, 35);
  const timelineWidthPx = Math.round(timelineSpanSeconds * pixelsPerSecond);
  const isGridVisible = snapEnabled && gridOverlayEnabled;
  const { major, minor } = getRulerStep(pixelsPerSecond);

  const gridMetrics = useMemo(() => {
    const safeFps = Math.max(1, sequence.fps || 24);
    const safeBpm = clamp(Number.isFinite(gridBpm) ? gridBpm : 120, 40, 240);
    let minorSec = minor;
    let majorSec = major;

    if (gridMode === 'frame') {
      minorSec = 1 / safeFps;
      majorSec = 1;
    } else if (gridMode === '0.25s') {
      minorSec = 0.25;
      majorSec = 1;
    } else if (gridMode === '0.5s') {
      minorSec = 0.5;
      majorSec = 2;
    } else if (gridMode === '1s') {
      minorSec = 1;
      majorSec = 5;
    } else if (gridMode === 'beat') {
      minorSec = 60 / safeBpm;
      majorSec = minorSec * 4;
    }

    const rawMinorPx = minorSec * pixelsPerSecond;
    const visualStride = rawMinorPx < 6 ? Math.ceil(6 / Math.max(0.1, rawMinorPx)) : 1;
    const visualMinorPx = rawMinorPx * visualStride;
    const majorPx = Math.max(visualMinorPx, majorSec * pixelsPerSecond);

    return {
      minorSec,
      majorSec,
      visualMinorPx,
      majorPx,
    };
  }, [gridMode, gridBpm, sequence.fps, major, minor, pixelsPerSecond]);

  useEffect(() => {
    let rafId = 0;
    const updateMeter = () => {
      const [l, r] = getMeterLevels();
      setMeterLevels((prev) => {
        if (Math.abs(prev[0] - l) < 0.01 && Math.abs(prev[1] - r) < 0.01 && l === 0 && r === 0) {
          return prev;
        }
        return [l, r];
      });
      rafId = requestAnimationFrame(updateMeter);
    };
    rafId = requestAnimationFrame(updateMeter);
    return () => cancelAnimationFrame(rafId);
  }, [getMeterLevels]);

  const snapPoints = useMemo(() => {
    const pts = new Set<number>([0, playhead]);
    if (inPoint !== null) pts.add(inPoint);
    if (outPoint !== null) pts.add(outPoint);
    for (const m of markers) pts.add(m.time);
    for (const c of clips) {
      pts.add(c.start);
      pts.add(c.start + c.duration);
    }
    return Array.from(pts);
  }, [clips, markers, playhead, inPoint, outPoint]);

  const findSnappedTime = (candidate: number, excludeClipId?: string): { time: number; snapped: number | null } => {
    if (!snapEnabled) return { time: Math.max(0, candidate), snapped: null };
    const thresholdSec = 10 / pixelsPerSecond;
    let best = candidate;
    let bestDist = thresholdSec;
    let snappedVal: number | null = null;

    for (const pt of snapPoints) {
      if (excludeClipId) {
        const selfClip = clips.find((c) => c.id === excludeClipId);
        if (selfClip && (Math.abs(pt - selfClip.start) < 0.001 || Math.abs(pt - (selfClip.start + selfClip.duration)) < 0.001)) {
          continue;
        }
      }
      const dist = Math.abs(candidate - pt);
      if (dist < bestDist) {
        bestDist = dist;
        best = pt;
        snappedVal = pt;
      }
    }

    if (isGridVisible && gridMetrics.minorSec > 0) {
      const nearestGrid = Math.max(0, Math.round(candidate / gridMetrics.minorSec) * gridMetrics.minorSec);
      const gridDist = Math.abs(candidate - nearestGrid);
      if (gridDist < bestDist) {
        bestDist = gridDist;
        best = nearestGrid;
        snappedVal = nearestGrid;
      }
    }

    return { time: Math.max(0, best), snapped: snappedVal };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (drag.kind === 'scrub') {
        const rect = trackAreaRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = clamp(e.clientX - rect.left, 0, timelineWidthPx);
        onSeek(x / pixelsPerSecond);
        return;
      }

      if (drag.kind === 'pan') {
        const scroller = scrollContainerRef.current;
        if (!scroller) return;
        scroller.scrollLeft = drag.originScrollLeft - (e.clientX - drag.originX);
        return;
      }

      const deltaSec = (e.clientX - drag.originX) / pixelsPerSecond;

      if (drag.kind === 'slip') {
        const maxIn = drag.maxAssetDuration > 0 ? Math.max(0, drag.maxAssetDuration - drag.clipDuration * drag.speed) : 60;
        const nextIn = clamp(drag.originInPoint - deltaSec * drag.speed, 0, maxIn);
        onSlipClip(drag.clipId, nextIn, false);
        return;
      }

      if (drag.kind === 'move') {
        const rawStart = Math.max(0, drag.originStart + deltaSec);
        const snapStart = findSnappedTime(rawStart, drag.clipId);
        const snapEnd = findSnappedTime(rawStart + drag.clipDuration, drag.clipId);

        let finalStart = rawStart;
        let snappedAt: number | null = null;
        if (snapStart.snapped !== null) {
          finalStart = snapStart.time;
          snappedAt = snapStart.snapped;
        } else if (snapEnd.snapped !== null) {
          finalStart = Math.max(0, snapEnd.time - drag.clipDuration);
          snappedAt = snapEnd.snapped;
        }
        setSnapLineTime(snappedAt);

        let targetTrackId = drag.originTrackId;
        const trackAreaEl = trackAreaRef.current;
        if (trackAreaEl && toolMode !== 'slide') {
          const rows = trackAreaEl.querySelectorAll<HTMLElement>('[data-track-id]');
          const isAudioClip = drag.clipType === 'audio';
          for (const row of rows) {
            const r = row.getBoundingClientRect();
            if (e.clientY >= r.top && e.clientY <= r.bottom) {
              const candidateTrackId = row.dataset.trackId;
              const candidateTrack = tracks.find((t) => t.id === candidateTrackId);
              if (
                candidateTrack &&
                !candidateTrack.locked &&
                ((isAudioClip && candidateTrack.type === 'audio') ||
                  (!isAudioClip && candidateTrack.type === 'video'))
              ) {
                targetTrackId = candidateTrack.id;
              }
              break;
            }
          }
        }

        onMoveClip(drag.clipId, finalStart, targetTrackId, false, toolMode);
        return;
      }

      if (drag.kind === 'trim-left') {
        const maxDelta = drag.originDuration - 0.15;
        const minDelta = -Math.min(drag.originStart, drag.originInPoint / drag.speed);
        const clampedDelta = clamp(deltaSec, minDelta, maxDelta);
        const rawNewStart = drag.originStart + clampedDelta;
        const snapped = findSnappedTime(rawNewStart, drag.clipId);
        const finalStart = clamp(snapped.time, drag.originStart + minDelta, drag.originStart + maxDelta);
        const actualDelta = finalStart - drag.originStart;
        setSnapLineTime(snapped.snapped);
        onTrimClip(
          drag.clipId,
          'left',
          finalStart,
          drag.originDuration - actualDelta,
          Math.max(0, drag.originInPoint + actualDelta * drag.speed),
          false,
          toolMode
        );
        return;
      }

      if (drag.kind === 'trim-right') {
        const rawEnd = drag.originStart + Math.max(0.15, drag.originDuration + deltaSec);
        const snapped = findSnappedTime(rawEnd, drag.clipId);
        setSnapLineTime(snapped.snapped);
        let newDuration = Math.max(0.15, snapped.time - drag.originStart);
        if (drag.maxAssetDuration > 0) {
          const maxTimelineDur = (drag.maxAssetDuration - drag.originInPoint) / drag.speed;
          newDuration = Math.min(newDuration, Math.max(0.15, maxTimelineDur));
        }
        onTrimClip(drag.clipId, 'right', drag.originStart, newDuration, drag.originInPoint, false, toolMode);
      }
    };

    const handleMouseUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === 'move') {
        const clip = clips.find((c) => c.id === drag.clipId);
        if (clip) onMoveClip(clip.id, clip.start, clip.trackId, true, toolMode);
      } else if (drag.kind === 'slip') {
        const clip = clips.find((c) => c.id === drag.clipId);
        if (clip) onSlipClip(clip.id, clip.inPoint, true);
      } else if (drag.kind === 'trim-left' || drag.kind === 'trim-right') {
        const clip = clips.find((c) => c.id === drag.clipId);
        if (clip) {
          onTrimClip(
            clip.id,
            drag.kind === 'trim-left' ? 'left' : 'right',
            clip.start,
            clip.duration,
            clip.inPoint,
            true,
            toolMode
          );
        }
      }
      dragRef.current = null;
      setSnapLineTime(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [clips, tracks, pixelsPerSecond, timelineWidthPx, snapEnabled, snapPoints, toolMode, isGridVisible, gridMetrics.minorSec]);

  const rulerTicks = useMemo(() => {
    const arr: Array<{ time: number; isMajor: boolean }> = [];
    for (let t = 0; t <= timelineSpanSeconds; t = Number((t + minor).toFixed(3))) {
      const isMajor = Math.abs(t % major) < 0.001 || Math.abs((t % major) - major) < 0.001;
      arr.push({ time: t, isMajor });
    }
    return arr;
  }, [timelineSpanSeconds, major, minor]);

  const beatRulerTicks = useMemo(() => {
    if (!isGridVisible || gridMode !== 'beat' || gridMetrics.minorSec <= 0) return [];
    const arr: Array<{ time: number; beatIndex: number; isBar: boolean }> = [];
    const maxBeats = Math.min(2000, Math.floor(timelineSpanSeconds / gridMetrics.minorSec));
    for (let i = 0; i <= maxBeats; i++) {
      arr.push({
        time: i * gridMetrics.minorSec,
        beatIndex: i,
        isBar: i % 4 === 0,
      });
    }
    return arr;
  }, [isGridVisible, gridMode, gridMetrics.minorSec, timelineSpanSeconds]);

  const handleFitSequence = () => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;
    const availWidth = Math.max(400, scroller.clientWidth - 40);
    const targetPps = clamp(availWidth / Math.max(8, totalDuration + 2), 18, 160);
    onZoomChange(Math.round(targetPps));
  };

  const handleToggleVoiceoverRecord = async () => {
    if (isRecordingVo && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecordingVo(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recordStartTimeRef.current = playhead;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        onRecordedVoiceover(blob, recordStartTimeRef.current);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setIsRecordingVo(true);
    } catch {
      setIsRecordingVo(false);
    }
  };

  return (
    <section className="h-full bg-[#16161A] border-t border-[#27272E] flex flex-col select-none min-h-0 overflow-hidden">
      {/* Timeline Top Action Bar */}
      <div className="h-9 px-3 bg-[#141418] border-b border-[#27272E] flex items-center justify-between gap-4 shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            title="Undo (Ctrl+Z)"
            className="p-1.5 rounded text-[#A1A1AF] hover:text-white hover:bg-[#24242C] disabled:opacity-35 cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            title="Redo (Ctrl+Shift+Z)"
            className="p-1.5 rounded text-[#A1A1AF] hover:text-white hover:bg-[#24242C] disabled:opacity-35 cursor-pointer"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>

          <span className="h-4 w-[1px] bg-[#2A2A32] mx-1" />

          <button
            type="button"
            onClick={onToggleSnap}
            title="Toggle Snapping & Grid (S)"
            className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border whitespace-nowrap shrink-0 cursor-pointer ${
              snapEnabled
                ? 'bg-[#3B82F6]/15 border-[#3B82F6]/50 text-[#93C5FD]'
                : 'bg-[#1D1D23] border-[#2C2C35] text-[#8E8E9B] hover:text-white'
            }`}
          >
            <Magnet className="w-3 h-3" />
            Snap
          </button>

          <button
            type="button"
            onClick={() => {
              if (!snapEnabled) {
                setGridOverlayEnabled(true);
                onToggleSnap();
              } else {
                setGridOverlayEnabled((prev) => !prev);
              }
            }}
            title={
              snapEnabled
                ? 'Toggle Visual Snap Grid Overlay'
                : 'Enable Snap & Visual Grid Overlay'
            }
            className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border whitespace-nowrap shrink-0 cursor-pointer ${
              isGridVisible
                ? 'bg-[#38BDF8]/15 border-[#38BDF8]/45 text-[#7DD3FC]'
                : 'bg-[#1D1D23] border-[#2C2C35] text-[#8E8E9B] hover:text-white'
            }`}
          >
            <Grid className="w-3 h-3" />
            Grid
          </button>

          <select
            value={gridMode}
            onChange={(e) => setGridMode(e.target.value as GridIncrementMode)}
            aria-label="Grid Alignment Increment"
            title="Grid Alignment Increment"
            className="h-6 px-1.5 text-[11px] font-mono-tabular bg-[#1D1D23] border border-[#2C2C35] rounded text-[#D4D4DC] focus:outline-none focus:border-[#3B82F6] shrink-0 cursor-pointer"
          >
            <option value="auto">Auto</option>
            <option value="frame">Frame</option>
            <option value="0.25s">0.25s</option>
            <option value="0.5s">0.5s</option>
            <option value="1s">1.0s</option>
            <option value="beat">Beats</option>
          </select>

          {gridMode === 'beat' && (
            <label className="flex items-center gap-1 px-1.5 h-6 bg-[#1D1D23] border border-[#2C2C35] rounded text-[10px] font-mono-tabular text-[#9CA3AF] shrink-0">
              <input
                type="number"
                min={40}
                max={240}
                step={1}
                value={gridBpm}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!Number.isNaN(val)) setGridBpm(clamp(val, 40, 240));
                }}
                aria-label="Grid Tempo BPM"
                className="w-10 bg-transparent text-[#F3F4F6] text-right focus:outline-none tabular-nums"
              />
              <span>BPM</span>
            </label>
          )}

          <button
            type="button"
            onClick={onSplitAtPlayhead}
            title="Split Clip at Playhead"
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-[#1D1D23] hover:bg-[#282830] border border-[#2C2C35] text-[#D4D4DC] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Scissors className="w-3 h-3 text-[#60A5FA]" />
            Split
          </button>

          <button
            type="button"
            disabled={!selectedClipId}
            onClick={onDuplicateSelectedClip}
            title="Duplicate Clip (Ctrl+D)"
            className="p-1.5 rounded text-[#A1A1AF] hover:text-white hover:bg-[#24242C] disabled:opacity-35 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            disabled={!selectedClipId}
            onClick={onNestSelectedClip}
            title="Nest Selection into Compound Sequence"
            className="p-1.5 rounded text-[#A1A1AF] hover:text-white hover:bg-[#24242C] disabled:opacity-35 cursor-pointer"
          >
            <FolderArchive className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            disabled={!selectedClipId}
            onClick={() => onDeleteSelectedClip(false)}
            title="Lift Delete (Backspace)"
            className="p-1.5 rounded text-[#A1A1AF] hover:text-[#F87171] hover:bg-[#24242C] disabled:opacity-35 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            disabled={!selectedClipId}
            onClick={() => onDeleteSelectedClip(true)}
            title="Ripple Extract (Shift+Delete)"
            className="px-2 py-1 text-[10px] font-medium rounded bg-[#1D1D23] hover:bg-[#2B1D22] border border-[#2C2C35] text-[#A1A1AF] hover:text-[#FCA5A5] disabled:opacity-35 whitespace-nowrap cursor-pointer"
          >
            Extract
          </button>

          <span className="h-4 w-[1px] bg-[#2A2A32] mx-1" />

          <button
            type="button"
            onClick={handleToggleVoiceoverRecord}
            title="Record Voiceover Microphone to Track A2"
            className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border whitespace-nowrap shrink-0 cursor-pointer ${
              isRecordingVo
                ? 'bg-[#DC2626] border-[#EF4444] text-white'
                : 'bg-[#1D1D23] border-[#2C2C35] text-[#D4D4DC] hover:text-white'
            }`}
          >
            {isRecordingVo ? <Square className="w-3 h-3" /> : <Mic className="w-3 h-3 text-[#EF4444]" />}
            {isRecordingVo ? 'Stop VO' : 'Record VO'}
          </button>

          <button
            type="button"
            onClick={() => onAddTrack('video')}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-[#A1A1AF] hover:text-white hover:bg-[#24242C] rounded whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            V
          </button>
          <button
            type="button"
            onClick={() => onAddTrack('audio')}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-[#A1A1AF] hover:text-white hover:bg-[#24242C] rounded whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            A
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenShortcuts}
            title="Keyboard Shortcuts"
            className="p-1.5 rounded text-[#8E8E9B] hover:text-white hover:bg-[#24242C] cursor-pointer"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onResetProject}
            title="Reset Sample Sequence"
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-[#8E8E9B] hover:text-white hover:bg-[#24242C] rounded whitespace-nowrap cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>

          <span className="h-4 w-[1px] bg-[#2A2A32]" />

          <button
            type="button"
            onClick={() => onZoomChange(clamp(pixelsPerSecond - 16, 15, 480))}
            aria-label="Zoom out timeline"
            className="p-1 text-[#8E8E9B] hover:text-white cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <input
            type="range"
            min={15}
            max={480}
            step={2}
            value={pixelsPerSecond}
            onChange={(e) => onZoomChange(parseInt(e.target.value, 10))}
            aria-label="Timeline Zoom"
            className="w-20 studio-slider"
          />
          <button
            type="button"
            onClick={() => onZoomChange(clamp(pixelsPerSecond + 16, 15, 480))}
            aria-label="Zoom in timeline"
            className="p-1 text-[#8E8E9B] hover:text-white cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleFitSequence}
            title="Fit Sequence to Timeline"
            className="p-1 rounded text-[#8E8E9B] hover:text-white hover:bg-[#24242C] cursor-pointer"
          >
            <Maximize className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Timeline Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Vertical Premiere Tool Palette (8 NLE Tools) */}
        <div className="w-10 bg-[#141418] border-r border-[#27272E] py-1.5 flex flex-col items-center gap-1 shrink-0 overflow-y-auto">
          {(
            [
              { id: 'select', icon: MousePointer, label: 'Selection Tool (V)' },
              { id: 'ripple', icon: MoveHorizontal, label: 'Ripple Edit Tool (B)' },
              { id: 'roll', icon: ArrowLeftRight, label: 'Rolling Edit Tool (N)' },
              { id: 'slip', icon: ArrowLeftRight, label: 'Slip Tool (Y)', badge: 'Y' },
              { id: 'slide', icon: MoveHorizontal, label: 'Slide Tool (U)', badge: 'U' },
              { id: 'razor', icon: Scissors, label: 'Razor Tool (C)' },
              { id: 'text', icon: Type, label: 'Type Tool (T)' },
              { id: 'hand', icon: Hand, label: 'Hand Pan Tool (H)' },
            ] as Array<{ id: ToolMode; icon: typeof MousePointer; label: string; badge?: string }>
          ).map((tool) => {
            const Icon = tool.icon;
            const active = toolMode === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                title={tool.label}
                onClick={() => onToolChange(tool.id)}
                className={`w-7 h-7 rounded flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                  active ? 'bg-[#2563EB] text-white' : 'text-[#8E8E9B] hover:text-white hover:bg-[#23232B]'
                }`}
              >
                {tool.badge ? (
                  <span className="text-[10px] font-mono-tabular font-bold">{tool.badge}</span>
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
              </button>
            );
          })}
        </div>

        {/* Fixed Track Headers Column */}
        <div className="w-36 bg-[#17171C] border-r border-[#27272E] flex flex-col shrink-0">
          <div className="h-7 px-2.5 border-b border-[#27272E] bg-[#141418] flex items-center justify-between text-[10px] font-mono-tabular text-[#7D7D8A] shrink-0">
            <span>Tracks</span>
            <span>{sequence.fps}fps</span>
          </div>

          <div className="flex-1 overflow-y-hidden">
            {tracks.map((track, idx) => {
              const prevTrack = tracks[idx - 1];
              const isAudioBoundary = prevTrack && prevTrack.type === 'video' && track.type === 'audio';
              return (
                <div
                  key={track.id}
                  style={{ height: `${track.height}px` }}
                  className={`px-2 flex items-center justify-between gap-1 border-b border-[#222229] bg-[#17171C] ${
                    isAudioBoundary ? 'border-t-2 border-t-[#2F2F39]' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onToggleTrackProp(track.id, 'targeted')}
                    title="Target Track for Insert/Paste"
                    className={`px-1.5 py-0.5 rounded text-[11px] font-mono-tabular font-semibold cursor-pointer ${
                      track.targeted
                        ? track.type === 'video'
                          ? 'bg-[#2563EB] text-white'
                          : 'bg-[#0D9488] text-white'
                        : track.type === 'video'
                          ? 'text-[#60A5FA] hover:bg-[#222229]'
                          : 'text-[#2DD4BF] hover:bg-[#222229]'
                    }`}
                  >
                    {track.name}
                  </button>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleTrackProp(track.id, 'locked')}
                      title={track.locked ? 'Unlock Track' : 'Lock Track'}
                      className={`p-1 rounded cursor-pointer ${
                        track.locked ? 'text-[#F59E0B]' : 'text-[#666674] hover:text-[#D4D4DC]'
                      }`}
                    >
                      {track.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                    </button>

                    {track.type === 'video' ? (
                      <button
                        type="button"
                        onClick={() => onToggleTrackProp(track.id, 'visible')}
                        title={track.visible ? 'Hide Track' : 'Show Track'}
                        className={`p-1 rounded cursor-pointer ${
                          track.visible ? 'text-[#B8B8C4] hover:text-white' : 'text-[#52525E]'
                        }`}
                      >
                        {track.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onToggleTrackProp(track.id, 'muted')}
                          title="Mute Track"
                          className={`w-5 h-5 rounded text-[10px] font-bold cursor-pointer ${
                            track.muted ? 'bg-[#DC2626] text-white' : 'text-[#8E8E9B] hover:text-white hover:bg-[#25252D]'
                          }`}
                        >
                          M
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleTrackProp(track.id, 'solo')}
                          title="Solo Track"
                          className={`w-5 h-5 rounded text-[10px] font-bold cursor-pointer ${
                            track.solo ? 'bg-[#D97706] text-white' : 'text-[#8E8E9B] hover:text-white hover:bg-[#25252D]'
                          }`}
                        >
                          S
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Scrollable Time Ruler & Track Lanes */}
        <div
          ref={scrollContainerRef}
          className={`flex-1 overflow-x-auto overflow-y-auto bg-[#121215] relative ${
            toolMode === 'hand' ? 'cursor-grab active:cursor-grabbing' : toolMode === 'razor' ? 'cursor-crosshair' : ''
          }`}
          onMouseDown={(e) => {
            if (toolMode === 'hand') {
              dragRef.current = {
                kind: 'pan',
                originX: e.clientX,
                originScrollLeft: scrollContainerRef.current?.scrollLeft || 0,
              };
            }
          }}
        >
          <div ref={trackAreaRef} className="relative min-h-full" style={{ width: `${timelineWidthPx}px` }}>
            {/* Time Ruler + Markers */}
            <div
              className="h-7 bg-[#141418] border-b border-[#27272E] sticky top-0 z-20 cursor-pointer"
              onMouseDown={(e) => {
                if (toolMode === 'hand') return;
                const rect = e.currentTarget.getBoundingClientRect();
                const x = clamp(e.clientX - rect.left, 0, timelineWidthPx);
                onSeek(x / pixelsPerSecond);
                dragRef.current = { kind: 'scrub' };
              }}
            >
              {inPoint !== null && outPoint !== null && outPoint > inPoint && (
                <div
                  className="absolute top-0 bottom-0 bg-[#3B82F6]/20 border-x border-[#60A5FA]"
                  style={{
                    left: `${inPoint * pixelsPerSecond}px`,
                    width: `${(outPoint - inPoint) * pixelsPerSecond}px`,
                  }}
                />
              )}

              {rulerTicks.map((tk) => (
                <div
                  key={tk.time}
                  className="absolute bottom-0 pointer-events-none"
                  style={{ left: `${tk.time * pixelsPerSecond}px` }}
                >
                  <div className={`w-[1px] ${tk.isMajor ? 'h-3 bg-[#5A5A68]' : 'h-1.5 bg-[#32323C]'}`} />
                  {tk.isMajor && (
                    <span className="absolute -top-3.5 left-1 text-[10px] font-mono-tabular text-[#8E8E9B] whitespace-nowrap">
                      {formatTimecode(tk.time, sequence.fps).slice(0, 8)}
                    </span>
                  )}
                </div>
              ))}

              {beatRulerTicks.map((bt) => (
                <div
                  key={bt.beatIndex}
                  className="absolute bottom-0 pointer-events-none"
                  style={{ left: `${bt.time * pixelsPerSecond}px` }}
                >
                  <div
                    className={`w-[1px] ${
                      bt.isBar ? 'h-3.5 bg-[#38BDF8]/80' : 'h-2 bg-[#38BDF8]/40'
                    }`}
                  />
                </div>
              ))}

              {/* Sequence Markers */}
              {markers.map((mk) => (
                <button
                  key={mk.id}
                  type="button"
                  title={`${mk.label}${mk.notes ? ` — ${mk.notes}` : ''}`}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onSeek(mk.time);
                  }}
                  style={{ left: `${mk.time * pixelsPerSecond}px` }}
                  className="absolute top-0.5 -translate-x-1/2 w-2.5 h-3 bg-[#F59E0B] hover:bg-[#FBBF24] rounded-b-sm cursor-pointer z-30"
                />
              ))}
            </div>

            {/* Track Lanes */}
            <div className="relative">
              {isGridVisible && (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 pointer-events-none z-[2]"
                  style={{
                    backgroundImage: [
                      `repeating-linear-gradient(to right, ${
                        gridMode === 'beat' ? 'rgba(56, 189, 248, 0.28)' : 'rgba(96, 165, 250, 0.22)'
                      } 0px, ${
                        gridMode === 'beat' ? 'rgba(56, 189, 248, 0.28)' : 'rgba(96, 165, 250, 0.22)'
                      } 1px, transparent 1px, transparent ${gridMetrics.majorPx}px)`,
                      `repeating-linear-gradient(to right, ${
                        gridMode === 'beat' ? 'rgba(56, 189, 248, 0.11)' : 'rgba(148, 163, 184, 0.10)'
                      } 0px, ${
                        gridMode === 'beat' ? 'rgba(56, 189, 248, 0.11)' : 'rgba(148, 163, 184, 0.10)'
                      } 1px, transparent 1px, transparent ${gridMetrics.visualMinorPx}px)`,
                    ].join(', '),
                  }}
                />
              )}

              {tracks.map((track, idx) => {
                const prevTrack = tracks[idx - 1];
                const isAudioBoundary = prevTrack && prevTrack.type === 'video' && track.type === 'audio';
                const trackClips = clips.filter((c) => c.trackId === track.id);

                return (
                  <div
                    key={track.id}
                    data-track-id={track.id}
                    style={{ height: `${track.height}px` }}
                    className={`relative border-b border-[#1E1E24] ${
                      track.locked ? 'bg-[#141418]/70 opacity-75' : 'bg-[#131317]'
                    } ${isAudioBoundary ? 'border-t-2 border-t-[#2F2F39]' : ''}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (track.locked) return;
                      const assetId = e.dataTransfer.getData('application/x-chmr-asset');
                      if (assetId) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const dropSec = Math.max(0, (e.clientX - rect.left) / pixelsPerSecond);
                        const snapped = findSnappedTime(dropSec);
                        onDropAssetOnTrack(assetId, track.id, snapped.time);
                      }
                    }}
                    onClick={(e) => {
                      if (toolMode === 'text' && track.type === 'video' && !track.locked) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const clickTime = Math.max(0, (e.clientX - rect.left) / pixelsPerSecond);
                        onInsertTitleAt(track.id, clickTime);
                      } else if (e.target === e.currentTarget && toolMode !== 'razor') {
                        onSelectClip(null);
                      }
                    }}
                  >
                    {trackClips.map((clip) => {
                      const asset = assetsMap.get(clip.assetId);
                      const isSelected = selectedClipId === clip.id;
                      const leftPx = clip.start * pixelsPerSecond;
                      const widthPx = Math.max(16, clip.duration * pixelsPerSecond);

                      const defaultLabel: ClipLabelColor =
                        clip.type === 'audio'
                          ? 'teal'
                          : clip.type === 'title'
                            ? 'violet'
                            : clip.type === 'adjustment' || clip.type === 'matte'
                              ? 'amber'
                              : 'blue';
                      const clipColors = CLIP_LABEL_COLORS[clip.label || defaultLabel];

                      const allKeyframes = Object.values(clip.keyframes || {}).flat();

                      return (
                        <div
                          key={clip.id}
                          style={{
                            left: `${leftPx}px`,
                            width: `${widthPx}px`,
                            top: '3px',
                            bottom: '3px',
                          }}
                          className={`absolute rounded-[3px] border overflow-hidden group transition-shadow ${clipColors} ${
                            isSelected ? 'ring-2 ring-[#F8FAFC] z-10' : 'z-[5] hover:brightness-110'
                          } ${clip.disabled ? 'opacity-40 grayscale' : ''}`}
                          onDragOver={(e) => {
                            if (e.dataTransfer.types.includes('application/x-chmr-transition')) {
                              e.preventDefault();
                            }
                          }}
                          onDrop={(e) => {
                            const trType = e.dataTransfer.getData('application/x-chmr-transition') as TransitionType;
                            if (trType) {
                              e.preventDefault();
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              const edge = e.clientX - rect.left < rect.width / 2 ? 'in' : 'out';
                              onDropTransitionOnClip(clip.id, edge, trType);
                            }
                          }}
                          onMouseMove={(e) => {
                            if (toolMode === 'razor') {
                              const rect = trackAreaRef.current?.getBoundingClientRect();
                              if (rect) setRazorHoverTime((e.clientX - rect.left) / pixelsPerSecond);
                            } else if (razorHoverTime !== null) {
                              setRazorHoverTime(null);
                            }
                          }}
                          onMouseLeave={() => {
                            if (razorHoverTime !== null) setRazorHoverTime(null);
                          }}
                          onMouseDown={(e) => {
                            if (toolMode === 'hand') return;
                            e.stopPropagation();

                            if (toolMode === 'razor') {
                              if (track.locked) return;
                              const rect = trackAreaRef.current?.getBoundingClientRect();
                              if (!rect) return;
                              const clickTime = (e.clientX - rect.left) / pixelsPerSecond;
                              onSplitClipAt(clip.id, clickTime);
                              return;
                            }

                            onSelectClip(clip.id);
                            if (track.locked) return;

                            if (toolMode === 'slip') {
                              dragRef.current = {
                                kind: 'slip',
                                clipId: clip.id,
                                originX: e.clientX,
                                originInPoint: clip.inPoint,
                                speed: clip.speed,
                                maxAssetDuration: asset?.duration || 0,
                                clipDuration: clip.duration,
                              };
                              return;
                            }

                            dragRef.current = {
                              kind: 'move',
                              clipId: clip.id,
                              originX: e.clientX,
                              originStart: clip.start,
                              originTrackId: clip.trackId,
                              clipDuration: clip.duration,
                              clipType: clip.type,
                            };
                          }}
                        >
                          {asset?.thumbnailUrl && clip.type !== 'audio' && widthPx > 36 && (
                            <div
                              className="absolute inset-0 opacity-30 pointer-events-none bg-repeat-x bg-cover"
                              style={{
                                backgroundImage: `url(${asset.thumbnailUrl})`,
                                backgroundSize: 'auto 100%',
                              }}
                            />
                          )}

                          {clip.type === 'audio' && asset?.waveform && (
                            <div className="absolute inset-x-0 bottom-0 top-4 px-0.5 flex items-end gap-[1px] pointer-events-none opacity-80">
                              {asset.waveform
                                .slice(0, Math.min(asset.waveform.length, Math.max(8, Math.floor(widthPx / 3))))
                                .map((pk, i) => (
                                  <div
                                    key={i}
                                    className="flex-1 bg-[#2DD4BF]/80 rounded-t-[1px]"
                                    style={{ height: `${Math.max(10, pk * 90)}%` }}
                                  />
                                ))}
                            </div>
                          )}

                          {clip.transitionIn.type !== 'none' && (
                            <div
                              className="absolute left-0 top-0 bottom-0 bg-white/15 border-r border-white/30 pointer-events-none"
                              style={{ width: `${Math.min(widthPx * 0.45, clip.transitionIn.duration * pixelsPerSecond)}px` }}
                            />
                          )}
                          {clip.transitionOut.type !== 'none' && (
                            <div
                              className="absolute right-0 top-0 bottom-0 bg-white/15 border-l border-white/30 pointer-events-none"
                              style={{ width: `${Math.min(widthPx * 0.45, clip.transitionOut.duration * pixelsPerSecond)}px` }}
                            />
                          )}

                          <div className="relative px-1.5 py-0.5 flex items-center justify-between gap-1 text-[10px] font-medium truncate pointer-events-none bg-black/25">
                            <span className="truncate">{clip.name}</span>
                            {clip.speed !== 1 && (
                              <span className="font-mono-tabular text-[9px] opacity-85 shrink-0">
                                {clip.speed.toFixed(1)}x
                              </span>
                            )}
                          </div>

                          {/* Keyframe Diamonds on Clip */}
                          {allKeyframes.map(
                            (kf) =>
                              kf && (
                                <span
                                  key={kf.id}
                                  style={{ left: `${clamp(kf.time, 0, clip.duration) * pixelsPerSecond}px` }}
                                  className="absolute bottom-1 w-1.5 h-1.5 bg-[#FBBF24] rotate-45 -translate-x-1/2 pointer-events-none"
                                />
                              )
                          )}

                          {/* Trim Handles (Selection / Ripple / Roll) */}
                          {(toolMode === 'select' || toolMode === 'ripple' || toolMode === 'roll') && !track.locked && (
                            <>
                              <div
                                className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/35 z-20"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  onSelectClip(clip.id);
                                  dragRef.current = {
                                    kind: 'trim-left',
                                    clipId: clip.id,
                                    originX: e.clientX,
                                    originStart: clip.start,
                                    originDuration: clip.duration,
                                    originInPoint: clip.inPoint,
                                    speed: clip.speed,
                                  };
                                }}
                              />
                              <div
                                className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/35 z-20"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  onSelectClip(clip.id);
                                  dragRef.current = {
                                    kind: 'trim-right',
                                    clipId: clip.id,
                                    originX: e.clientX,
                                    originStart: clip.start,
                                    originDuration: clip.duration,
                                    maxAssetDuration:
                                      clip.type === 'video' || clip.type === 'audio' ? asset?.duration || 0 : 0,
                                    originInPoint: clip.inPoint,
                                    speed: clip.speed,
                                  };
                                }}
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {snapLineTime !== null && (
              <div
                className="absolute top-0 bottom-0 w-[1px] bg-[#F59E0B] pointer-events-none z-30"
                style={{ left: `${snapLineTime * pixelsPerSecond}px` }}
              />
            )}

            {toolMode === 'razor' && razorHoverTime !== null && (
              <div
                className="absolute top-7 bottom-0 w-[1px] bg-[#EF4444]/80 pointer-events-none z-30"
                style={{ left: `${razorHoverTime * pixelsPerSecond}px` }}
              />
            )}

            <div
              className="absolute top-0 bottom-0 w-[1.5px] bg-[#3B82F6] pointer-events-none z-30"
              style={{ left: `${playhead * pixelsPerSecond}px` }}
            >
              <div className="w-2.5 h-3 bg-[#3B82F6] -translate-x-[4.25px] rounded-t-[2px]" />
            </div>
          </div>
        </div>

        {/* Stereo Master Audio VU Meter */}
        <div className="w-11 bg-[#141418] border-l border-[#27272E] py-2 px-1.5 flex flex-col items-center justify-between shrink-0">
          <span className="text-[9px] font-mono-tabular text-[#7D7D8A]">dB</span>
          <div className="flex-1 w-full flex items-end justify-center gap-1 py-1.5">
            {[0, 1].map((ch) => {
              const pct = Math.round(clamp(meterLevels[ch] * 100, 0, 100));
              return (
                <div
                  key={ch}
                  className="w-2.5 h-full bg-[#0C0C0F] border border-[#24242C] rounded-[2px] overflow-hidden flex flex-col justify-end"
                >
                  <div
                    className="w-full transition-all duration-75"
                    style={{
                      height: `${pct}%`,
                      background:
                        pct > 85
                          ? 'linear-gradient(to top, #10B981, #F59E0B 70%, #EF4444)'
                          : 'linear-gradient(to top, #0D9488, #10B981)',
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 text-[9px] font-mono-tabular text-[#6F6F7D]">
            <span>L</span>
            <span>R</span>
          </div>
        </div>
      </div>
    </section>
  );
}
