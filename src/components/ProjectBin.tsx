import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckSquare,
  Film,
  FolderPlus,
  Grid,
  Layers,
  List,
  Maximize2,
  Music,
  Palette,
  Plus,
  Search,
  Sparkles,
  Square,
  Type,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import {
  COLOR_PRESETS,
  TRANSITION_CATALOG,
  VIDEO_EFFECTS,
  VideoEffectDef,
} from '../data/presets';
import {
  BinTab,
  ClipLabelColor,
  MediaAsset,
  MediaBinFolder,
  TextConfig,
  TimelineClip,
  TransitionType,
} from '../types/editor';
import { parseJsonResponse } from '../utils/runtime';
import { formatShortDuration } from '../utils/timecode';

interface ProjectBinProps {
  activeTab: BinTab;
  onTabChange: (tab: BinTab) => void;
  bins: MediaBinFolder[];
  activeBinId: string;
  onSelectBin: (binId: string) => void;
  onCreateBin: () => void;
  assets: MediaAsset[];
  selectedSourceId: string | null;
  hasSelectedClip: boolean;
  onSelectSource: (assetId: string) => void;
  onAddToTimeline: (asset: MediaAsset) => void;
  onImportFiles: (files: FileList) => void;
  onCreateColorMatte: () => void;
  onCreateAdjustmentLayer: () => void;
  onCreateMulticamAsset: () => void;
  onSetAssetLabel: (assetId: string, label: ClipLabelColor) => void;
  onInsertTitlePreset: (name: string, textConfig: TextConfig) => void;
  onApplyColorPreset: (presetId: string) => void;
  onApplyEffect: (updater: (clip: TimelineClip) => Partial<TimelineClip>) => void;
  onApplyTransition: (edge: 'in' | 'out', type: TransitionType, duration: number) => void;
  onBatchColorGrade: (assetIds: string[], presetId: string) => { updatedAssets: number; updatedClips: number };
  onBatchResizeAssets: (
    assetIds: string[],
    options: { scale: number; width?: number; height?: number; resetPosition?: boolean }
  ) => { updatedAssets: number; updatedClips: number };
}

const TITLE_TEMPLATES: Array<{ name: string; desc: string; config: TextConfig }> = [
  {
    name: 'Cinema Main Title',
    desc: 'Centered bold uppercase headline + subhead',
    config: {
      text: 'NORTHERN LIGHTS',
      subtitle: 'CHAPTER 01 · EXPEDITION',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 78,
      fontWeight: '700',
      color: '#FFFFFF',
      bgColor: '#000000',
      bgOpacity: 0,
      align: 'center',
      letterSpacing: 12,
      layout: 'center-title',
      animation: 'fade-up',
    },
  },
  {
    name: 'Broadcast Lower Third',
    desc: 'Left-aligned slate plate with blue index bar',
    config: {
      text: 'ELENA ROSTOVA',
      subtitle: 'DIRECTOR OF PHOTOGRAPHY',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 34,
      fontWeight: '600',
      color: '#F8FAFC',
      bgColor: '#09090B',
      bgOpacity: 78,
      align: 'left',
      letterSpacing: 2,
      layout: 'lower-third',
      animation: 'slide-in',
    },
  },
  {
    name: 'Dialogue Subtitle',
    desc: 'Bottom-centered high-contrast caption bar',
    config: {
      text: 'We waited three hours for the fog to break.',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 32,
      fontWeight: '500',
      color: '#FFFFFF',
      bgColor: '#09090B',
      bgOpacity: 72,
      align: 'center',
      letterSpacing: 0,
      layout: 'caption',
      animation: 'none',
    },
  },
  {
    name: 'Editorial Title Card',
    desc: 'Full backdrop plate for section breaks',
    config: {
      text: 'ACT II — THE COAST',
      subtitle: '16MM ARCHIVE SEQUENCE',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 56,
      fontWeight: '600',
      color: '#F1F5F9',
      bgColor: '#121216',
      bgOpacity: 88,
      align: 'center',
      letterSpacing: 8,
      layout: 'editorial-card',
      animation: 'scale-pop',
    },
  },
  {
    name: 'Vector Rectangle Shape',
    desc: 'Gradient vector lower plate or graphic box',
    config: {
      text: 'Shape Box',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 32,
      fontWeight: '600',
      color: '#2563EB',
      gradientEnabled: true,
      gradientEndColor: '#7C3AED',
      strokeColor: '#FFFFFF',
      strokeWidth: 2,
      bgColor: '#000000',
      bgOpacity: 0,
      align: 'center',
      letterSpacing: 0,
      layout: 'shape-rect',
      animation: 'scale-pop',
    },
  },
  {
    name: 'Vector Circle Graphic',
    desc: 'Scalable radial gradient circular badge',
    config: {
      text: 'Circle',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 32,
      fontWeight: '600',
      color: '#14B8A6',
      gradientEnabled: true,
      gradientEndColor: '#0F172A',
      strokeColor: '#E2E8F0',
      strokeWidth: 3,
      bgColor: '#000000',
      bgOpacity: 0,
      align: 'center',
      letterSpacing: 0,
      layout: 'shape-circle',
      animation: 'scale-pop',
    },
  },
];

