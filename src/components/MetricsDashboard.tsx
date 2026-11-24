import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Clapperboard,
  ExternalLink,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  TrendingUp,
} from 'lucide-react';
import {
  extractYouTubeActivationUrl,
  fetchMyYouTubeChannel,
  fetchRecentYouTubeUploads,
  getYouTubeAccessToken,
  initYouTubeAuth,
  signInYouTube,
  YOUTUBE_TEST_USERS_URL,
  YouTubeChannelInfo,
  YouTubeRecentVideo,
} from '../utils/youtubeAuth';

export type MetricsPlatformTab = 'youtube' | 'youtube-shorts';
type ChartMetricKey = 'views' | 'likes' | 'comments' | 'engagement';
type SortMode = 'date' | 'views' | 'engagement';

interface MetricsDashboardProps {
  initialPlatform?: MetricsPlatformTab;
  onBackHome: () => void;
  onOpenEditor: () => void;
  onOpenExport: () => void;
  onAccountStatusChanged?: () => void;
}

interface NormalizedVideoPoint {
  id: string;
  title: string;
  shortLabel: string;
  dateLabel: string;
  timestampMs: number;
  durationSec?: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementPct: number;
  thumbnailUrl?: string;
  externalUrl?: string;
  isShort?: boolean;
  privacyStatus?: string;
}

function formatCompact(val: number): string {
  if (!Number.isFinite(val)) return '—';
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return String(Math.round(val));
}

function formatMetricCount(val?: string | number): string {
  if (val === undefined || val === null || val === '') return '—';
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num)) return String(val);
  return num.toLocaleString();
}

