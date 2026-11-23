import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Bookmark,
  Camera,
  Captions,
  ChevronLeft,
  ChevronRight,
  Grid,
  LayoutGrid,
  Maximize2,
  Pause,
  Pipette,
  Play,
  Repeat,
  Scan,
  Scissors,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import {
  CaptionSegment,
  MediaAsset,
  MonitorInteractionMode,
  SequenceSettings,
  TimelineClip,
  Track,
} from '../types/editor';
import {
  createMediaCache,
  renderSequenceFrame,
  syncVideoElementsForTime,
} from '../utils/compositor';
import { clamp, formatTimecode } from '../utils/timecode';
import { buildFpsSelectOptions, formatFpsLabel } from '../utils/videoMetadata';

interface MonitorPanelProps {
  monitorMode: 'program' | 'source';
  onMonitorModeChange: (mode: 'program' | 'source') => void;
  sequence: SequenceSettings;
  sourceVideoFps?: number | null;
  onChangeAspectPreset: (preset: SequenceSettings['aspectPreset']) => void;
  onChangeFps: (fps: number, fromMatch?: boolean) => void;
  onToggleProxyMode: () => void;
  tracks: Track[];
  clips: TimelineClip[];
  captions: CaptionSegment[];
  showCaptionsOverlay: boolean;
  onToggleCaptionsOverlay: () => void;
  assetsMap: Map<string, MediaAsset>;
  playhead: number;
  totalDuration: number;
  isPlaying: boolean;
  loopEnabled: boolean;
  inPoint: number | null;
  outPoint: number | null;
  sourceAsset: MediaAsset | null;
  selectedClip: TimelineClip | null;
  onSwitchMulticamAngle: (clipId: string, angleIdx: number) => void;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onStepFrame: (deltaFrames: number) => void;
  onToggleLoop: () => void;
  onSetInPoint: () => void;
  onSetOutPoint: () => void;
  onClearInOut: () => void;
  onSplitAtPlayhead: () => void;
  onAddMarkerAtPlayhead: () => void;
  onInsertSourceClip: (asset: MediaAsset, inPt: number, outPt: number) => void;
  interactionMode: MonitorInteractionMode;
  onChangeInteractionMode: (mode: MonitorInteractionMode) => void;
  checkerboardBg: boolean;
  onPickChromaColor: (hex: string, addAsShade: boolean, keepPicking?: boolean) => void;
  onSetChromaRegion: (region: { x: number; y: number; width: number; height: number }) => void;
}

