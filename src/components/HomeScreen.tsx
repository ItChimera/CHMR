import { useRef } from 'react';
import {
  ArrowRight,
  BarChart3,
  ChevronRight,
  Clapperboard,
  FolderPlus,
  Play,
  Upload,
} from 'lucide-react';
import { MediaAsset, SequenceSettings, WorkspaceMode } from '../types/editor';
import { MetricsPlatformTab } from './MetricsDashboard';

interface HomeScreenProps {
  sequence: SequenceSettings;
  clipCount: number;
  totalDuration: number;
  assets: MediaAsset[];
  savedYouTubeUser: { name: string; avatarUrl?: string } | null;
  onOpenMetrics: (platform?: MetricsPlatformTab) => void;
  onOpenEditor: (workspace?: WorkspaceMode) => void;
  onOpenExport: () => void;
  onImportFiles: (files: FileList) => Promise<void> | void;
  onSelectAssetAndEdit: (assetId: string) => void;
}

function formatSecClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function HomeScreen({
  sequence,
  clipCount,
  totalDuration,
  assets,
  savedYouTubeUser,
  onOpenMetrics,
  onOpenEditor,
  onOpenExport,
  onImportFiles,
  onSelectAssetAndEdit,
}: HomeScreenProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await onImportFiles(files);
      onOpenEditor('Editing');
    }
    e.target.value = '';
  };

  const heroAsset = assets.find((a) => a.thumbnailUrl) || assets[0];

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto bg-[#09090B] text-[#F5F5F7]"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 85% 45% at 50% -8%, rgba(255,255,255,0.045), transparent 70%)',
      }}
    >
      <div className="max-w-[1280px] mx-auto px-6 sm:px-10 py-10 space-y-10">
        {/* Clean Apple-style Editorial Header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-white text-balance">
              Create, publish, and measure in one studio.
            </h1>
            <p className="text-[15px] text-[#9898A2] leading-relaxed">
              Open your multi-track timeline to cut and export up to 4K, or inspect live performance graphs for YouTube and Shorts.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/*,audio/*,image/*"
              onChange={handleFilesSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-[#E5E5EA] bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.09] rounded-xl transition-all duration-200 cursor-pointer whitespace-nowrap shrink-0 active:scale-[0.98]"
            >
              <FolderPlus className="w-4 h-4 text-[#0A84FF]" />
              <span>Import Media</span>
            </button>
          </div>
        </header>

        {/* Primary Dual Launchers */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Card 1 (7 cols): Edit & Upload Studio */}
          <section className="lg:col-span-7 rounded-2xl bg-[#131316] border border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] p-6 sm:p-7 flex flex-col justify-between gap-6">
            <div className="space-y-5">
              {/* Visual Sequence Preview Frame */}
              <div
                onClick={() => onOpenEditor('Editing')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenEditor('Editing');
                  }
                }}
                className="group relative aspect-[16/7.5] w-full rounded-xl overflow-hidden bg-[#0B0B0E] border border-white/[0.07] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]"
              >
                {heroAsset?.thumbnailUrl ? (
                  <img
                    src={heroAsset.thumbnailUrl}
                    alt={sequence.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover opacity-80 group-hover:opacity-95 group-hover:scale-[1.02] transition-all duration-500 ease-out"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#1A1A22] to-[#0D0D11]" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

                <div className="absolute inset-x-5 bottom-4 flex items-end justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-[#A1A1AA]">Active Sequence</div>
                    <div className="text-lg font-semibold tracking-tight text-white truncate">
                      {sequence.name}
                    </div>
                    <div className="text-xs font-mono-tabular text-[#D1D1D6] mt-0.5 flex items-center gap-2">
                      <span>
                        {sequence.width}×{sequence.height}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{sequence.fps} fps</span>
                      <span aria-hidden="true">·</span>
                      <span>{clipCount} clips</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatSecClock(totalDuration)}</span>
                    </div>
                  </div>

                  <span className="w-11 h-11 rounded-full bg-white text-[#09090B] flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform duration-200 shrink-0">
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </span>
                </div>
              </div>

              {/* Clean Title + Description */}
              <div className="space-y-1">
                <h2 className="text-xl font-semibold tracking-tight text-white flex items-center gap-2">
                  <Clapperboard className="w-5 h-5 text-[#0A84FF] shrink-0" />
                  <span>Edit &amp; Upload</span>
                </h2>
                <p className="text-xs text-[#9898A2] leading-relaxed">
                  Cut on the multi-track timeline, grade in Rec.709, generate captions, and export locally or publish directly to YouTube &amp; Shorts.
                </p>
              </div>

              {/* Minimal Hairline Workspace Links */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 border-t border-white/[0.06]">
                {(['Assembly', 'Editing', 'Color', 'Audio', 'Effects', 'Captions'] as WorkspaceMode[]).map((ws) => (
                  <button
                    key={ws}
                    type="button"
                    onClick={() => onOpenEditor(ws)}
                    className="py-1 text-xs font-medium text-[#9898A2] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {ws}
                  </button>
                ))}
              </div>
            </div>

            {/* Primary Tactile Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button
                type="button"
                onClick={() => onOpenEditor('Editing')}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-5 rounded-xl bg-[#0A84FF] hover:bg-[#2392FF] text-[13px] font-semibold text-white transition-all duration-150 cursor-pointer whitespace-nowrap active:scale-[0.99]"
              >
                <span>Open Timeline Editor</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onOpenExport}
                className="flex items-center justify-center gap-2 py-2.5 px-5 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.08] text-[13px] font-medium text-white transition-all duration-150 cursor-pointer whitespace-nowrap active:scale-[0.99]"
              >
                <Upload className="w-4 h-4 text-[#30D158]" />
                <span>Upload / Export</span>
              </button>
            </div>
          </section>

          {/* Card 2 (5 cols): Metrics & Performance Graphs */}
          <section className="lg:col-span-5 rounded-2xl bg-[#131316] border border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] p-6 sm:p-7 flex flex-col justify-between gap-6">
            <div className="space-y-5">
              {/* Minimalist Apple-Stocks-Inspired Curve Header */}
              <div className="rounded-xl bg-[#0C0C0F] border border-white/[0.06] p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-[#0A84FF]" />
                    <span className="text-xs font-medium text-[#E5E5EA]">Performance Analytics</span>
                  </div>
                  <span className="text-[11px] text-[#8E8E98]">YouTube · Shorts</span>
                </div>

                {/* Clean Vector Sparkline Silhouette */}
                <svg viewBox="0 0 320 68" className="w-full h-16 overflow-visible" aria-hidden="true">
                  <defs>
                    <linearGradient id="appleHomeSpark" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0A84FF" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="#0A84FF" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M 4 56 C 36 52, 54 40, 82 44 C 114 48, 134 26, 168 30 C 198 33, 224 14, 256 18 C 282 21, 298 10, 316 8 L 316 66 L 4 66 Z"
                    fill="url(#appleHomeSpark)"
                  />
                  <path
                    d="M 4 56 C 36 52, 54 40, 82 44 C 114 48, 134 26, 168 30 C 198 33, 224 14, 256 18 C 282 21, 298 10, 316 8"
                    fill="none"
                    stroke="#0A84FF"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <circle cx="316" cy="8" r="3.5" fill="#FFFFFF" stroke="#0A84FF" strokeWidth="2" />
                </svg>
              </div>

              <div className="space-y-1">
                <h2 className="text-xl font-semibold tracking-tight text-white">
                  Channel Metrics &amp; Graphs
                </h2>
                <p className="text-xs text-[#9898A2] leading-relaxed">
                  Compare views, likes, and engagement curves over time across every destination you upload to.
                </p>
              </div>

              {/* Clean Apple-Settings-Style Grouped Destination List */}
              <div className="divide-y divide-white/[0.06] rounded-xl bg-[#0D0D10] border border-white/[0.06] overflow-hidden">
                <button
                  type="button"
                  onClick={() => onOpenMetrics('youtube')}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-white/[0.04] transition-colors text-left cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-white">YouTube</div>
                    <div className="text-[11px] text-[#8E8E98] truncate">
                      {savedYouTubeUser
                        ? `${savedYouTubeUser.name} · Channel & video graphs`
                        : 'Sign in with Google for channel graphs'}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#6E6E78] shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => onOpenMetrics('youtube-shorts')}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-white/[0.04] transition-colors text-left cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-white">YouTube Shorts</div>
                    <div className="text-[11px] text-[#8E8E98] truncate">
                      Vertical clip views &amp; format ratio
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#6E6E78] shrink-0" />
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onOpenMetrics('youtube')}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-5 rounded-xl bg-white text-[#09090B] hover:bg-[#E5E5EA] text-[13px] font-semibold transition-all duration-150 cursor-pointer whitespace-nowrap active:scale-[0.99]"
            >
              <BarChart3 className="w-4 h-4" />
              <span>View Metrics &amp; Graphs</span>
            </button>
          </section>
        </div>

        {/* Clean Library Media Strip */}
        <section className="space-y-4 pt-2">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-base font-semibold tracking-tight text-white">Project Library</h2>
              <span className="text-xs font-mono-tabular text-[#8E8E98]">
                {assets.length} items
              </span>
            </div>
            <button
              type="button"
              onClick={() => onOpenEditor('Assembly')}
              className="flex items-center gap-1 text-xs font-medium text-[#0A84FF] hover:text-[#409CFF] transition-colors cursor-pointer"
            >
              <span>Open in Assembly</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {assets.slice(0, 6).map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onSelectAssetAndEdit(asset.id)}
                className="group text-left space-y-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF] rounded-xl"
              >
                <div className="aspect-video rounded-xl overflow-hidden bg-[#131316] border border-white/[0.08] group-hover:border-[#0A84FF]/70 transition-colors">
                  {asset.thumbnailUrl ? (
                    <img
                      src={asset.thumbnailUrl}
                      alt={asset.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-300 ease-out"
                    />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center text-[11px] font-mono text-[#8E8E98]"
                      style={asset.matteColor ? { backgroundColor: asset.matteColor } : undefined}
                    >
                      {asset.type.toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="px-0.5">
                  <div className="text-xs font-medium text-[#EAEAF0] group-hover:text-white truncate transition-colors">
                    {asset.name}
                  </div>
                  <div className="text-[11px] font-mono-tabular text-[#8E8E98] mt-0.5">
                    {formatSecClock(asset.duration)} · {asset.type}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