const LABEL_SWATCHES: Record<ClipLabelColor, string> = {
  blue: '#3B82F6',
  teal: '#14B8A6',
  violet: '#8B5CF6',
  amber: '#F59E0B',
  rose: '#F43F5E',
  forest: '#10B981',
};

interface BatchResizePreset {
  id: string;
  label: string;
  scale: number;
  width?: number;
  height?: number;
  resetPosition?: boolean;
}

const BATCH_RESIZE_PRESETS: BatchResizePreset[] = [
  { id: 'fit-100', label: 'Fit Frame (100%)', scale: 100, resetPosition: true },
  { id: 'punch-125', label: 'Punch-In (125%)', scale: 125 },
  { id: 'closeup-150', label: 'Tight Crop (150%)', scale: 150 },
  { id: 'inset-75', label: 'Framed Inset (75%)', scale: 75, resetPosition: true },
  { id: 'pip-50', label: '50% Picture-in-Picture', scale: 50, resetPosition: true },
  { id: 'vertical-916', label: '9:16 Vertical Fill (178%)', scale: 178, width: 1080, height: 1920, resetPosition: true },
  { id: 'square-11', label: '1:1 Square (1080×1080)', scale: 100, width: 1080, height: 1080, resetPosition: true },
  { id: 'hd-1080', label: '1080p HD (1920×1080)', scale: 100, width: 1920, height: 1080 },
  { id: 'qhd-1440', label: '1440p QHD (2560×1440)', scale: 100, width: 2560, height: 1440 },
  { id: 'uhd-4k', label: '4K UHD (3840×2160)', scale: 100, width: 3840, height: 2160 },
  { id: 'custom', label: 'Custom Scale %', scale: 120 },
];