function formatDurationSeconds(sec?: number): string {
  if (sec === undefined || !Number.isFinite(sec) || sec <= 0) return '—';
  const mins = Math.floor(sec / 60);
  const rem = Math.floor(sec % 60);
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

function formatDateShort(isoOrUnix?: string | number): string {
  if (!isoOrUnix) return '';
  const date = typeof isoOrUnix === 'number' ? new Date(isoOrUnix * 1000) : new Date(isoOrUnix);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatAxisShort(isoOrUnix?: string | number): string {
  if (!isoOrUnix) return '';
  const date = typeof isoOrUnix === 'number' ? new Date(isoOrUnix * 1000) : new Date(isoOrUnix);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function MetricsDashboard({
  initialPlatform = 'youtube',
  onBackHome,
  onOpenEditor,
  onOpenExport,
  onAccountStatusChanged,
}: MetricsDashboardProps) {
  const [activeTab, setActiveTab] = useState<MetricsPlatformTab>(initialPlatform);
  const [chartMetric, setChartMetric] = useState<ChartMetricKey>('views');
  const [sortMode, setSortMode] = useState<SortMode>('date');
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [showAllOnShorts, setShowAllOnShorts] = useState(false);

  // YouTube live state
  const [ytConnected, setYtConnected] = useState(false);
  const [ytHasToken, setYtHasToken] = useState(false);
  const [ytUser, setYtUser] = useState<{ name: string; email: string; avatarUrl?: string } | null>(null);
  const [ytChannel, setYtChannel] = useState<YouTubeChannelInfo | null>(null);
  const [ytVideos, setYtVideos] = useState<YouTubeRecentVideo[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytSigningIn, setYtSigningIn] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);

  const [metricsLayout, setMetricsLayout] = useState<{
    graphSplitPct: number;
    graphHeightPx: number;
    tableHeightPx: number | null;
    expandedPanel: 'none' | 'graph' | 'breakdown' | 'table';
  }>(() => {
    try {
      const raw = localStorage.getItem('chmr_metrics_layout_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          graphSplitPct:
            typeof parsed.graphSplitPct === 'number'
              ? Math.max(36, Math.min(82, parsed.graphSplitPct))
              : 66,
          graphHeightPx:
            typeof parsed.graphHeightPx === 'number'
              ? Math.max(170, Math.min(540, parsed.graphHeightPx))
              : 260,
          tableHeightPx:
            typeof parsed.tableHeightPx === 'number'
              ? Math.max(180, Math.min(720, parsed.tableHeightPx))
              : null,
          expandedPanel:
            parsed.expandedPanel === 'graph' ||
            parsed.expandedPanel === 'breakdown' ||
            parsed.expandedPanel === 'table'
              ? parsed.expandedPanel
              : 'none',
        };
      }
    } catch {
      // ignore
    }
    return { graphSplitPct: 66, graphHeightPx: 260, tableHeightPx: null, expandedPanel: 'none' };
  });
  const [activeMetricsResize, setActiveMetricsResize] = useState<'split' | 'graph-h' | 'table-h' | null>(null);
  const [graphSvgWidth, setGraphSvgWidth] = useState(760);

  const graphsRowRef = useRef<HTMLDivElement | null>(null);
  const graphPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('chmr_metrics_layout_v1', JSON.stringify(metricsLayout));
    } catch {
      // ignore
    }
  }, [metricsLayout]);

  useEffect(() => {
    setActiveTab(initialPlatform);
    setHoveredIdx(null);
  }, [initialPlatform]);

  const loadYouTubeMetrics = useCallback(async (tokenOverride?: string | null) => {
    const token = tokenOverride ?? getYouTubeAccessToken();
    if (!token) {
      setYtHasToken(false);
      return;
    }
    setYtHasToken(true);
    setYtLoading(true);
    setYtError(null);
    try {
      const ch = await fetchMyYouTubeChannel(token);
      setYtChannel(ch);
      if (ch?.uploadsPlaylistId) {
        const list = await fetchRecentYouTubeUploads(ch.uploadsPlaylistId, token, 20);
        setYtVideos(list);
      } else {
        setYtVideos([]);
      }
    } catch (err) {
      setYtError(err instanceof Error ? err.message : 'Unable to load YouTube channel metrics.');
      if (!getYouTubeAccessToken()) {
        setYtHasToken(false);
      }
    } finally {
      setYtLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsub = initYouTubeAuth(
      (user, token) => {
        setYtConnected(true);
        setYtUser({
          name: user.displayName || 'YouTube Creator',
          email: user.email || '',
          avatarUrl: user.photoURL || undefined,
        });
        if (token) {
          loadYouTubeMetrics(token);
        } else {
          setYtHasToken(false);
        }
      },
      () => {
        setYtConnected(false);
        setYtHasToken(false);
        setYtUser(null);
        setYtChannel(null);
        setYtVideos([]);
      }
    );

    const handleOAuthMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (
        origin !== window.location.origin &&
        !origin.endsWith('.ai.studio') &&
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost')
      ) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'youtube') {
        loadYouTubeMetrics();
      }
    };
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel('chmr_oauth');
        bc.onmessage = (event) => {
          if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'youtube') {
            loadYouTubeMetrics();
          }
        };
      } catch {
        bc = null;
      }
    }

    window.addEventListener('message', handleOAuthMessage);

    return () => {
      unsub();
      window.removeEventListener('message', handleOAuthMessage);
      bc?.close();
    };
  }, [loadYouTubeMetrics]);

  const handleYouTubeAuthorize = async () => {
    setYtSigningIn(true);
    setYtError(null);
    try {
      const { user, accessToken } = await signInYouTube();
      setYtConnected(true);
      setYtUser({
        name: user.displayName || 'YouTube Creator',
        email: user.email || '',
        avatarUrl: user.photoURL || undefined,
      });
      await loadYouTubeMetrics(accessToken);
      onAccountStatusChanged?.();
    } catch (err) {
      setYtError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setYtSigningIn(false);
    }
  };

  const shortsVideos = useMemo(() => ytVideos.filter((v) => v.isShort), [ytVideos]);

  const rawPoints: NormalizedVideoPoint[] = useMemo(() => {
    const sourceList = activeTab === 'youtube-shorts' && !showAllOnShorts ? shortsVideos : ytVideos;
    return sourceList.map((v) => {
      const views = Number(v.viewCount || 0);
      const likes = Number(v.likeCount || 0);
      const comments = Number(v.commentCount || 0);
      const engagementPct = views > 0 ? ((likes + comments) / views) * 100 : 0;
      const ts = v.publishedAt ? new Date(v.publishedAt).getTime() : 0;
      return {
        id: v.id,
        title: v.title,
        shortLabel: formatAxisShort(v.publishedAt) || v.title.slice(0, 10),
        dateLabel: formatDateShort(v.publishedAt),
        timestampMs: Number.isFinite(ts) ? ts : 0,
        durationSec: v.durationSeconds,
        views,
        likes,
        comments,
        shares: 0,
        engagementPct,
        thumbnailUrl: v.thumbnailUrl,
        externalUrl: v.url,
        isShort: v.isShort,
        privacyStatus: v.privacyStatus,
      };
    });
  }, [activeTab, ytVideos, shortsVideos, showAllOnShorts]);

  const filteredPoints = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q ? rawPoints.filter((p) => p.title.toLowerCase().includes(q)) : [...rawPoints];
    if (sortMode === 'views') {
      list.sort((a, b) => b.views - a.views);
    } else if (sortMode === 'engagement') {
      list.sort((a, b) => b.engagementPct - a.engagementPct);
    } else {
      list.sort((a, b) => b.timestampMs - a.timestampMs);
    }
    return list;
  }, [rawPoints, searchQuery, sortMode]);

  // Chronological order left -> right for trend graph
  const chartSeries = useMemo(() => {
    const ordered = [...filteredPoints];
    if (sortMode === 'date') {
      ordered.reverse();
    }
    return ordered.slice(-14);
  }, [filteredPoints, sortMode]);

  const getPointValue = useCallback(
    (p: NormalizedVideoPoint): number => {
      if (chartMetric === 'likes') return p.likes;
      if (chartMetric === 'comments') return p.comments;
      if (chartMetric === 'engagement') return Number(p.engagementPct.toFixed(2));
      return p.views;
    },
    [chartMetric]
  );

  const chartStats = useMemo(() => {
    if (chartSeries.length === 0) {
      return { maxVal: 10, avgVal: 0, totalViews: 0, totalLikes: 0, totalComments: 0, avgEngPct: 0 };
    }
    const vals = chartSeries.map(getPointValue);
    const maxVal = Math.max(...vals, chartMetric === 'engagement' ? 1 : 10);
    const avgVal = vals.reduce((s, v) => s + v, 0) / vals.length;
    const totalViews = chartSeries.reduce((s, p) => s + p.views, 0);
    const totalLikes = chartSeries.reduce((s, p) => s + p.likes, 0);
    const totalComments = chartSeries.reduce((s, p) => s + p.comments, 0);
    const avgEngPct =
      totalViews > 0 ? ((totalLikes + totalComments + chartSeries.reduce((s, p) => s + p.shares, 0)) / totalViews) * 100 : 0;
    return { maxVal, avgVal, totalViews, totalLikes, totalComments, avgEngPct };
  }, [chartSeries, getPointValue, chartMetric]);

  // YouTube format comparison breakdown (Shorts vs Long-Form)
  const ytFormatSplit = useMemo(() => {
    const shorts = ytVideos.filter((v) => v.isShort);
    const standard = ytVideos.filter((v) => !v.isShort);
    const sumViews = (arr: YouTubeRecentVideo[]) => arr.reduce((s, v) => s + Number(v.viewCount || 0), 0);
    const shortsViews = sumViews(shorts);
    const stdViews = sumViews(standard);
    const total = Math.max(1, shortsViews + stdViews);
    return {
      shortsCount: shorts.length,
      standardCount: standard.length,
      shortsViews,
      stdViews,
      shortsSharePct: Math.round((shortsViews / total) * 100),
      stdSharePct: Math.round((stdViews / total) * 100),
    };
  }, [ytVideos]);

  const handleRefreshActive = () => {
    loadYouTubeMetrics();
  };

  const isLoadingActive = ytLoading;
  const isConnectedActive = ytConnected && ytHasToken;

  useEffect(() => {
    const el = graphPanelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        if (w > 220) setGraphSvgWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isConnectedActive, metricsLayout.expandedPanel]);

  const isMetricsLayoutCustomized =
    metricsLayout.graphSplitPct !== 66 ||
    metricsLayout.graphHeightPx !== 260 ||
    metricsLayout.tableHeightPx !== null ||
    metricsLayout.expandedPanel !== 'none';

  const startMetricsResize = (kind: 'split' | 'graph-h' | 'table-h', e: React.MouseEvent) => {
    e.preventDefault();
    setActiveMetricsResize(kind);
    const startX = e.clientX;
    const startY = e.clientY;
    const startSplit = metricsLayout.graphSplitPct;
    const startGraphH = metricsLayout.graphHeightPx;
    const startTableH = metricsLayout.tableHeightPx ?? 360;
    const rowWidth = graphsRowRef.current?.getBoundingClientRect().width || 1100;

    const onMove = (ev: MouseEvent) => {
      if (kind === 'split') {
        const deltaPct = ((ev.clientX - startX) / Math.max(400, rowWidth)) * 100;
        const nextPct = Math.max(36, Math.min(82, startSplit + deltaPct));
        setMetricsLayout((prev) => ({ ...prev, graphSplitPct: Math.round(nextPct * 10) / 10 }));
      } else if (kind === 'graph-h') {
        const nextH = Math.max(170, Math.min(540, startGraphH + (ev.clientY - startY)));
        setMetricsLayout((prev) => ({ ...prev, graphHeightPx: Math.round(nextH) }));
      } else {
        const nextH = Math.max(180, Math.min(720, startTableH + (ev.clientY - startY)));
        setMetricsLayout((prev) => ({ ...prev, tableHeightPx: Math.round(nextH) }));
      }
    };

    const onUp = () => {
      setActiveMetricsResize(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // SVG chart coordinate system
  const svgW = Math.max(320, graphSvgWidth);
  const svgH = metricsLayout.graphHeightPx;
  const padL = 52;
  const padR = 20;
  const padT = 22;
  const padB = 34;
  const plotW = svgW - padL - padR;
  const plotH = Math.max(80, svgH - padT - padB);

  const linePoints = useMemo(() => {
    if (chartSeries.length === 0) return '';
    const step = plotW / Math.max(1, chartSeries.length);
    return chartSeries
      .map((pt, i) => {
        const val = getPointValue(pt);
        const x = padL + i * step + step / 2;
        const y = padT + plotH - (val / chartStats.maxVal) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [chartSeries, getPointValue, chartStats.maxVal, plotW, plotH]);

  const areaPoints = useMemo(() => {
    if (chartSeries.length === 0) return '';
    const step = plotW / Math.max(1, chartSeries.length);
    const firstX = padL + step / 2;
    const lastX = padL + (chartSeries.length - 1) * step + step / 2;
    const baseY = padT + plotH;
    return `${firstX.toFixed(1)},${baseY} ${linePoints} ${lastX.toFixed(1)},${baseY}`;
  }, [chartSeries.length, linePoints, plotW, plotH]);

  const hoveredPoint = hoveredIdx !== null ? chartSeries[hoveredIdx] || null : null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#121214] text-[#EAEAF0]">
      <div className="max-w-[1360px] mx-auto px-6 py-6 space-y-5">
        {/* Page Header + Platform Controls */}
        <div className="flex items-center justify-between gap-4 flex-wrap pb-4 border-b border-[#25252D]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBackHome}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#D4D4DC] bg-[#18181D] hover:bg-[#22222A] border border-[#2E2E37] rounded transition-colors cursor-pointer shrink-0 whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Home</span>
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-[#F4F4F7] flex items-center gap-2 truncate">
                <BarChart3 className="w-4 h-4 text-[#3B82F6] shrink-0" />
                <span>Channel Performance &amp; Video Graphs</span>
              </h1>
              <p className="text-xs text-[#8E8E9B] truncate">
                Live channel analytics, upload trend graphs, and engagement breakdowns across your connected accounts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            {isMetricsLayoutCustomized && (
              <button
                type="button"
                onClick={() =>
                  setMetricsLayout({
                    graphSplitPct: 66,
                    graphHeightPx: 260,
                    tableHeightPx: null,
                    expandedPanel: 'none',
                  })
                }
                title="Reset Metrics Window Sizes"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#D4D4DC] bg-[#18181D] hover:bg-[#22222A] border border-[#2E2E37] rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Layout</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleRefreshActive}
              disabled={isLoadingActive}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#D4D4DC] bg-[#18181D] hover:bg-[#22222A] border border-[#2E2E37] rounded transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingActive ? 'animate-spin' : ''}`} />
              <span>Refresh Data</span>
            </button>
            <button
              type="button"
              onClick={onOpenEditor}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#EAEAF0] bg-[#202028] hover:bg-[#2A2A34] border border-[#32323E] rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Clapperboard className="w-3.5 h-3.5 text-[#60A5FA]" />
              <span>Open Editor</span>
            </button>
            <button
              type="button"
              onClick={onOpenExport}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#3B82F6] rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>Upload Video</span>
            </button>
          </div>
        </div>

        {/* Platform Switcher + Search/Sort Toolbar */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1 p-1 bg-[#18181D] border border-[#2A2A34] rounded">
            {(
              [
                { id: 'youtube', label: 'YouTube' },
                { id: 'youtube-shorts', label: 'YouTube Shorts' },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setHoveredIdx(null);
                  }}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active ? 'bg-[#2563EB] text-white' : 'text-[#9A9AA6] hover:text-[#F4F4F7]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#7D7D8A] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter uploads..."
                className="pl-8 pr-3 py-1.5 w-52 bg-[#18181D] border border-[#2A2A34] focus:border-[#3B82F6] rounded text-xs text-[#F4F4F7] placeholder-[#6E6E7C] outline-none"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#18181D] border border-[#2A2A34] rounded">
              {(
                [
                  { id: 'date', label: 'Latest' },
                  { id: 'views', label: 'Top Views' },
                  { id: 'engagement', label: 'Top Engagement' },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSortMode(s.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    sortMode === s.id
                      ? 'bg-[#272732] text-white'
                      : 'text-[#8E8E9B] hover:text-[#D4D4DC]'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Disconnected / Sign-In Banner when account isn't authorized */}
        {!isConnectedActive && (
          <div className="p-6 rounded border border-[#2E2E37] bg-[#18181D] flex items-center justify-between gap-6 flex-wrap">
            <div className="space-y-1.5 max-w-2xl">
              <h2 className="text-sm font-semibold text-[#F4F4F7]">
                {ytConnected && ytUser
                  ? `Authorize YouTube metrics for ${ytUser.name}`
                  : 'Connect your YouTube account to inspect channel & upload graphs'}
              </h2>
              <p className="text-xs text-[#9A9AA6] leading-relaxed">
                {ytConnected ? (
                  'Google access tokens stay strictly in memory for security. Authorize once in this window to render live channel KPIs and per-video graphs.'
                ) : (
                  <>
                    Sign in with Google to stream live YouTube &amp; Shorts stats, or add another Gmail under{' '}
                    <a
                      href={YOUTUBE_TEST_USERS_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#60A5FA] hover:underline"
                    >
                      Test users
                    </a>{' '}
                    (or configure local OAuth keys in Desktop &amp; Updates).
                  </>
                )}
              </p>
            </div>

            <button
              type="button"
              disabled={ytSigningIn}
              onClick={handleYouTubeAuthorize}
              className="flex items-center gap-2 px-4 py-2 rounded bg-white hover:bg-[#F3F4F6] text-[#1F2937] text-xs font-semibold border border-[#D1D5DB] transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <span>
                {ytSigningIn
                  ? 'Authorizing...'
                  : ytConnected
                  ? 'Authorize & Load Graphs'
                  : 'Sign in with Google'}
              </span>
            </button>
          </div>
        )}

        {ytError && (() => {
          const activationUrl = extractYouTubeActivationUrl(ytError);
          if (activationUrl) {
            return (
              <div className="p-4 rounded bg-[#2B1418] border border-[#EF4444]/40 flex items-center justify-between gap-4 flex-wrap">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="text-xs font-semibold text-[#FEE2E2]">
                    YouTube Data API v3 is not enabled on this Google Cloud project yet
                  </div>
                  <p className="text-xs text-[#FCA5A5] leading-relaxed">
                    Click Enable YouTube Data API v3, turn it on in Google Cloud Console, wait ~30 seconds, then click Retry.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={activationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#EF4444] hover:bg-[#DC2626] text-xs font-semibold text-white whitespace-nowrap"
                  >
                    <span>Enable YouTube Data API v3</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <button
                    type="button"
                    onClick={() => loadYouTubeMetrics()}
                    className="px-3 py-1.5 rounded bg-[#222229] hover:bg-[#2C2C35] text-xs font-medium text-[#F4F4F7] cursor-pointer whitespace-nowrap"
                  >
                    Retry
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div className="p-3.5 rounded bg-[#2B1418] border border-[#EF4444]/40 text-xs text-[#FCA5A5]">
              {ytError}
            </div>
          );
        })()}

        {/* Connected View: KPI Strip + Interactive Graphs + Table */}
        {isConnectedActive && (
          <>
            {/* Account Header + 4-Column KPI Strip */}
            <div className="rounded border border-[#2A2A34] bg-[#18181D] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#25252D] flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  {ytChannel?.avatarUrl && (
                    <img
                      src={ytChannel.avatarUrl}
                      alt="Channel avatar"
                      referrerPolicy="no-referrer"
                      className="w-9 h-9 rounded object-cover border border-[#2E2E37] shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#F4F4F7] truncate">
                      {ytChannel?.title || ytUser?.name || 'YouTube Channel'}
                    </div>
                    <div className="text-xs text-[#8E8E9B] flex items-center gap-1.5">
                      {ytChannel?.handle && (
                        <>
                          <span className="font-mono-tabular">{ytChannel.handle}</span>
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      <span>
                        {activeTab === 'youtube-shorts'
                          ? 'YouTube Shorts Analytics'
                          : 'YouTube Channel Analytics'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  {activeTab === 'youtube-shorts' && ytVideos.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllOnShorts((v) => !v)}
                      className="px-3 py-1.5 text-xs font-medium text-[#D4D4DC] bg-[#202028] hover:bg-[#2A2A34] border border-[#2E2E38] rounded cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {showAllOnShorts ? 'Shorts Only' : `Include All ${ytVideos.length} Uploads`}
                    </button>
                  )}
                  <a
                    href={
                      ytChannel
                        ? `https://studio.youtube.com/channel/${ytChannel.id}/analytics/tab-overview/period-default`
                        : 'https://studio.youtube.com'
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#D4D4DC] bg-[#202028] hover:bg-[#2A2A34] rounded whitespace-nowrap shrink-0"
                  >
                    <span>YouTube Studio</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[#25252D]">
                <div className="px-5 py-3.5">
                  <div className="text-[11px] text-[#8E8E9B]">Subscribers</div>
                  <div className="text-xl font-semibold font-mono-tabular text-[#F4F4F7] mt-0.5">
                    {formatMetricCount(ytChannel?.subscriberCount)}
                  </div>
                </div>
                <div className="px-5 py-3.5">
                  <div className="text-[11px] text-[#8E8E9B]">Total Channel Views</div>
                  <div className="text-xl font-semibold font-mono-tabular text-[#F4F4F7] mt-0.5">
                    {formatMetricCount(ytChannel?.viewCount)}
                  </div>
                </div>
                <div className="px-5 py-3.5">
                  <div className="text-[11px] text-[#8E8E9B]">Total Videos</div>
                  <div className="text-xl font-semibold font-mono-tabular text-[#F4F4F7] mt-0.5">
                    {formatMetricCount(ytChannel?.videoCount)}
                  </div>
                </div>
                <div className="px-5 py-3.5">
                  <div className="text-[11px] text-[#8E8E9B]">Avg Engagement (Sample)</div>
                  <div className="text-xl font-semibold font-mono-tabular text-[#60A5FA] mt-0.5">
                    {chartSeries.length > 0 ? `${chartStats.avgEngPct.toFixed(1)}%` : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Graphs Row (Primary Trend + Distribution Panel) */}
            {metricsLayout.expandedPanel !== 'table' && (
              <div
                ref={graphsRowRef}
                className={`flex flex-col lg:flex-row gap-4 lg:gap-0 items-stretch ${
                  activeMetricsResize === 'split' ? 'select-none cursor-col-resize' : ''
                } ${activeMetricsResize === 'graph-h' ? 'select-none cursor-row-resize' : ''}`}
              >
                {/* Left Window: Interactive Bar + Trend Curve Graph */}
                {metricsLayout.expandedPanel !== 'breakdown' && (
                  <div
                    style={
                      metricsLayout.expandedPanel === 'graph'
                        ? { width: '100%' }
                        : { flexBasis: `${metricsLayout.graphSplitPct}%` }
                    }
                    className={`rounded border border-[#2A2A34] bg-[#18181D] p-5 pb-3 flex flex-col justify-between min-w-0 relative ${
                      metricsLayout.expandedPanel === 'graph' ? 'w-full' : 'w-full lg:shrink-0'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4 flex-wrap pb-4 border-b border-[#24242D]">
                      <div>
                        <h2 className="text-sm font-semibold text-[#F4F4F7] flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-[#3B82F6]" />
                          <span>Upload Performance Graph</span>
                        </h2>
                        <p className="text-[11px] text-[#8E8E9B] mt-0.5">
                          Hover any bar or data point to inspect exact upload figures ({chartSeries.length} uploads plotted)
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1 p-1 bg-[#121216] border border-[#262630] rounded">
                          {(
                            [
                              { id: 'views', label: 'Views' },
                              { id: 'likes', label: 'Likes' },
                              { id: 'comments', label: 'Comments' },
                              { id: 'engagement', label: 'Engagement %' },
                            ] as const
                          ).map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setChartMetric(m.id)}
                              className={`px-2.5 py-1 text-[11px] font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                chartMetric === m.id
                                  ? 'bg-[#2563EB] text-white'
                                  : 'text-[#8E8E9B] hover:text-[#EAEAF0]'
                              }`}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-0.5 p-0.5 bg-[#121216] border border-[#262630] rounded">
                          <button
                            type="button"
                            onClick={() =>
                              setMetricsLayout((prev) => ({
                                ...prev,
                                graphHeightPx: Math.max(170, prev.graphHeightPx - 40),
                              }))
                            }
                            title="Make Graph Smaller"
                            aria-label="Make graph smaller"
                            className="p-1 text-[#8E8E9B] hover:text-white rounded-sm cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setMetricsLayout((prev) => ({
                                ...prev,
                                graphHeightPx: Math.min(540, prev.graphHeightPx + 40),
                              }))
                            }
                            title="Make Graph Larger"
                            aria-label="Make graph larger"
                            className="p-1 text-[#8E8E9B] hover:text-white rounded-sm cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setMetricsLayout((prev) => ({
                                ...prev,
                                expandedPanel: prev.expandedPanel === 'graph' ? 'none' : 'graph',
                              }))
                            }
                            title={
                              metricsLayout.expandedPanel === 'graph'
                                ? 'Restore Split View'
                                : 'Expand Graph Window'
                            }
                            aria-label="Toggle expand graph window"
                            className={`p-1 rounded-sm cursor-pointer ${
                              metricsLayout.expandedPanel === 'graph'
                                ? 'bg-[#2563EB]/25 text-[#93C5FD]'
                                : 'text-[#8E8E9B] hover:text-white'
                            }`}
                          >
                            {metricsLayout.expandedPanel === 'graph' ? (
                              <Minimize2 className="w-3 h-3" />
                            ) : (
                              <Maximize2 className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {isLoadingActive && chartSeries.length === 0 ? (
                      <div
                        style={{ height: `${metricsLayout.graphHeightPx}px` }}
                        className="flex items-center justify-center"
                      >
                        <div className="w-full h-44 rounded bg-[#141418] animate-pulse" />
                      </div>
                    ) : chartSeries.length === 0 ? (
                      <div
                        style={{ height: `${metricsLayout.graphHeightPx}px` }}
                        className="flex flex-col items-center justify-center text-center px-6 space-y-2.5"
                      >
                        <div className="text-xs font-medium text-[#D4D4DC]">
                          No video data available for this graph yet
                        </div>
                        <p className="text-[11px] text-[#8E8E9B] max-w-md">
                          {activeTab === 'youtube-shorts' && ytVideos.length > 0
                            ? 'No #Shorts or vertical clips under 60s were found in your latest uploads. Toggle "Include All Uploads" above to inspect long-form graphs.'
                            : 'Upload a video or Short from the CHMR Studio to begin tracking real performance trends here.'}
                        </p>
                        <button
                          type="button"
                          onClick={onOpenExport}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#3B82F6] rounded cursor-pointer"
                        >
                          Open Upload / Export
                        </button>
                      </div>
                    ) : (
                      <div ref={graphPanelRef} className="relative pt-3">
                        {/* Interactive Readout Bar */}
                        <div className="mb-2 h-6 flex items-center justify-between text-[11px] bg-[#131317] border border-[#24242D] rounded px-3">
                          {hoveredPoint ? (
                            <>
                              <span className="text-[#F4F4F7] font-medium truncate pr-4">
                                {hoveredPoint.title}
                                {hoveredPoint.dateLabel ? ` · ${hoveredPoint.dateLabel}` : ''}
                              </span>
                              <span className="font-mono-tabular text-[#93C5FD] shrink-0">
                                Views {formatMetricCount(hoveredPoint.views)} · Likes{' '}
                                {formatMetricCount(hoveredPoint.likes)} · Comments{' '}
                                {formatMetricCount(hoveredPoint.comments)} · {hoveredPoint.engagementPct.toFixed(1)}%
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-[#8E8E9B]">
                                Sample Total: {formatMetricCount(chartStats.totalViews)} views ·{' '}
                                {formatMetricCount(chartStats.totalLikes)} likes
                              </span>
                              <span className="font-mono-tabular text-[#A1A1AF]">
                                Average:{' '}
                                {chartMetric === 'engagement'
                                  ? `${chartStats.avgVal.toFixed(1)}%`
                                  : formatCompact(chartStats.avgVal)}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Precision SVG Chart */}
                        <svg
                          viewBox={`0 0 ${svgW} ${svgH}`}
                          style={{ height: `${metricsLayout.graphHeightPx}px` }}
                          className="w-full select-none overflow-visible"
                          role="img"
                          aria-label="Upload performance graph"
                        >
                      <defs>
                        <linearGradient id="chmrAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.28" />
                          <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.02" />
                        </linearGradient>
                      </defs>

                      {/* Horizontal Gridlines & Y-Axis Ticks */}
                      {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                        const y = padT + plotH - frac * plotH;
                        const tickVal = chartStats.maxVal * frac;
                        return (
                          <g key={frac}>
                            <line
                              x1={padL}
                              y1={y}
                              x2={svgW - padR}
                              y2={y}
                              stroke="#25252E"
                              strokeDasharray={frac === 0 ? undefined : '3 3'}
                            />
                            <text
                              x={padL - 8}
                              y={y + 3.5}
                              textAnchor="end"
                              fill="#7D7D8A"
                              fontSize="10"
                              fontFamily="JetBrains Mono, monospace"
                            >
                              {chartMetric === 'engagement'
                                ? `${tickVal.toFixed(1)}%`
                                : formatCompact(tickVal)}
                            </text>
                          </g>
                        );
                      })}

                      {/* Area Under Trend Curve */}
                      {chartSeries.length > 1 && (
                        <polygon points={areaPoints} fill="url(#chmrAreaGrad)" />
                      )}

                      {/* Vertical Bars */}
                      {chartSeries.map((pt, i) => {
                        const step = plotW / chartSeries.length;
                        const barW = Math.min(34, Math.max(10, step * 0.52));
                        const val = getPointValue(pt);
                        const barH = Math.max(2, (val / chartStats.maxVal) * plotH);
                        const x = padL + i * step + (step - barW) / 2;
                        const y = padT + plotH - barH;
                        const isHovered = hoveredIdx === i;
                        return (
                          <g
                            key={pt.id}
                            onMouseEnter={() => setHoveredIdx(i)}
                            onMouseLeave={() => setHoveredIdx(null)}
                            className="cursor-pointer"
                          >
                            {/* Full-column hover hit target */}
                            <rect
                              x={padL + i * step}
                              y={padT}
                              width={step}
                              height={plotH + padB}
                              fill="transparent"
                            />
                            <rect
                              x={x}
                              y={y}
                              width={barW}
                              height={barH}
                              rx={2}
                              fill={isHovered ? '#60A5FA' : '#2563EB'}
                              opacity={hoveredIdx === null || isHovered ? 0.92 : 0.45}
                            />
                            {/* X-Axis label */}
                            {(chartSeries.length <= 8 || i % 2 === 0 || isHovered) && (
                              <text
                                x={padL + i * step + step / 2}
                                y={svgH - 10}
                                textAnchor="middle"
                                fill={isHovered ? '#F4F4F7' : '#7D7D8A'}
                                fontSize="10"
                                fontFamily="JetBrains Mono, monospace"
                              >
                                {pt.shortLabel}
                              </text>
                            )}
                          </g>
                        );
                      })}

                      {/* Trend Line Overlay */}
                      {chartSeries.length > 1 && (
                        <polyline
                          fill="none"
                          stroke="#93C5FD"
                          strokeWidth="2"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          points={linePoints}
                          pointerEvents="none"
                        />
                      )}

                      {/* Data Point Markers */}
                      {chartSeries.map((pt, i) => {
                        const step = plotW / chartSeries.length;
                        const val = getPointValue(pt);
                        const cx = padL + i * step + step / 2;
                        const cy = padT + plotH - (val / chartStats.maxVal) * plotH;
                        const isHovered = hoveredIdx === i;
                        return (
                          <circle
                            key={`dot-${pt.id}`}
                            cx={cx}
                            cy={cy}
                            r={isHovered ? 5 : 3}
                            fill={isHovered ? '#FFFFFF' : '#60A5FA'}
                            stroke="#121216"
                            strokeWidth="1.5"
                            pointerEvents="none"
                          />
                        );
                      })}
                    </svg>
                  </div>
                )}

                    {/* Bottom Graph Window Height Drag Handle */}
                    <div
                      role="separator"
                      aria-orientation="horizontal"
                      aria-label="Resize graph height"
                      title="Drag to resize Graph height (double-click to reset)"
                      onMouseDown={(e) => startMetricsResize('graph-h', e)}
                      onDoubleClick={() =>
                        setMetricsLayout((prev) => ({ ...prev, graphHeightPx: 260 }))
                      }
                      className="mt-2 h-2 -mx-2 cursor-row-resize flex items-center justify-center group"
                    >
                      <div
                        className={`h-[2px] w-14 rounded-full transition-colors ${
                          activeMetricsResize === 'graph-h'
                            ? 'bg-[#60A5FA]'
                            : 'bg-[#2B2B36] group-hover:bg-[#60A5FA]'
                        }`}
                      />
                    </div>
                  </div>
                )}

                {/* Draggable Vertical Split Divider (Graph <-> Breakdown) */}
                {metricsLayout.expandedPanel === 'none' && (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize graph and breakdown panels"
                    title="Drag to adjust panel width (double-click to reset)"
                    onMouseDown={(e) => startMetricsResize('split', e)}
                    onDoubleClick={() =>
                      setMetricsLayout((prev) => ({ ...prev, graphSplitPct: 66 }))
                    }
                    className="hidden lg:flex w-4 shrink-0 cursor-col-resize items-center justify-center group"
                  >
                    <div
                      className={`w-[2px] h-14 rounded-full transition-colors ${
                        activeMetricsResize === 'split'
                          ? 'bg-[#60A5FA]'
                          : 'bg-[#2C2C36] group-hover:bg-[#60A5FA]'
                      }`}
                    />
                  </div>
                )}

                {/* Right Window: Format & Engagement Distribution */}
                {metricsLayout.expandedPanel !== 'graph' && (
                  <div className="flex-1 min-w-0 rounded border border-[#2A2A34] bg-[#18181D] p-5 flex flex-col justify-between space-y-4">
                    <div className="space-y-5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h2 className="text-sm font-semibold text-[#F4F4F7]">Format &amp; Engagement Mix</h2>
                          <p className="text-[11px] text-[#8E8E9B] mt-0.5">
                            Shorts vs Long-Form share across your recent {ytVideos.length} uploads
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setMetricsLayout((prev) => ({
                              ...prev,
                              expandedPanel: prev.expandedPanel === 'breakdown' ? 'none' : 'breakdown',
                            }))
                          }
                          title={
                            metricsLayout.expandedPanel === 'breakdown'
                              ? 'Restore Split View'
                              : 'Expand Breakdown Window'
                          }
                          aria-label="Toggle expand breakdown window"
                          className={`p-1 rounded-sm cursor-pointer shrink-0 ${
                            metricsLayout.expandedPanel === 'breakdown'
                              ? 'bg-[#2563EB]/25 text-[#93C5FD]'
                              : 'text-[#8E8E9B] hover:text-white bg-[#121216] border border-[#262630]'
                          }`}
                        >
                          {metricsLayout.expandedPanel === 'breakdown' ? (
                            <Minimize2 className="w-3 h-3" />
                          ) : (
                            <Maximize2 className="w-3 h-3" />
                          )}
                        </button>
                      </div>

                      {/* Shorts vs Long-Form View Share */}
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[#D4D4DC]">
                              YouTube Shorts ({ytFormatSplit.shortsCount})
                            </span>
                            <span className="font-mono-tabular text-[#93C5FD]">
                              {formatMetricCount(ytFormatSplit.shortsViews)} views ({ytFormatSplit.shortsSharePct}%)
                            </span>
                          </div>
                          <div className="h-2.5 rounded-sm bg-[#121216] overflow-hidden">
                            <div
                              className="h-full bg-[#3B82F6] rounded-sm"
                              style={{ width: `${Math.max(2, ytFormatSplit.shortsSharePct)}%` }}
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[#D4D4DC]">
                              Standard Videos ({ytFormatSplit.standardCount})
                            </span>
                            <span className="font-mono-tabular text-[#A7F3D0]">
                              {formatMetricCount(ytFormatSplit.stdViews)} views ({ytFormatSplit.stdSharePct}%)
                            </span>
                          </div>
                          <div className="h-2.5 rounded-sm bg-[#121216] overflow-hidden">
                            <div
                              className="h-full bg-[#10B981] rounded-sm"
                              style={{ width: `${Math.max(2, ytFormatSplit.stdSharePct)}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Engagement Breakdown in Current View */}
                      <div className="pt-4 border-t border-[#25252D] space-y-2.5">
                        <div className="text-xs font-semibold text-[#E4E4EC]">
                          Active Filter Summary ({filteredPoints.length} videos)
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="p-2.5 rounded bg-[#121216] border border-[#25252D]">
                            <div className="text-[10px] text-[#8E8E9B]">Sample Views</div>
                            <div className="text-sm font-mono-tabular font-semibold text-[#F4F4F7] mt-0.5">
                              {formatMetricCount(chartStats.totalViews)}
                            </div>
                          </div>
                          <div className="p-2.5 rounded bg-[#121216] border border-[#25252D]">
                            <div className="text-[10px] text-[#8E8E9B]">Likes + Comments</div>
                            <div className="text-sm font-mono-tabular font-semibold text-[#F4F4F7] mt-0.5">
                              {formatMetricCount(chartStats.totalLikes + chartStats.totalComments)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Detailed Video Performance Table */}
            {(metricsLayout.expandedPanel === 'none' || metricsLayout.expandedPanel === 'table') && (
              <div
                className={`rounded border border-[#2A2A34] bg-[#18181D] overflow-hidden ${
                  activeMetricsResize === 'table-h' ? 'select-none' : ''
                }`}
              >
                <div className="px-5 py-3 border-b border-[#25252D] flex items-center justify-between gap-3 flex-wrap">
                  <h2 className="text-xs font-semibold text-[#F4F4F7]">
                    Detailed Video Performance ({filteredPoints.length})
                  </h2>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] text-[#8E8E9B] hidden sm:inline">
                      Click external icon to view directly on YouTube
                    </span>
                    <div className="flex items-center gap-0.5 p-0.5 bg-[#121216] border border-[#262630] rounded">
                      <button
                        type="button"
                        onClick={() =>
                          setMetricsLayout((prev) => ({
                            ...prev,
                            tableHeightPx: Math.max(180, (prev.tableHeightPx ?? 360) - 60),
                          }))
                        }
                        title="Make Table Smaller"
                        aria-label="Make table smaller"
                        className="p-1 text-[#8E8E9B] hover:text-white rounded-sm cursor-pointer"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setMetricsLayout((prev) => ({
                            ...prev,
                            tableHeightPx:
                              prev.tableHeightPx === null
                                ? 440
                                : Math.min(720, prev.tableHeightPx + 60),
                          }))
                        }
                        title="Make Table Larger"
                        aria-label="Make table larger"
                        className="p-1 text-[#8E8E9B] hover:text-white rounded-sm cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setMetricsLayout((prev) => ({
                            ...prev,
                            expandedPanel: prev.expandedPanel === 'table' ? 'none' : 'table',
                          }))
                        }
                        title={
                          metricsLayout.expandedPanel === 'table'
                            ? 'Restore All Windows'
                            : 'Expand Table Window'
                        }
                        aria-label="Toggle expand table window"
                        className={`p-1 rounded-sm cursor-pointer ${
                          metricsLayout.expandedPanel === 'table'
                            ? 'bg-[#2563EB]/25 text-[#93C5FD]'
                            : 'text-[#8E8E9B] hover:text-white'
                        }`}
                      >
                        {metricsLayout.expandedPanel === 'table' ? (
                          <Minimize2 className="w-3 h-3" />
                        ) : (
                          <Maximize2 className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {filteredPoints.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#8E8E9B]">
                    No matching uploads found.
                  </div>
                ) : (
                  <>
                    <div
                      style={
                        metricsLayout.tableHeightPx !== null && metricsLayout.expandedPanel !== 'table'
                          ? { maxHeight: `${metricsLayout.tableHeightPx}px` }
                          : undefined
                      }
                      className={`divide-y divide-[#23232C] ${
                        metricsLayout.tableHeightPx !== null && metricsLayout.expandedPanel !== 'table'
                          ? 'overflow-y-auto'
                          : ''
                      }`}
                    >
                  {filteredPoints.map((pt) => (
                    <div
                      key={pt.id}
                      className="px-5 py-2.5 flex items-center justify-between gap-4 hover:bg-[#1E1E25] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {pt.thumbnailUrl ? (
                          <img
                            src={pt.thumbnailUrl}
                            alt={pt.title}
                            referrerPolicy="no-referrer"
                            className="w-14 h-8 rounded-sm object-cover shrink-0 border border-[#2A2A34]"
                          />
                        ) : (
                          <div className="w-14 h-8 rounded-sm bg-[#121216] border border-[#2A2A34] shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-[#F4F4F7] truncate">{pt.title}</div>
                          <div className="text-[11px] text-[#8E8E9B] flex items-center gap-1.5 mt-0.5">
                            {pt.dateLabel && <span>{pt.dateLabel}</span>}
                            {pt.durationSec !== undefined && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono-tabular">
                                  {formatDurationSeconds(pt.durationSec)}
                                </span>
                              </>
                            )}
                            {pt.privacyStatus && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="capitalize">{pt.privacyStatus}</span>
                              </>
                            )}
                            {pt.isShort && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>Short</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-5 shrink-0 text-right">
                        <div>
                          <div className="text-[10px] text-[#7D7D8A]">Views</div>
                          <div className="text-xs font-mono-tabular text-[#F4F4F7]">
                            {formatMetricCount(pt.views)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[#7D7D8A]">Likes</div>
                          <div className="text-xs font-mono-tabular text-[#E4E4EC]">
                            {formatMetricCount(pt.likes)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[#7D7D8A]">Comments</div>
                          <div className="text-xs font-mono-tabular text-[#E4E4EC]">
                            {formatMetricCount(pt.comments)}
                          </div>
                        </div>
                        <div className="hidden sm:block min-w-[54px]">
                          <div className="text-[10px] text-[#7D7D8A]">Eng.</div>
                          <div className="text-xs font-mono-tabular text-[#93C5FD]">
                            {pt.engagementPct.toFixed(1)}%
                          </div>
                        </div>
                        {pt.externalUrl && (
                          <a
                            href={pt.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded text-[#8E8E9B] hover:text-white hover:bg-[#272731]"
                            title="Open video"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                    </div>
                    <div
                      role="separator"
                      aria-orientation="horizontal"
                      aria-label="Resize video table height"
                      title="Drag to resize Table height (double-click to reset to auto)"
                      onMouseDown={(e) => startMetricsResize('table-h', e)}
                      onDoubleClick={() =>
                        setMetricsLayout((prev) => ({ ...prev, tableHeightPx: null }))
                      }
                      className="h-2.5 border-t border-[#23232C] cursor-row-resize flex items-center justify-center group hover:bg-[#1E1E26]"
                    >
                      <div
                        className={`h-[2px] w-14 rounded-full transition-colors ${
                          activeMetricsResize === 'table-h'
                            ? 'bg-[#60A5FA]'
                            : 'bg-[#2B2B36] group-hover:bg-[#60A5FA]'
                        }`}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