export function MonitorPanel({
  monitorMode,
  onMonitorModeChange,
  sequence,
  sourceVideoFps,
  onChangeAspectPreset,
  onChangeFps,
  onToggleProxyMode,
  tracks,
  clips,
  captions,
  showCaptionsOverlay,
  onToggleCaptionsOverlay,
  assetsMap,
  playhead,
  totalDuration,
  isPlaying,
  loopEnabled,
  inPoint,
  outPoint,
  sourceAsset,
  selectedClip,
  onSwitchMulticamAngle,
  onTogglePlay,
  onSeek,
  onStepFrame,
  onToggleLoop,
  onSetInPoint,
  onSetOutPoint,
  onClearInOut,
  onSplitAtPlayhead,
  onAddMarkerAtPlayhead,
  onInsertSourceClip,
  interactionMode,
  onChangeInteractionMode,
  checkerboardBg,
  onPickChromaColor,
  onSetChromaRegion,
}: MonitorPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const monitorContainerRef = useRef<HTMLDivElement | null>(null);
  const viewportBoxRef = useRef<HTMLDivElement | null>(null);
  const cacheRef = useRef(createMediaCache());

  const [showSafeMargins, setShowSafeMargins] = useState(false);
  const [multicamGrid, setMulticamGrid] = useState(false);
  const [zoomScale, setZoomScale] = useState<'fit' | '50' | '100'>('fit');
  const [hoveredPixel, setHoveredPixel] = useState<{
    x: number;
    y: number;
    hex: string;
    rgb: [number, number, number];
  } | null>(null);
  const [draftRegion, setDraftRegion] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const [sourceTime, setSourceTime] = useState(0);
  const [sourceIn, setSourceIn] = useState(0);
  const [sourceOut, setSourceOut] = useState(0);
  const [sourcePlaying, setSourcePlaying] = useState(false);
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
  const sourceAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (sourceAsset) {
      setSourceTime(0);
      setSourceIn(0);
      setSourceOut(sourceAsset.duration);
      setSourcePlaying(false);
    }
  }, [sourceAsset?.id]);

  // Active multicam clip at playhead (either selected or on V1)
  const activeMulticamClip =
    (selectedClip?.multicamAngles?.length ? selectedClip : null) ||
    clips.find(
      (c) =>
        c.multicamAngles?.length &&
        playhead >= c.start &&
        playhead < c.start + c.duration
    ) ||
    null;

  const activeVisualClipsAtPlayhead = tracks
    .filter((t) => t.type === 'video' && t.visible)
    .flatMap((t) =>
      clips.filter(
        (c) =>
          c.trackId === t.id &&
          !c.disabled &&
          (c.type === 'video' || c.type === 'image' || c.type === 'matte') &&
          playhead >= c.start &&
          playhead < c.start + c.duration
      )
    );

  const activeKeyTargetClip =
    (selectedClip && activeVisualClipsAtPlayhead.some((c) => c.id === selectedClip.id)
      ? selectedClip
      : activeVisualClipsAtPlayhead[0]) || selectedClip;

  // Cancel active Monitor picker/region mode with Escape
  useEffect(() => {
    if (interactionMode === 'none') {
      setHoveredPixel(null);
      setDraftRegion(null);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onChangeInteractionMode('none');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [interactionMode, onChangeInteractionMode]);

  // Program Canvas Real-Time Rendering
  useEffect(() => {
    if (monitorMode !== 'program') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    syncVideoElementsForTime(cacheRef.current, clips, assetsMap, playhead, isPlaying);

    let rafId = 0;
    const renderNow = () => {
      renderSequenceFrame(
        ctx,
        canvas.width,
        canvas.height,
        playhead,
        tracks,
        clips,
        assetsMap,
        cacheRef.current,
        sequence,
        {
          showSafeMargins,
          captions: showCaptionsOverlay ? captions : undefined,
          multicamGrid,
          activeMulticamClip,
          allowKeyHelpers: true,
          checkerboardBg,
        }
      );

      if (interactionMode === 'chroma-eyedropper' || interactionMode === 'chroma-add-color') {
        if (!sampleCanvasRef.current) {
          sampleCanvasRef.current = document.createElement('canvas');
        }
        const sc = sampleCanvasRef.current;
        if (sc.width !== canvas.width || sc.height !== canvas.height) {
          sc.width = canvas.width;
          sc.height = canvas.height;
        }
        const sctx = sc.getContext('2d', { willReadFrequently: true });
        if (sctx) {
          renderSequenceFrame(
            sctx,
            sc.width,
            sc.height,
            playhead,
            tracks,
            clips,
            assetsMap,
            cacheRef.current,
            sequence,
            {
              showSafeMargins: false,
              captions: undefined,
              multicamGrid: false,
              skipChromaKeyClipId: activeKeyTargetClip?.id || null,
            }
          );
        }
      }
    };

    renderNow();

    let frames = 0;
    const pump = () => {
      frames++;
      renderNow();
      if (isPlaying || frames < 8) {
        rafId = requestAnimationFrame(pump);
      }
    };
    rafId = requestAnimationFrame(pump);

    return () => cancelAnimationFrame(rafId);
  }, [
    monitorMode,
    playhead,
    isPlaying,
    tracks,
    clips,
    assetsMap,
    sequence,
    showSafeMargins,
    captions,
    showCaptionsOverlay,
    multicamGrid,
    activeMulticamClip,
    checkerboardBg,
    interactionMode,
    activeKeyTargetClip?.id,
  ]);

  useEffect(() => {
    if (!sourcePlaying || !sourceAsset) return;
    if (sourceAsset.type === 'video' && sourceVideoRef.current) {
      sourceVideoRef.current.play().catch(() => {});
      return;
    }
    if (sourceAsset.type === 'audio' && sourceAudioRef.current) {
      sourceAudioRef.current.play().catch(() => {});
      return;
    }
    const startPerf = performance.now();
    const startOffset = sourceTime;
    let rafId = 0;
    const tick = () => {
      const next = startOffset + (performance.now() - startPerf) / 1000;
      if (next >= sourceAsset.duration) {
        setSourceTime(0);
        setSourcePlaying(false);
      } else {
        setSourceTime(next);
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [sourcePlaying, sourceAsset]);

  const handleFrameGrab = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sequence.name.replace(/\s+/g, '_')}_frame.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const handleFullscreen = () => {
    const el = monitorContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  };

  const sampleCanvasPixel = (clientX: number, clientY: number): { hex: string; rgb: [number, number, number] } | null => {
    const visibleCanvas = canvasRef.current;
    if (!visibleCanvas) return null;
    const rect = visibleCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const relX = clamp((clientX - rect.left) / rect.width, 0, 1);
    const relY = clamp((clientY - rect.top) / rect.height, 0, 1);

    const sourceCanvas = sampleCanvasRef.current || visibleCanvas;
    const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const px = clamp(Math.floor(relX * sourceCanvas.width), 0, sourceCanvas.width - 1);
    const py = clamp(Math.floor(relY * sourceCanvas.height), 0, sourceCanvas.height - 1);
    const data = ctx.getImageData(px, py, 1, 1).data;
    const r = data[0];
    const g = data[1];
    const b = data[2];
    const hex =
      '#' +
      [r, g, b]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    return { hex, rgb: [r, g, b] };
  };

  const handleRegionMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (interactionMode !== 'chroma-region') return;
    const box = viewportBoxRef.current;
    if (!box) return;
    e.preventDefault();
    const rect = box.getBoundingClientRect();
    const startXPct = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
    const startYPct = clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100);
    setDraftRegion({ x: startXPct, y: startYPct, width: 1, height: 1 });

    const computeRect = (clientX: number, clientY: number) => {
      const curXPct = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
      const curYPct = clamp(((clientY - rect.top) / rect.height) * 100, 0, 100);
      const x = Math.min(startXPct, curXPct);
      const y = Math.min(startYPct, curYPct);
      const width = Math.abs(curXPct - startXPct);
      const height = Math.abs(curYPct - startYPct);
      return { x, y, width, height };
    };

    const onMove = (ev: MouseEvent) => {
      setDraftRegion(computeRect(ev.clientX, ev.clientY));
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const finalRect = computeRect(ev.clientX, ev.clientY);
      setDraftRegion(null);
      if (finalRect.width >= 2 && finalRect.height >= 2) {
        onSetChromaRegion({
          x: Math.round(finalRect.x * 10) / 10,
          y: Math.round(finalRect.y * 10) / 10,
          width: Math.round(finalRect.width * 10) / 10,
          height: Math.round(finalRect.height * 10) / 10,
        });
      } else {
        // Click fallback: place a centered 44%x44% box around clicked point
        const w = 44;
        const h = 44;
        onSetChromaRegion({
          x: Math.round(clamp(startXPct - w / 2, 0, 100 - w)),
          y: Math.round(clamp(startYPct - h / 2, 0, 100 - h)),
          width: w,
          height: h,
        });
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Render resolution scaled cleanly for Proxy mode vs Full mode
  const canvasRenderWidth = sequence.proxyMode ? 640 : 960;
  const canvasRenderHeight = Math.round((canvasRenderWidth * sequence.height) / sequence.width);

  return (
    <section
      ref={monitorContainerRef}
      className="h-full bg-[#141418] flex flex-col min-w-0 overflow-hidden"
    >
      {/* Monitor Header */}
      <div className="h-9 px-3 bg-[#141418] border-b border-[#27272E] flex items-center justify-between gap-2 shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onMonitorModeChange('program')}
            className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              monitorMode === 'program' ? 'bg-[#25252D] text-[#F4F4F7]' : 'text-[#8E8E9B] hover:text-[#D4D4DC]'
            }`}
          >
            Program: {sequence.name}
          </button>
          <button
            type="button"
            onClick={() => onMonitorModeChange('source')}
            className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              monitorMode === 'source' ? 'bg-[#25252D] text-[#F4F4F7]' : 'text-[#8E8E9B] hover:text-[#D4D4DC]'
            }`}
          >
            Source{sourceAsset ? `: ${sourceAsset.name}` : ''}
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Aspect / Auto-Reframe Selector */}
          <select
            value={sequence.aspectPreset}
            onChange={(e) => onChangeAspectPreset(e.target.value as SequenceSettings['aspectPreset'])}
            title="Sequence Aspect & Auto Reframe"
            className="bg-[#1C1C22] border border-[#2C2C35] rounded px-1.5 py-0.5 text-[11px] font-mono-tabular text-[#C8C8D2] outline-none cursor-pointer"
          >
            <option value="16:9-hd">16:9 1080p</option>
            <option value="16:9-4k">16:9 4K UHD</option>
            <option value="9:16-vertical">9:16 Vertical</option>
            <option value="1:1-square">1:1 Square</option>
            <option value="4:5-social">4:5 Social</option>
          </select>

          {/* Sequence Frame Rate Selector (supports source video FPS up to 240 fps) */}
          <select
            value={sequence.fps}
            onChange={(e) => onChangeFps(Number(e.target.value), false)}
            title="Sequence Frame Rate (auto-matched to imported video)"
            aria-label="Sequence Frame Rate"
            className="bg-[#1C1C22] border border-[#2C2C35] rounded px-1.5 py-0.5 text-[11px] font-mono-tabular text-[#C8C8D2] outline-none cursor-pointer"
          >
            {buildFpsSelectOptions(sequence.fps, sourceVideoFps).map((fpsOpt) => (
              <option key={fpsOpt} value={fpsOpt}>
                {formatFpsLabel(fpsOpt)}
                {sourceVideoFps && Math.abs(fpsOpt - sourceVideoFps) < 0.01 ? ' (Video)' : ''}
              </option>
            ))}
          </select>
          {sourceVideoFps && Math.abs(sourceVideoFps - sequence.fps) > 0.01 && (
            <button
              type="button"
              onClick={() => onChangeFps(sourceVideoFps, true)}
              title={`Match sequence FPS to source video (${formatFpsLabel(sourceVideoFps)})`}
              className="px-1.5 py-0.5 text-[10px] font-mono-tabular rounded border border-[#3B82F6]/50 bg-[#3B82F6]/15 text-[#93C5FD] hover:bg-[#3B82F6]/25 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Match {Math.round(sourceVideoFps * 100) / 100}fps
            </button>
          )}

          <button
            type="button"
            onClick={onToggleProxyMode}
            title="Toggle Proxy Playback Resolution"
            className={`px-1.5 py-0.5 text-[10px] font-mono-tabular rounded border cursor-pointer ${
              sequence.proxyMode
                ? 'bg-[#D97706]/20 border-[#D97706]/60 text-[#FCD34D]'
                : 'bg-[#1C1C22] border-[#2C2C35] text-[#8E8E9B] hover:text-white'
            }`}
          >
            {sequence.proxyMode ? 'Proxy' : 'Full'}
          </button>

          <button
            type="button"
            onClick={() => setMulticamGrid((v) => !v)}
            title="Multicam 4-Angle Switcher"
            className={`p-1 rounded border transition-colors cursor-pointer ${
              multicamGrid
                ? 'bg-[#EF4444]/20 border-[#EF4444]/60 text-[#FCA5A5]'
                : 'bg-[#1C1C22] border-[#2C2C35] text-[#8E8E9B] hover:text-white'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onToggleCaptionsOverlay}
            title="Toggle Closed Captions Preview"
            className={`p-1 rounded border transition-colors cursor-pointer ${
              showCaptionsOverlay
                ? 'bg-[#3B82F6]/20 border-[#3B82F6]/50 text-[#60A5FA]'
                : 'bg-[#1C1C22] border-[#2C2C35] text-[#8E8E9B] hover:text-white'
            }`}
          >
            <Captions className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              if (monitorMode !== 'program') onMonitorModeChange('program');
              onChangeInteractionMode(
                interactionMode === 'chroma-eyedropper' || interactionMode === 'chroma-add-color'
                  ? 'none'
                  : 'chroma-eyedropper'
              );
            }}
            title="Chroma Key Eyedropper — Click any color in video to key it out"
            className={`p-1 rounded border transition-colors cursor-pointer ${
              interactionMode === 'chroma-eyedropper' || interactionMode === 'chroma-add-color'
                ? 'bg-[#3B82F6]/25 border-[#3B82F6] text-[#93C5FD]'
                : 'bg-[#1C1C22] border-[#2C2C35] text-[#8E8E9B] hover:text-white'
            }`}
          >
            <Pipette className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setShowSafeMargins((v) => !v)}
            title="Toggle Broadcast Safe Margins"
            className={`p-1 rounded border transition-colors cursor-pointer ${
              showSafeMargins
                ? 'bg-[#3B82F6]/20 border-[#3B82F6]/50 text-[#60A5FA]'
                : 'bg-[#1C1C22] border-[#2C2C35] text-[#8E8E9B] hover:text-white'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleFrameGrab}
            title="Export Frame Grab (PNG)"
            className="p-1 rounded bg-[#1C1C22] border border-[#2C2C35] text-[#8E8E9B] hover:text-white cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>

          <select
            value={zoomScale}
            onChange={(e) => setZoomScale(e.target.value as 'fit' | '50' | '100')}
            aria-label="Monitor Zoom"
            className="bg-[#1C1C22] border border-[#2C2C35] rounded px-1.5 py-0.5 text-[11px] text-[#C8C8D2] outline-none cursor-pointer"
          >
            <option value="fit">Fit</option>
            <option value="50">50%</option>
            <option value="100">100%</option>
          </select>

          <button
            type="button"
            onClick={handleFullscreen}
            title="Fullscreen Monitor"
            className="p-1 rounded bg-[#1C1C22] border border-[#2C2C35] text-[#8E8E9B] hover:text-white transition-colors cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Viewport Surface */}
      <div className="flex-1 bg-[#0B0B0D] flex items-center justify-center p-3 overflow-auto min-h-0 relative">
        {monitorMode === 'program' && interactionMode !== 'none' && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1 rounded bg-[#14141A]/95 border border-[#3B82F6]/60 shadow-lg text-[11px] text-[#E4E4EC] whitespace-nowrap">
            {interactionMode === 'chroma-region' ? (
              <>
                <Scan className="w-3.5 h-3.5 text-[#60A5FA]" />
                <span>Drag on video to set the area where Chroma Key applies</span>
              </>
            ) : (
              <>
                <Pipette className="w-3.5 h-3.5 text-[#60A5FA]" />
                <span>
                  {interactionMode === 'chroma-add-color'
                    ? 'Click on video to add another color shade'
                    : 'Click any color on the video to chroma key it (Shift+Click to add shade)'}
                </span>
              </>
            )}
            <button
              type="button"
              onClick={() => onChangeInteractionMode('none')}
              title="Cancel (Esc)"
              className="ml-1 p-0.5 rounded hover:bg-[#252530] text-[#9E9EAB] hover:text-white cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {monitorMode === 'program' ? (
          <div
            ref={viewportBoxRef}
            onMouseDown={handleRegionMouseDown}
            className={`relative bg-black shadow-2xl border flex items-center justify-center overflow-hidden ${
              interactionMode !== 'none' ? 'border-[#3B82F6]' : 'border-[#222229]'
            } ${interactionMode === 'chroma-region' ? 'cursor-crosshair select-none' : ''}`}
            style={
              zoomScale === 'fit'
                ? { width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', aspectRatio: `${sequence.width} / ${sequence.height}` }
                : zoomScale === '50'
                  ? { width: `${Math.min(900, sequence.width * 0.45)}px`, aspectRatio: `${sequence.width} / ${sequence.height}` }
                  : { width: `${Math.min(1200, sequence.width * 0.72)}px`, aspectRatio: `${sequence.width} / ${sequence.height}` }
            }
          >
            <canvas
              ref={canvasRef}
              width={canvasRenderWidth}
              height={canvasRenderHeight}
              onMouseMove={(e) => {
                if (interactionMode !== 'chroma-eyedropper' && interactionMode !== 'chroma-add-color') {
                  if (hoveredPixel) setHoveredPixel(null);
                  return;
                }
                const sample = sampleCanvasPixel(e.clientX, e.clientY);
                const boxRect = viewportBoxRef.current?.getBoundingClientRect();
                if (sample && boxRect) {
                  setHoveredPixel({
                    x: e.clientX - boxRect.left,
                    y: e.clientY - boxRect.top,
                    hex: sample.hex,
                    rgb: sample.rgb,
                  });
                }
              }}
              onMouseLeave={() => {
                if (hoveredPixel) setHoveredPixel(null);
              }}
              onClick={(e) => {
                if (interactionMode === 'chroma-eyedropper' || interactionMode === 'chroma-add-color') {
                  e.stopPropagation();
                  const sample = sampleCanvasPixel(e.clientX, e.clientY);
                  if (sample) {
                    const addAsShade = interactionMode === 'chroma-add-color' || e.shiftKey;
                    onPickChromaColor(sample.hex, addAsShade, e.shiftKey);
                  }
                  return;
                }
                if (!multicamGrid || !activeMulticamClip) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const col = e.clientX - rect.left < rect.width / 2 ? 0 : 1;
                const row = e.clientY - rect.top < rect.height / 2 ? 0 : 1;
                const angleIdx = row * 2 + col;
                onSwitchMulticamAngle(activeMulticamClip.id, angleIdx);
              }}
              className={`w-full h-full object-contain block ${
                interactionMode === 'chroma-eyedropper' ||
                interactionMode === 'chroma-add-color' ||
                interactionMode === 'chroma-region'
                  ? 'cursor-crosshair'
                  : multicamGrid
                    ? 'cursor-pointer'
                    : ''
              }`}
            />

            {/* Active or Draft Chroma Key Region Overlay */}
            {(draftRegion ||
              (activeKeyTargetClip?.vfx?.chromaKey?.enabled &&
                activeKeyTargetClip.vfx.chromaKey.region?.enabled &&
                !isPlaying &&
                (interactionMode === 'chroma-region' || checkerboardBg))) && (
              (() => {
                const reg = draftRegion || activeKeyTargetClip?.vfx?.chromaKey?.region;
                if (!reg) return null;
                return (
                  <div
                    className="pointer-events-none absolute border-2 border-dashed border-[#60A5FA] bg-[#3B82F6]/10 z-10"
                    style={{
                      left: `${reg.x}%`,
                      top: `${reg.y}%`,
                      width: `${reg.width}%`,
                      height: `${reg.height}%`,
                    }}
                  >
                    <span className="absolute -top-5 left-0 px-1.5 py-0.5 rounded bg-[#18181F]/90 border border-[#3B82F6]/60 text-[9px] font-mono-tabular text-[#93C5FD] whitespace-nowrap">
                      Key Area {Math.round(reg.width)}% × {Math.round(reg.height)}%
                    </span>
                  </div>
                );
              })()
            )}

            {/* Floating Eyedropper Color Loupe */}
            {(interactionMode === 'chroma-eyedropper' || interactionMode === 'chroma-add-color') &&
              hoveredPixel && (
                <div
                  className="pointer-events-none absolute z-20 flex items-center gap-2 px-2 py-1 rounded bg-[#14141A]/95 border border-[#3A3A48] shadow-xl"
                  style={{
                    left: `${Math.min(
                      (viewportBoxRef.current?.clientWidth || 300) - 148,
                      Math.max(8, hoveredPixel.x + 14)
                    )}px`,
                    top: `${Math.max(8, hoveredPixel.y - 38)}px`,
                  }}
                >
                  <span
                    className="w-5 h-5 rounded border border-white/60 shrink-0 shadow-inner"
                    style={{ backgroundColor: hoveredPixel.hex }}
                  />
                  <div className="leading-tight">
                    <div className="text-[11px] font-mono-tabular font-semibold text-white">
                      {hoveredPixel.hex}
                    </div>
                    <div className="text-[9px] font-mono-tabular text-[#9E9EAB]">
                      {hoveredPixel.rgb.join(', ')}
                    </div>
                  </div>
                </div>
              )}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {!sourceAsset ? (
              <div className="text-center px-6 py-8 border border-dashed border-[#27272E] rounded">
                <p className="text-xs text-[#8E8E9B]">
                  Select any media item in the Project Bin to preview and trim In/Out points.
                </p>
              </div>
            ) : sourceAsset.type === 'video' ? (
              <video
                ref={sourceVideoRef}
                src={sourceAsset.src}
                className="max-w-full max-h-full bg-black border border-[#222229]"
                onTimeUpdate={(e) => setSourceTime(e.currentTarget.currentTime)}
                onEnded={() => setSourcePlaying(false)}
              />
            ) : sourceAsset.type === 'image' ? (
              <img
                src={sourceAsset.src}
                alt={sourceAsset.name}
                referrerPolicy="no-referrer"
                className="max-w-full max-h-full object-contain border border-[#222229]"
              />
            ) : sourceAsset.type === 'matte' ? (
              <div
                className="w-3/4 aspect-video border border-[#222229]"
                style={{ backgroundColor: sourceAsset.matteColor || '#1E293B' }}
              />
            ) : (
              <div className="w-4/5 max-w-xl p-6 bg-[#131317] border border-[#27272E] rounded space-y-4">
                <audio
                  ref={sourceAudioRef}
                  src={sourceAsset.src}
                  onTimeUpdate={(e) => setSourceTime(e.currentTarget.currentTime)}
                  onEnded={() => setSourcePlaying(false)}
                />
                <div className="flex items-center justify-between text-xs text-[#D4D4DC]">
                  <span className="font-medium truncate">{sourceAsset.name}</span>
                  <span className="font-mono-tabular text-[#14B8A6]">
                    {formatTimecode(sourceTime, sequence.fps)}
                  </span>
                </div>
                <div className="h-24 flex items-center gap-[3px] bg-[#0B0B0D] px-3 rounded border border-[#222228]">
                  {(sourceAsset.waveform || []).slice(0, 72).map((pk, idx, arr) => {
                    const ratio = idx / arr.length;
                    const played = ratio <= sourceTime / Math.max(0.1, sourceAsset.duration);
                    return (
                      <div
                        key={idx}
                        className={`flex-1 rounded-full ${played ? 'bg-[#14B8A6]' : 'bg-[#2C3A3D]'}`}
                        style={{ height: `${Math.max(12, pk * 88)}%` }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Transport & Scrubber Bar */}
      {monitorMode === 'program' ? (
        <div className="px-3 py-2 bg-[#16161B] border-t border-[#27272E] flex items-center justify-between gap-2 shrink-0 overflow-x-auto">
          <div className="flex items-center gap-2 min-w-0 shrink-0">
            <span className="font-mono-tabular text-sm font-medium text-[#60A5FA] tracking-tight">
              {formatTimecode(playhead, sequence.fps)}
            </span>
            <span className="text-[11px] text-[#6E6E7B] font-mono-tabular hidden md:inline">
              / {formatTimecode(totalDuration, sequence.fps)}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onSeek(0)}
              title="Go to Start (Home)"
              className="p-1.5 rounded text-[#A1A1AF] hover:text-white hover:bg-[#25252D] cursor-pointer"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onStepFrame(-1)}
              title="Step Back 1 Frame (Left Arrow)"
              className="p-1.5 rounded text-[#A1A1AF] hover:text-white hover:bg-[#25252D] cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onTogglePlay}
              title="Play / Pause (Space)"
              className="px-3 py-1.5 rounded bg-[#2563EB] hover:bg-[#3B82F6] text-white cursor-pointer"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => onStepFrame(1)}
              title="Step Forward 1 Frame (Right Arrow)"
              className="p-1.5 rounded text-[#A1A1AF] hover:text-white hover:bg-[#25252D] cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onSeek(totalDuration)}
              title="Go to End (End)"
              className="p-1.5 rounded text-[#A1A1AF] hover:text-white hover:bg-[#25252D] cursor-pointer"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleLoop}
              title="Toggle Loop Playback"
              className={`p-1.5 rounded cursor-pointer ${
                loopEnabled ? 'bg-[#3B82F6]/20 text-[#60A5FA]' : 'text-[#8E8E9B] hover:text-white hover:bg-[#25252D]'
              }`}
            >
              <Repeat className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onAddMarkerAtPlayhead}
              title="Add Marker at Playhead (M)"
              className="p-1.5 rounded border border-[#2B2B34] bg-[#1D1D23] text-[#F59E0B] hover:bg-[#26262F] cursor-pointer"
            >
              <Bookmark className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={onSetInPoint}
              title="Mark In (I)"
              className={`px-2 py-1 text-[11px] font-mono-tabular rounded border cursor-pointer ${
                inPoint !== null
                  ? 'border-[#3B82F6]/60 bg-[#3B82F6]/15 text-[#93C5FD]'
                  : 'border-[#2B2B34] bg-[#1D1D23] text-[#A1A1AF] hover:text-white'
              }`}
            >
              {'{'}
            </button>
            <button
              type="button"
              onClick={onSetOutPoint}
              title="Mark Out (O)"
              className={`px-2 py-1 text-[11px] font-mono-tabular rounded border cursor-pointer ${
                outPoint !== null
                  ? 'border-[#3B82F6]/60 bg-[#3B82F6]/15 text-[#93C5FD]'
                  : 'border-[#2B2B34] bg-[#1D1D23] text-[#A1A1AF] hover:text-white'
              }`}
            >
              {'}'}
            </button>
            {(inPoint !== null || outPoint !== null) && (
              <button
                type="button"
                onClick={onClearInOut}
                className="px-1.5 py-1 text-[10px] text-[#8E8E9B] hover:text-white cursor-pointer"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={onSplitAtPlayhead}
              title="Split Clips at Playhead"
              className="ml-0.5 flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-[#222229] hover:bg-[#2E2E38] border border-[#32323D] text-[#E4E4EC] rounded whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Scissors className="w-3 h-3 text-[#60A5FA]" />
              Split
            </button>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 bg-[#16161B] border-t border-[#27272E] flex items-center justify-between gap-3 shrink-0">
          <span className="font-mono-tabular text-xs text-[#60A5FA]">
            {sourceAsset ? formatTimecode(sourceTime, sequence.fps) : '00:00:00:00'}
          </span>

          {sourceAsset && (
            <div className="flex-1 flex items-center gap-3 max-w-md">
              <button
                type="button"
                onClick={() => {
                  if (sourceAsset.type === 'video' && sourceVideoRef.current) {
                    if (sourcePlaying) sourceVideoRef.current.pause();
                    else sourceVideoRef.current.play().catch(() => {});
                  } else if (sourceAsset.type === 'audio' && sourceAudioRef.current) {
                    if (sourcePlaying) sourceAudioRef.current.pause();
                    else sourceAudioRef.current.play().catch(() => {});
                  }
                  setSourcePlaying((p) => !p);
                }}
                className="p-1.5 rounded bg-[#25252D] hover:bg-[#32323D] text-white cursor-pointer"
              >
                {sourcePlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <input
                type="range"
                min={0}
                max={sourceAsset.duration}
                step={0.03}
                value={sourceTime}
                onChange={(e) => {
                  const t = parseFloat(e.target.value);
                  setSourceTime(t);
                  if (sourceVideoRef.current) sourceVideoRef.current.currentTime = t;
                  if (sourceAudioRef.current) sourceAudioRef.current.currentTime = t;
                }}
                className="flex-1 studio-slider"
              />
            </div>
          )}

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={!sourceAsset}
              onClick={() => sourceAsset && setSourceIn(clamp(sourceTime, 0, Math.max(0, sourceOut - 0.2)))}
              className="px-2 py-1 text-[11px] font-mono-tabular bg-[#1D1D23] border border-[#2C2C35] rounded text-[#C2C2CC] hover:text-white disabled:opacity-40 cursor-pointer"
            >
              In {sourceIn.toFixed(1)}s
            </button>
            <button
              type="button"
              disabled={!sourceAsset}
              onClick={() => sourceAsset && setSourceOut(clamp(sourceTime, sourceIn + 0.2, sourceAsset.duration))}
              className="px-2 py-1 text-[11px] font-mono-tabular bg-[#1D1D23] border border-[#2C2C35] rounded text-[#C2C2CC] hover:text-white disabled:opacity-40 cursor-pointer"
            >
              Out {sourceOut.toFixed(1)}s
            </button>
            <button
              type="button"
              disabled={!sourceAsset}
              onClick={() => sourceAsset && onInsertSourceClip(sourceAsset, sourceIn, sourceOut)}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-[#2563EB] hover:bg-[#3B82F6] text-white rounded disabled:opacity-40 transition-colors whitespace-nowrap cursor-pointer"
            >
              <ArrowDownToLine className="w-3 h-3" />
              Insert
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