export function ProjectBin({
  activeTab,
  onTabChange,
  bins,
  activeBinId,
  onSelectBin,
  onCreateBin,
  assets,
  selectedSourceId,
  hasSelectedClip,
  onSelectSource,
  onAddToTimeline,
  onImportFiles,
  onCreateColorMatte,
  onCreateAdjustmentLayer,
  onCreateMulticamAsset,
  onInsertTitlePreset,
  onApplyColorPreset,
  onApplyEffect,
  onApplyTransition,
  onBatchColorGrade,
  onBatchResizeAssets,
}: ProjectBinProps) {
  const [search, setSearch] = useState('');
  const [aiMatchedIds, setAiMatchedIds] = useState<string[] | null>(null);
  const [aiSearching, setAiSearching] = useState(false);
  const [effectSearch, setEffectSearch] = useState('');
  const [effectCat, setEffectCat] = useState<'All' | VideoEffectDef['category']>('All');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [batchAnchorId, setBatchAnchorId] = useState<string | null>(null);
  const [batchOpTab, setBatchOpTab] = useState<'color' | 'resize'>('color');
  const [batchPresetId, setBatchPresetId] = useState<string>(COLOR_PRESETS[1]?.id || 'teal-orange');
  const [batchResizePresetId, setBatchResizePresetId] = useState<string>('fit-100');
  const [batchCustomScale, setBatchCustomScale] = useState<number>(120);
  const [batchResetPos, setBatchResetPos] = useState<boolean>(true);
  const [batchFeedback, setBatchFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!batchFeedback) return;
    const t = window.setTimeout(() => setBatchFeedback(null), 4000);
    return () => window.clearTimeout(t);
  }, [batchFeedback]);

  const filteredAssets = useMemo(() => {
    let base = assets;
    if (activeBinId !== 'bin_all') {
      base = base.filter((a) => a.binId === activeBinId);
    }
    if (aiMatchedIds !== null) {
      const set = new Set(aiMatchedIds);
      return base.filter((a) => set.has(a.id));
    }
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }, [assets, activeBinId, search, aiMatchedIds]);

  const assetIdSet = useMemo(() => new Set(assets.map((a) => a.id)), [assets]);
  const activeBatchIds = useMemo(
    () => batchSelectedIds.filter((id) => assetIdSet.has(id)),
    [batchSelectedIds, assetIdSet]
  );
  const activeBatchSet = useMemo(() => new Set(activeBatchIds), [activeBatchIds]);
  const selectedVisualCount = useMemo(
    () => assets.filter((a) => activeBatchSet.has(a.id) && a.type !== 'audio').length,
    [assets, activeBatchSet]
  );

  const toggleAssetBatchSelection = (assetId: string, shiftKey = false) => {
    if (shiftKey && batchAnchorId) {
      const idxA = filteredAssets.findIndex((a) => a.id === batchAnchorId);
      const idxB = filteredAssets.findIndex((a) => a.id === assetId);
      if (idxA !== -1 && idxB !== -1) {
        const start = Math.min(idxA, idxB);
        const end = Math.max(idxA, idxB);
        const rangeIds = filteredAssets.slice(start, end + 1).map((a) => a.id);
        setBatchSelectedIds((prev) => Array.from(new Set([...prev.filter((id) => assetIdSet.has(id)), ...rangeIds])));
        return;
      }
    }
    setBatchAnchorId(assetId);
    setBatchSelectedIds((prev) => {
      const cleaned = prev.filter((id) => assetIdSet.has(id));
      return cleaned.includes(assetId) ? cleaned.filter((id) => id !== assetId) : [...cleaned, assetId];
    });
  };

  const handleAssetRowClick = (e: React.MouseEvent, assetId: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      if (!batchOpen) setBatchOpen(true);
      toggleAssetBatchSelection(assetId, e.shiftKey);
      return;
    }
    if (batchOpen) {
      toggleAssetBatchSelection(assetId, false);
      return;
    }
    onSelectSource(assetId);
  };

  const handleRunBatchColor = () => {
    if (selectedVisualCount === 0) return;
    const res = onBatchColorGrade(activeBatchIds, batchPresetId);
    const presetName = COLOR_PRESETS.find((p) => p.id === batchPresetId)?.name || batchPresetId;
    setBatchFeedback(
      `Applied "${presetName}" to ${res.updatedAssets} asset${res.updatedAssets === 1 ? '' : 's'}${
        res.updatedClips > 0 ? ` (${res.updatedClips} timeline clip${res.updatedClips === 1 ? '' : 's'})` : ''
      }`
    );
  };

  const handleRunBatchResize = () => {
    if (selectedVisualCount === 0) return;
    const preset = BATCH_RESIZE_PRESETS.find((p) => p.id === batchResizePresetId) || BATCH_RESIZE_PRESETS[0];
    const targetScale =
      preset.id === 'custom' ? Math.max(10, Math.min(400, Number(batchCustomScale) || 100)) : preset.scale;
    const res = onBatchResizeAssets(activeBatchIds, {
      scale: targetScale,
      width: preset.width,
      height: preset.height,
      resetPosition: batchResetPos || preset.resetPosition,
    });
    const label = preset.id === 'custom' ? `${targetScale}% Scale` : preset.label;
    setBatchFeedback(
      `Resized ${res.updatedAssets} asset${res.updatedAssets === 1 ? '' : 's'} to ${label}${
        res.updatedClips > 0 ? ` (${res.updatedClips} timeline clip${res.updatedClips === 1 ? '' : 's'})` : ''
      }`
    );
  };

  const filteredEffects = useMemo(() => {
    const q = effectSearch.trim().toLowerCase();
    return VIDEO_EFFECTS.filter((fx) => {
      if (effectCat !== 'All' && fx.category !== effectCat) return false;
      if (!q) return true;
      return (
        fx.name.toLowerCase().includes(q) ||
        fx.category.toLowerCase().includes(q) ||
        fx.description.toLowerCase().includes(q)
      );
    });
  }, [effectSearch, effectCat]);

  const handleAiMediaSearch = async () => {
    const q = search.trim();
    if (!q) {
      setAiMatchedIds(null);
      return;
    }
    const localSmartMatch = () => {
      const tokens = q
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0);
      return assets
        .filter((a) => {
          const hay = `${a.name} ${a.type} ${(a.tags || []).join(' ')} ${a.notes || ''}`.toLowerCase();
          return tokens.every((tok) => hay.includes(tok));
        })
        .map((a) => a.id);
    };
    setAiSearching(true);
    try {
      const res = await fetch('/api/ai/media-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q,
          assets: assets.map((a) => ({ id: a.id, name: a.name, type: a.type, tags: a.tags || [] })),
        }),
      });
      const data = await parseJsonResponse<{ matchedIds?: string[] }>(res);
      if (res.ok && data && Array.isArray(data.matchedIds)) {
        setAiMatchedIds(data.matchedIds);
      } else {
        setAiMatchedIds(localSmartMatch());
      }
    } catch {
      setAiMatchedIds(localSmartMatch());
    } finally {
      setAiSearching(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onImportFiles(e.dataTransfer.files);
    }
  };

  return (
    <aside
      className="h-full bg-[#18181C] border-r border-[#27272E] flex flex-col min-w-0 overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Bin Tab Strip */}
      <div className="h-9 px-2 bg-[#141418] border-b border-[#27272E] flex items-center gap-1 shrink-0 overflow-x-auto">
        {(
          [
            { id: 'project', label: 'Project' },
            { id: 'effects', label: 'Effects' },
            { id: 'transitions', label: 'Transitions' },
            { id: 'titles', label: 'Graphics' },
          ] as Array<{ id: BinTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === tab.id ? 'bg-[#25252D] text-[#F4F4F7]' : 'text-[#8E8E9B] hover:text-[#D4D4DC]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'project' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Bin Toolbar */}
          <div className="p-2.5 border-b border-[#27272E] flex flex-col gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium text-[#F4F4F7] bg-[#25252D] hover:bg-[#2F2F39] border border-[#34343F] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-[#3B82F6]" />
                Import
              </button>
              <button
                type="button"
                onClick={onCreateAdjustmentLayer}
                title="Add Adjustment Layer to Timeline"
                className="px-2 py-1.5 text-[11px] text-[#C2C2CC] bg-[#212127] hover:bg-[#2B2B33] border border-[#2F2F39] rounded cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onCreateColorMatte}
                title="New Color Matte"
                className="px-2 py-1.5 text-[11px] text-[#C2C2CC] bg-[#212127] hover:bg-[#2B2B33] border border-[#2F2F39] rounded cursor-pointer"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onCreateMulticamAsset}
                title="Create 4-Camera Multicam Clip"
                className="px-2 py-1.5 text-[11px] font-mono-tabular text-[#C2C2CC] bg-[#212127] hover:bg-[#2B2B33] border border-[#2F2F39] rounded cursor-pointer shrink-0"
              >
                MC
              </button>
              <button
                type="button"
                onClick={() => setBatchOpen((o) => !o)}
                title="Open Batch Processor (Multi-Select Color & Resize)"
                className={`flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  batchOpen || activeBatchIds.length > 0
                    ? 'bg-[#3B82F6]/15 border-[#3B82F6]/55 text-[#93C5FD]'
                    : 'text-[#C2C2CC] bg-[#212127] hover:bg-[#2B2B33] border-[#2F2F39]'
                }`}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span>{activeBatchIds.length > 0 ? `Batch (${activeBatchIds.length})` : 'Batch'}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="video/*,audio/*,image/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    onImportFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
              />
            </div>

            {/* Bin Folders Strip */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
              {bins.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onSelectBin(b.id)}
                  className={`px-2 py-0.5 text-[10px] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeBinId === b.id
                      ? 'bg-[#3B82F6]/20 text-[#93C5FD]'
                      : 'text-[#8E8E9B] hover:text-white bg-[#131317]'
                  }`}
                >
                  {b.name}
                </button>
              ))}
              <button
                type="button"
                onClick={onCreateBin}
                title="New Bin Folder"
                className="p-1 text-[#7D7D8A] hover:text-white shrink-0 cursor-pointer"
              >
                <FolderPlus className="w-3 h-3" />
              </button>
            </div>

            {/* Search + Media Intelligence */}
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 text-[#6F6F7D] absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    if (!e.target.value.trim()) setAiMatchedIds(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAiMediaSearch();
                  }}
                  placeholder="Search or AI query..."
                  className="w-full bg-[#121215] border border-[#27272E] focus:border-[#3B82F6] rounded pl-7 pr-2 py-1 text-xs text-[#EAEAF0] placeholder-[#6F6F7D] outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleAiMediaSearch}
                disabled={aiSearching}
                title="Media Intelligence Smart Search"
                className={`p-1.5 rounded border cursor-pointer shrink-0 ${
                  aiMatchedIds !== null
                    ? 'bg-[#3B82F6]/20 border-[#3B82F6] text-[#93C5FD]'
                    : 'bg-[#121215] border-[#27272E] text-[#8E8E9B] hover:text-white'
                }`}
              >
                <Sparkles className="w-3 h-3" />
              </button>
              <div className="flex items-center bg-[#121215] border border-[#27272E] rounded p-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  aria-label="Grid view"
                  className={`p-1 rounded cursor-pointer ${
                    viewMode === 'grid' ? 'bg-[#272730] text-white' : 'text-[#6F6F7D] hover:text-[#C2C2CC]'
                  }`}
                >
                  <Grid className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-label="List view"
                  className={`p-1 rounded cursor-pointer ${
                    viewMode === 'list' ? 'bg-[#272730] text-white' : 'text-[#6F6F7D] hover:text-[#C2C2CC]'
                  }`}
                >
                  <List className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Batch Processor Utility Drawer */}
          {batchOpen && (
            <div className="p-2.5 bg-[#141419] border-b border-[#2A2A35] space-y-2 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <CheckSquare className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
                  <span className="text-[11px] font-semibold text-[#F4F4F7] truncate">Batch Processor</span>
                  <span className="text-[10px] font-mono-tabular text-[#93C5FD] shrink-0">
                    {activeBatchIds.length} sel
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setBatchSelectedIds(
                        filteredAssets.filter((a) => a.type !== 'audio').map((a) => a.id)
                      )
                    }
                    title="Select all visual assets in current bin"
                    className="px-1.5 py-0.5 text-[10px] text-[#B4B4C2] hover:text-white bg-[#1E1E26] hover:bg-[#282832] border border-[#2D2D38] rounded cursor-pointer"
                  >
                    Visual
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchSelectedIds(filteredAssets.map((a) => a.id))}
                    title="Select all visible assets"
                    className="px-1.5 py-0.5 text-[10px] text-[#B4B4C2] hover:text-white bg-[#1E1E26] hover:bg-[#282832] border border-[#2D2D38] rounded cursor-pointer"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchSelectedIds([])}
                    disabled={activeBatchIds.length === 0}
                    className="px-1.5 py-0.5 text-[10px] text-[#9E9EAB] hover:text-white disabled:opacity-40 cursor-pointer"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchOpen(false)}
                    aria-label="Close Batch Processor"
                    className="p-0.5 text-[#7D7D8A] hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Operation Switcher */}
              <div className="grid grid-cols-2 gap-1 bg-[#0F0F13] p-0.5 rounded border border-[#25252E]">
                <button
                  type="button"
                  onClick={() => setBatchOpTab('color')}
                  className={`flex items-center justify-center gap-1.5 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                    batchOpTab === 'color'
                      ? 'bg-[#25252E] text-white'
                      : 'text-[#8E8E9B] hover:text-[#D4D4DC]'
                  }`}
                >
                  <Palette className="w-3 h-3 text-[#60A5FA]" />
                  Color Grade
                </button>
                <button
                  type="button"
                  onClick={() => setBatchOpTab('resize')}
                  className={`flex items-center justify-center gap-1.5 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                    batchOpTab === 'resize'
                      ? 'bg-[#25252E] text-white'
                      : 'text-[#8E8E9B] hover:text-[#D4D4DC]'
                  }`}
                >
                  <Maximize2 className="w-3 h-3 text-[#2DD4BF]" />
                  Resize
                </button>
              </div>

              {batchOpTab === 'color' ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-1">
                    {COLOR_PRESETS.map((preset) => {
                      const active = batchPresetId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setBatchPresetId(preset.id)}
                          className={`p-1.5 rounded border text-left transition-colors cursor-pointer ${
                            active
                              ? 'bg-[#1D283A] border-[#3B82F6] text-white'
                              : 'bg-[#111115] border-[#25252D] text-[#C8C8D2] hover:border-[#3A3A46]'
                          }`}
                        >
                          <div className="flex items-center gap-0.5 mb-1">
                            {preset.swatch.map((hex, i) => (
                              <span key={i} className="h-1 flex-1" style={{ backgroundColor: hex }} />
                            ))}
                          </div>
                          <div className="text-[10px] font-medium truncate">{preset.name}</div>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    disabled={selectedVisualCount === 0}
                    onClick={handleRunBatchColor}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-[11px] font-semibold rounded bg-[#2563EB] hover:bg-[#3B82F6] disabled:bg-[#23232B] disabled:text-[#6F6F7D] text-white transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Palette className="w-3.5 h-3.5" />
                    {selectedVisualCount > 0
                      ? `Apply Color Grade (${selectedVisualCount})`
                      : 'Select Assets Below'}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <select
                    value={batchResizePresetId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setBatchResizePresetId(nextId);
                      const found = BATCH_RESIZE_PRESETS.find((p) => p.id === nextId);
                      if (found && found.id !== 'custom') {
                        setBatchCustomScale(found.scale);
                      }
                    }}
                    aria-label="Batch Resize Preset"
                    className="w-full bg-[#111115] border border-[#27272E] focus:border-[#3B82F6] rounded px-2 py-1 text-[11px] text-[#E4E4EC] outline-none cursor-pointer"
                  >
                    {BATCH_RESIZE_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-1">
                    {[50, 75, 100, 125, 150].map((pct) => {
                      const currentScale =
                        batchResizePresetId === 'custom'
                          ? batchCustomScale
                          : BATCH_RESIZE_PRESETS.find((p) => p.id === batchResizePresetId)?.scale;
                      const isActive = currentScale === pct;
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => {
                            setBatchResizePresetId('custom');
                            setBatchCustomScale(pct);
                          }}
                          className={`flex-1 py-1 text-[10px] font-mono-tabular rounded border cursor-pointer ${
                            isActive
                              ? 'bg-[#0D9488]/20 border-[#14B8A6]/60 text-[#5EEAD4]'
                              : 'bg-[#111115] border-[#25252D] text-[#9E9EAB] hover:text-white'
                          }`}
                        >
                          {pct}%
                        </button>
                      );
                    })}
                  </div>

                  {batchResizePresetId === 'custom' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={25}
                        max={250}
                        step={5}
                        value={batchCustomScale}
                        onChange={(e) => setBatchCustomScale(parseInt(e.target.value, 10))}
                        aria-label="Batch Scale Percentage"
                        className="flex-1 studio-slider"
                      />
                      <input
                        type="number"
                        min={10}
                        max={400}
                        value={batchCustomScale}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!Number.isNaN(v)) setBatchCustomScale(v);
                        }}
                        aria-label="Custom Scale Percent"
                        className="w-12 bg-[#111115] border border-[#27272E] rounded px-1.5 py-0.5 text-[11px] font-mono-tabular text-right text-white outline-none"
                      />
                    </div>
                  )}

                  <label className="flex items-center gap-1.5 text-[10px] text-[#A1A1AF] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={batchResetPos}
                      onChange={(e) => setBatchResetPos(e.target.checked)}
                      className="accent-[#3B82F6] rounded cursor-pointer"
                    />
                    <span>Center anchor position (X: 0, Y: 0)</span>
                  </label>

                  <button
                    type="button"
                    disabled={selectedVisualCount === 0}
                    onClick={handleRunBatchResize}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-[11px] font-semibold rounded bg-[#0D9488] hover:bg-[#14B8A6] disabled:bg-[#23232B] disabled:text-[#6F6F7D] text-white transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    {selectedVisualCount > 0
                      ? `Apply Resize (${selectedVisualCount})`
                      : 'Select Assets Below'}
                  </button>
                </div>
              )}

              {batchFeedback && (
                <div className="px-2 py-1 rounded bg-[#10B981]/15 border border-[#10B981]/35 text-[10px] text-[#6EE7B7]">
                  {batchFeedback}
                </div>
              )}
            </div>
          )}

          {/* Asset Area */}
          <div
            className={`flex-1 overflow-y-auto p-2.5 transition-colors ${
              isDragOver ? 'bg-[#3B82F6]/10 ring-1 ring-inset ring-[#3B82F6]' : ''
            }`}
          >
            {filteredAssets.length === 0 ? (
              <div className="h-full min-h-[180px] flex flex-col items-center justify-center text-center px-4 border border-dashed border-[#2C2C35] rounded gap-2">
                <Film className="w-7 h-7 text-[#5E5E6B]" />
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-[#D4D4DC]">
                    {assets.length === 0 ? 'Your Project Bin is empty' : 'No matching clips in this bin'}
                  </p>
                  <p className="text-[11px] text-[#7D7D8A]">
                    Drag &amp; drop videos, audio, or images here to start editing
                  </p>
                </div>
                {assets.length === 0 && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-1 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#3B82F6] rounded cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Import Media Files
                  </button>
                )}
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-2 gap-2">
                {filteredAssets.map((asset) => {
                  const isSelected = selectedSourceId === asset.id;
                  const isBatchChecked = activeBatchSet.has(asset.id);
                  const labelHex = asset.label ? LABEL_SWATCHES[asset.label] : '#3B82F6';
                  const appliedPreset = asset.defaultColorGrade?.presetId
                    ? COLOR_PRESETS.find((p) => p.id === asset.defaultColorGrade?.presetId)
                    : null;
                  const appliedScale = asset.defaultTransform?.scale;
                  return (
                    <div
                      key={asset.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-chmr-asset', asset.id);
                      }}
                      onClick={(e) => handleAssetRowClick(e, asset.id)}
                      onDoubleClick={() => onAddToTimeline(asset)}
                      className={`group rounded border transition-colors overflow-hidden cursor-pointer bg-[#131317] ${
                        isBatchChecked
                          ? 'border-[#3B82F6] ring-1 ring-[#3B82F6]/60'
                          : isSelected
                            ? 'border-[#3B82F6]'
                            : 'border-[#27272E] hover:border-[#3E3E4A]'
                      }`}
                    >
                      <div className="relative aspect-video bg-[#0C0C0F] overflow-hidden flex items-center justify-center">
                        {asset.type === 'audio' ? (
                          <div className="w-full h-full flex items-center justify-center px-2 bg-[#0E1E22]">
                            <div className="flex items-center gap-[2px] h-7 w-full justify-center">
                              {(asset.waveform || []).slice(0, 28).map((pk, idx) => (
                                <span
                                  key={idx}
                                  className="w-[2px] bg-[#14B8A6]/80 rounded-full"
                                  style={{ height: `${Math.max(15, pk * 100)}%` }}
                                />
                              ))}
                            </div>
                          </div>
                        ) : asset.type === 'matte' ? (
                          <div className="w-full h-full" style={{ backgroundColor: asset.matteColor || '#1E293B' }} />
                        ) : asset.thumbnailUrl ? (
                          <img
                            src={asset.thumbnailUrl}
                            alt={asset.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Film className="w-5 h-5 text-[#52525E]" />
                        )}

                        {(batchOpen || activeBatchIds.length > 0) && (
                          <button
                            type="button"
                            aria-label={`Select ${asset.name} for batch processing`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleAssetBatchSelection(asset.id, e.shiftKey);
                            }}
                            className={`absolute top-1.5 left-1.5 w-4 h-4 rounded-[3px] border flex items-center justify-center transition-colors cursor-pointer ${
                              isBatchChecked
                                ? 'bg-[#2563EB] border-[#60A5FA] text-white'
                                : 'bg-[#0C0C0F]/80 border-[#52525E] text-transparent hover:border-[#A1A1AF]'
                            }`}
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        )}

                        {appliedPreset && (
                          <div
                            title={`Grade: ${appliedPreset.name}`}
                            className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 px-1 py-0.5 rounded bg-[#0C0C0F]/85 border border-[#2A2A35]"
                          >
                            {appliedPreset.swatch.map((hex, i) => (
                              <span key={i} className="w-1.5 h-1.5 rounded-xs" style={{ backgroundColor: hex }} />
                            ))}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddToTimeline(asset);
                          }}
                          title="Insert onto Timeline"
                          className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded bg-[#141418]/90 hover:bg-[#3B82F6] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="px-2 py-1.5 flex items-start gap-1.5">
                        <span
                          className="w-1.5 h-3 rounded-xs mt-0.5 shrink-0"
                          style={{ backgroundColor: labelHex }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-[#E4E4EC] truncate">{asset.name}</p>
                          <p className="text-[10px] text-[#7A7A88] font-mono-tabular mt-0.5 truncate">
                            {formatShortDuration(asset.duration)}
                            {asset.fps ? ` · ${asset.fps}fps` : ''}
                            {appliedScale !== undefined ? ` · ${appliedScale}%` : ''}
                            {asset.type === 'audio' ? ' · Audio' : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="divide-y divide-[#222228]">
                {filteredAssets.map((asset) => {
                  const isSelected = selectedSourceId === asset.id;
                  const isBatchChecked = activeBatchSet.has(asset.id);
                  const appliedScale = asset.defaultTransform?.scale;
                  const appliedPreset = asset.defaultColorGrade?.presetId
                    ? COLOR_PRESETS.find((p) => p.id === asset.defaultColorGrade?.presetId)
                    : null;
                  return (
                    <div
                      key={asset.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-chmr-asset', asset.id);
                      }}
                      onClick={(e) => handleAssetRowClick(e, asset.id)}
                      onDoubleClick={() => onAddToTimeline(asset)}
                      className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                        isBatchChecked
                          ? 'bg-[#3B82F6]/20 text-white'
                          : isSelected
                            ? 'bg-[#3B82F6]/15 text-white'
                            : 'hover:bg-[#212128] text-[#D4D4DC]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {(batchOpen || activeBatchIds.length > 0) && (
                          <button
                            type="button"
                            aria-label={`Select ${asset.name} for batch processing`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleAssetBatchSelection(asset.id, e.shiftKey);
                            }}
                            className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0 cursor-pointer ${
                              isBatchChecked
                                ? 'bg-[#2563EB] border-[#60A5FA] text-white'
                                : 'bg-[#111115] border-[#52525E] text-transparent hover:border-[#A1A1AF]'
                            }`}
                          >
                            <Check className="w-2.5 h-2.5" />
                          </button>
                        )}
                        {asset.type === 'audio' ? (
                          <Music className="w-3.5 h-3.5 text-[#14B8A6] shrink-0" />
                        ) : (
                          <Film className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
                        )}
                        <span className="text-xs truncate">{asset.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {appliedPreset && (
                          <span
                            title={`Grade: ${appliedPreset.name}`}
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: appliedPreset.swatch[2] }}
                          />
                        )}
                        {appliedScale !== undefined && (
                          <span className="text-[10px] text-[#5EEAD4] font-mono-tabular">
                            {appliedScale}%
                          </span>
                        )}
                        <span className="text-[11px] text-[#7A7A88] font-mono-tabular">
                          {formatShortDuration(asset.duration)}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddToTimeline(asset);
                          }}
                          className="p-1 rounded hover:bg-[#3B82F6] text-[#A1A1AF] hover:text-white cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'effects' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-2.5 border-b border-[#27272E] space-y-2 shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#6F6F7D] absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={effectSearch}
                onChange={(e) => setEffectSearch(e.target.value)}
                placeholder={`Filter ${VIDEO_EFFECTS.length}+ VFX & presets...`}
                className="w-full bg-[#121215] border border-[#27272E] focus:border-[#3B82F6] rounded pl-7 pr-2 py-1 text-xs text-[#EAEAF0] placeholder-[#6F6F7D] outline-none"
              />
            </div>
            <select
              value={effectCat}
              onChange={(e) => setEffectCat(e.target.value as 'All' | VideoEffectDef['category'])}
              className="w-full bg-[#121215] border border-[#27272E] rounded px-2 py-1 text-xs text-[#C8C8D2] outline-none"
            >
              <option value="All">All Categories ({VIDEO_EFFECTS.length})</option>
              <option value="Blur & Sharpen">Blur & Sharpen</option>
              <option value="Keying">Keying & Masking</option>
              <option value="Color">Color</option>
              <option value="Distort & Optics">Distort & Optics</option>
              <option value="Stylize">Stylize</option>
              <option value="Time & Stabilize">Time & Stabilize</option>
            </select>
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
            {effectCat === 'All' && !effectSearch && (
              <div>
                <h3 className="text-[11px] font-semibold text-[#C8C8D2] mb-1.5 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-[#3B82F6]" />
                  Lumetri Looks
                </h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={!hasSelectedClip}
                      onClick={() => onApplyColorPreset(preset.id)}
                      className="p-1.5 rounded bg-[#131317] hover:bg-[#22222A] border border-[#27272E] disabled:opacity-45 text-left cursor-pointer disabled:cursor-not-allowed"
                    >
                      <div className="flex items-center gap-0.5 mb-1">
                        {preset.swatch.map((hex, i) => (
                          <span key={i} className="h-1 flex-1" style={{ backgroundColor: hex }} />
                        ))}
                      </div>
                      <div className="text-[11px] font-medium text-[#E4E4EC] truncate">{preset.name}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-[#C8C8D2] flex items-center gap-1.5">
                <Wand2 className="w-3 h-3 text-[#3B82F6]" />
                Video Effects ({filteredEffects.length})
              </div>
              {filteredEffects.map((fx) => (
                <button
                  key={fx.id}
                  type="button"
                  disabled={!hasSelectedClip}
                  onClick={() => onApplyEffect(fx.apply)}
                  className="w-full px-2.5 py-2 rounded bg-[#131317] hover:bg-[#22222A] border border-[#27272E] disabled:opacity-45 text-left transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#E4E4EC] truncate">{fx.name}</span>
                    <span className="text-[10px] text-[#7D7D8A] shrink-0">{fx.category}</span>
                  </div>
                  <p className="text-[10px] text-[#7D7D8A] mt-0.5 truncate">{fx.description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'transitions' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          <p className="text-[11px] text-[#8E8E9B] pb-2 border-b border-[#25252D]">
            {hasSelectedClip
              ? 'Apply a transition to the In or Out edge, or drag onto a clip.'
              : 'Select a video or title clip on the timeline to apply transitions.'}
          </p>
          {TRANSITION_CATALOG.map((tr) => (
            <div
              key={tr.type}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-chmr-transition', tr.type);
              }}
              className="p-2.5 rounded bg-[#131317] border border-[#27272E] space-y-2"
            >
              <div>
                <div className="text-xs font-medium text-[#E4E4EC]">{tr.name}</div>
                <div className="text-[10px] text-[#7D7D8A] mt-0.5">{tr.description}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!hasSelectedClip}
                  onClick={() => onApplyTransition('in', tr.type, tr.defaultDuration)}
                  className="flex-1 px-2 py-1 text-[11px] font-medium bg-[#222229] hover:bg-[#3B82F6] text-[#D4D4DC] hover:text-white rounded disabled:opacity-40 transition-colors cursor-pointer"
                >
                  Apply In
                </button>
                <button
                  type="button"
                  disabled={!hasSelectedClip}
                  onClick={() => onApplyTransition('out', tr.type, tr.defaultDuration)}
                  className="flex-1 px-2 py-1 text-[11px] font-medium bg-[#222229] hover:bg-[#3B82F6] text-[#D4D4DC] hover:text-white rounded disabled:opacity-40 transition-colors cursor-pointer"
                >
                  Apply Out
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'titles' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <p className="text-[11px] text-[#8E8E9B] pb-2 border-b border-[#25252D]">
            Click a Motion Graphic (MOGRT) or Vector Shape template to insert onto V2.
          </p>
          {TITLE_TEMPLATES.map((tpl) => (
            <button
              key={tpl.name}
              type="button"
              onClick={() => onInsertTitlePreset(tpl.name, { ...tpl.config })}
              className="w-full p-2.5 rounded bg-[#131317] hover:bg-[#22222A] border border-[#27272E] text-left transition-colors cursor-pointer group"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Type className="w-3.5 h-3.5 text-[#8B5CF6] shrink-0" />
                  <span className="text-xs font-medium text-[#E4E4EC] truncate">{tpl.name}</span>
                </div>
                <Plus className="w-3.5 h-3.5 text-[#7D7D8A] group-hover:text-white shrink-0" />
              </div>
              <p className="text-[10px] text-[#7D7D8A] mt-1">{tpl.desc}</p>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
