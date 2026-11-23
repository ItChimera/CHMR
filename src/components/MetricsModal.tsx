import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { parseJsonResponse, STATIC_BACKEND_NOTICE } from '../utils/runtime';
import {
  fetchTikTokMetrics,
  fetchTikTokPublishStatus,
  OAUTH_BROADCAST_CHANNEL,
  setStoredTikTokSealedSession,
  TIKTOK_SEALED_SESSION_KEY,
  TikTokMetricsResponse,
  TikTokPublishStatusResult,
} from '../utils/tiktokAuth';
import {
  fetchMyYouTubeChannel,
  fetchRecentYouTubeUploads,
  getYouTubeAccessToken,
  initYouTubeAuth,
  signInYouTube,
  YOUTUBE_TEST_USERS_URL,
  YouTubeChannelInfo,
  YouTubeRecentVideo,
} from '../utils/youtubeAuth';

export type MetricsPlatformTab = 'youtube' | 'youtube-shorts' | 'tiktok';

interface MetricsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPlatform?: MetricsPlatformTab;
  recentTikTokPublishId?: string | null;
  onAccountStatusChanged?: () => void;
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

export function MetricsModal({
  isOpen,
  onClose,
  initialPlatform = 'youtube',
  recentTikTokPublishId,
  onAccountStatusChanged,
}: MetricsModalProps) {
  const [activeTab, setActiveTab] = useState<MetricsPlatformTab>(initialPlatform);

  // YouTube state
  const [ytConnected, setYtConnected] = useState(false);
  const [ytHasToken, setYtHasToken] = useState(false);
  const [ytUser, setYtUser] = useState<{ name: string; email: string; avatarUrl?: string } | null>(null);
  const [ytChannel, setYtChannel] = useState<YouTubeChannelInfo | null>(null);
  const [ytVideos, setYtVideos] = useState<YouTubeRecentVideo[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytSigningIn, setYtSigningIn] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [showAllOnShorts, setShowAllOnShorts] = useState(false);

  // TikTok state
  const [ttMetrics, setTtMetrics] = useState<TikTokMetricsResponse | null>(null);
  const [ttLoading, setTtLoading] = useState(false);
  const [ttError, setTtError] = useState<string | null>(null);
  const [publishIdInput, setPublishIdInput] = useState(recentTikTokPublishId || '');
  const [publishStatusLoading, setPublishStatusLoading] = useState(false);
  const [publishStatusResult, setPublishStatusResult] = useState<TikTokPublishStatusResult | null>(null);
  const [publishStatusError, setPublishStatusError] = useState<string | null>(null);

  const popupPollRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialPlatform);
      if (recentTikTokPublishId) {
        setPublishIdInput(recentTikTokPublishId);
      } else {
        try {
          const saved = localStorage.getItem('chmr_last_tiktok_publish_id');
          if (saved) setPublishIdInput((prev) => prev || saved);
        } catch {
          // ignore storage errors
        }
      }
    }
  }, [isOpen, initialPlatform, recentTikTokPublishId]);

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
        const list = await fetchRecentYouTubeUploads(ch.uploadsPlaylistId, token, 12);
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
  }, []);

  const loadTikTokMetrics = useCallback(async () => {
    setTtLoading(true);
    setTtError(null);
    try {
      const data = await fetchTikTokMetrics();
      setTtMetrics(data);
      onAccountStatusChanged?.();
    } catch (err) {
      setTtError(err instanceof Error ? err.message : 'Unable to load TikTok metrics.');
    } finally {
      setTtLoading(false);
    }
  }, [onAccountStatusChanged]);

  useEffect(() => {
    if (!isOpen) return;

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

    loadTikTokMetrics();

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
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'tiktok') {
        if (typeof event.data?.sessionToken === 'string') {
          setStoredTikTokSealedSession(event.data.sessionToken);
        }
        loadTikTokMetrics();
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === TIKTOK_SEALED_SESSION_KEY) {
        loadTikTokMetrics();
      }
    };
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
        bc.onmessage = (event) => {
          if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'tiktok') {
            if (typeof event.data?.sessionToken === 'string') {
              setStoredTikTokSealedSession(event.data.sessionToken);
            }
            loadTikTokMetrics();
          }
        };
      } catch {
        bc = null;
      }
    }

    window.addEventListener('message', handleOAuthMessage);
    window.addEventListener('storage', handleStorage);

    return () => {
      unsub();
      window.removeEventListener('message', handleOAuthMessage);
      window.removeEventListener('storage', handleStorage);
      bc?.close();
      if (popupPollRef.current !== null) {
        window.clearInterval(popupPollRef.current);
        popupPollRef.current = null;
      }
    };
  }, [isOpen, loadYouTubeMetrics, loadTikTokMetrics]);

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

  const handleTikTokOAuth = async (includeStats: boolean) => {
    setTtError(null);
    try {
      const query = new URLSearchParams({
        origin: window.location.origin,
        ...(includeStats ? { includeStats: '1' } : {}),
      });
      const res = await fetch(`/api/auth/tiktok/url?${query.toString()}`, {
        credentials: 'include',
      });
      const data = await parseJsonResponse<{ url?: string; error?: string }>(res);
      if (!data) {
        setTtError(STATIC_BACKEND_NOTICE);
        return;
      }
      if (!res.ok || !data.url) {
        setTtError(data.error || 'Unable to start TikTok authorization.');
        return;
      }
      const popup = window.open(data.url, 'tiktok_oauth', 'width=600,height=720');
      if (!popup) {
        setTtError('Popup was blocked. Allow popups once to authorize TikTok.');
        return;
      }
      if (popupPollRef.current !== null) {
        window.clearInterval(popupPollRef.current);
      }
      popupPollRef.current = window.setInterval(() => {
        if (popup.closed) {
          if (popupPollRef.current !== null) {
            window.clearInterval(popupPollRef.current);
            popupPollRef.current = null;
          }
          loadTikTokMetrics();
        }
      }, 500);
    } catch (err) {
      setTtError(err instanceof Error ? err.message : 'Failed to connect TikTok.');
    }
  };

  const handleCheckPublishStatus = async () => {
    const trimmed = publishIdInput.trim();
    if (!trimmed) {
      setPublishStatusError('Enter a TikTok Publish ID returned after uploading.');
      return;
    }
    setPublishStatusLoading(true);
    setPublishStatusError(null);
    try {
      const res = await fetchTikTokPublishStatus(trimmed);
      if (!res) {
        setPublishStatusError('Unable to fetch publish status. Verify the Publish ID and TikTok connection.');
        setPublishStatusResult(null);
      } else {
        setPublishStatusResult(res);
      }
    } catch (err) {
      setPublishStatusError(err instanceof Error ? err.message : 'Status check failed.');
    } finally {
      setPublishStatusLoading(false);
    }
  };

  const shortsVideos = useMemo(() => ytVideos.filter((v) => v.isShort), [ytVideos]);
  const displayedYouTubeVideos = useMemo(() => {
    if (activeTab === 'youtube-shorts') {
      return showAllOnShorts ? ytVideos : shortsVideos;
    }
    return ytVideos;
  }, [activeTab, ytVideos, shortsVideos, showAllOnShorts]);

  const handleRefreshActive = () => {
    if (activeTab === 'tiktok') {
      loadTikTokMetrics();
    } else {
      loadYouTubeMetrics();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-[#18181D] border border-[#2E2E37] rounded-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#141418] border-b border-[#27272E] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <BarChart3 className="w-4 h-4 text-[#3B82F6] shrink-0" />
            <h2 className="text-sm font-semibold text-[#F4F4F7] truncate">
              Destination Channel &amp; Video Metrics
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRefreshActive}
              disabled={ytLoading || ttLoading}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#D4D4DC] bg-[#222229] hover:bg-[#2C2C35] rounded cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${ytLoading || ttLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-[#8E8E9B] hover:text-white hover:bg-[#25252D] cursor-pointer"
              aria-label="Close metrics"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Platform Segmented Tabs */}
        <div className="px-5 pt-3.5 pb-2 bg-[#16161B] border-b border-[#25252D] flex items-center justify-between gap-3 flex-wrap shrink-0">
          <div className="flex items-center gap-1 p-1 bg-[#111115] border border-[#262630] rounded-md">
            {(
              [
                { id: 'youtube', label: 'YouTube' },
                { id: 'youtube-shorts', label: 'YouTube Shorts' },
                { id: 'tiktok', label: 'TikTok' },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-[#2563EB] text-white'
                      : 'text-[#9A9AA6] hover:text-[#EAEAF0]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <span className="text-[11px] text-[#8E8E9B]">
            Live figures from YouTube Data API v3 &amp; TikTok API v2
          </span>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {(activeTab === 'youtube' || activeTab === 'youtube-shorts') && (
            <>
              {!ytConnected || !ytHasToken ? (
                <div className="p-5 rounded border border-[#2B2B36] bg-[#131318] flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-sm font-medium text-[#F4F4F7]">
                      {ytConnected && ytUser
                        ? `Authorize live metrics for ${ytUser.name}`
                        : 'Sign in with Google to inspect YouTube channel & video metrics'}
                    </div>
                    <p className="text-xs text-[#8E8E9B]">
                      {ytConnected
                        ? 'Google access tokens stay strictly in memory for security. Authorize once in this session to load subscribers, views, likes, and comments.'
                        : (
                          <>
                            Sign in with your Google project owner account, or{' '}
                            <a
                              href={YOUTUBE_TEST_USERS_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#60A5FA] hover:underline"
                            >
                              add another Gmail under Test users
                            </a>{' '}
                            in Google Cloud if Google shows Error 403: access_denied.
                          </>
                        )}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={ytSigningIn}
                    onClick={handleYouTubeAuthorize}
                    className="flex items-center gap-2 px-3.5 py-2 rounded bg-white hover:bg-[#F3F4F6] text-[#1F2937] text-xs font-semibold border border-[#D1D5DB] shadow-sm transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                    </svg>
                    <span>
                      {ytSigningIn
                        ? 'Authorizing...'
                        : ytConnected
                        ? 'Authorize & Load Metrics'
                        : 'Sign in with Google'}
                    </span>
                  </button>
                </div>
              ) : (
                <>
                  {/* Channel Header & KPIs */}
                  {ytChannel && (
                    <div className="rounded border border-[#2B2B36] bg-[#131318] overflow-hidden">
                      <div className="px-4 py-3 border-b border-[#25252D] flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0">
                          {ytChannel.avatarUrl && (
                            <img
                              src={ytChannel.avatarUrl}
                              alt={ytChannel.title}
                              referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded object-cover border border-[#2E2E37] shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[#F4F4F7] truncate">
                              {ytChannel.title}
                            </div>
                            <div className="text-xs text-[#8E8E9B] flex items-center gap-1.5">
                              {ytChannel.handle && <span className="font-mono-tabular">{ytChannel.handle}</span>}
                              {ytChannel.handle && <span aria-hidden="true">·</span>}
                              <span>{activeTab === 'youtube-shorts' ? 'YouTube Shorts Feed' : 'YouTube Channel'}</span>
                            </div>
                          </div>
                        </div>

                        <a
                          href={`https://studio.youtube.com/channel/${ytChannel.id}/analytics/tab-overview/period-default`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#D4D4DC] bg-[#202028] hover:bg-[#2A2A34] rounded whitespace-nowrap shrink-0"
                        >
                          <span>YouTube Studio</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>

                      <div className="grid grid-cols-3 divide-x divide-[#25252D]">
                        <div className="px-4 py-3">
                          <div className="text-[11px] text-[#8E8E9B]">Subscribers</div>
                          <div className="text-lg font-semibold font-mono-tabular text-[#F4F4F7] mt-0.5">
                            {formatMetricCount(ytChannel.subscriberCount)}
                          </div>
                        </div>
                        <div className="px-4 py-3">
                          <div className="text-[11px] text-[#8E8E9B]">Total Channel Views</div>
                          <div className="text-lg font-semibold font-mono-tabular text-[#F4F4F7] mt-0.5">
                            {formatMetricCount(ytChannel.viewCount)}
                          </div>
                        </div>
                        <div className="px-4 py-3">
                          <div className="text-[11px] text-[#8E8E9B]">Published Videos</div>
                          <div className="text-lg font-semibold font-mono-tabular text-[#F4F4F7] mt-0.5">
                            {formatMetricCount(ytChannel.videoCount)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Videos Table */}
                  <div className="rounded border border-[#2B2B36] bg-[#131318] overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-[#25252D] flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-[#E4E4EC]">
                        {activeTab === 'youtube-shorts' && !showAllOnShorts
                          ? `Recent Shorts (${shortsVideos.length})`
                          : `Recent Uploads (${displayedYouTubeVideos.length})`}
                      </div>
                      {activeTab === 'youtube-shorts' && ytVideos.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowAllOnShorts((v) => !v)}
                          className="text-[11px] text-[#60A5FA] hover:underline cursor-pointer"
                        >
                          {showAllOnShorts ? 'Show Shorts only' : `Show all ${ytVideos.length} uploads`}
                        </button>
                      )}
                    </div>

                    {ytLoading ? (
                      <div className="p-4 space-y-2.5">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="h-11 rounded bg-[#1B1B22] animate-pulse" />
                        ))}
                      </div>
                    ) : displayedYouTubeVideos.length === 0 ? (
                      <div className="p-5 text-center space-y-2">
                        <div className="text-xs text-[#A1A1AF]">
                          {activeTab === 'youtube-shorts' && ytVideos.length > 0
                            ? 'No uploads tagged #Shorts or under 60s were found in your latest 12 uploads.'
                            : 'No uploaded videos found on this channel yet.'}
                        </div>
                        {activeTab === 'youtube-shorts' && ytVideos.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowAllOnShorts(true)}
                            className="px-3 py-1.5 text-xs font-medium text-[#D4D4DC] bg-[#222229] hover:bg-[#2C2C35] rounded cursor-pointer"
                          >
                            View all {ytVideos.length} uploads
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="divide-y divide-[#22222A]">
                        {displayedYouTubeVideos.map((vid) => (
                          <div
                            key={vid.id}
                            className="px-4 py-2.5 flex items-center justify-between gap-4 hover:bg-[#191920] transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              {vid.thumbnailUrl ? (
                                <img
                                  src={vid.thumbnailUrl}
                                  alt={vid.title}
                                  referrerPolicy="no-referrer"
                                  className="w-14 h-8 rounded-sm object-cover shrink-0 border border-[#272731]"
                                />
                              ) : (
                                <div className="w-14 h-8 rounded-sm bg-[#1E1E26] border border-[#272731] shrink-0" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium text-[#F4F4F7] truncate">
                                  {vid.title}
                                </div>
                                <div className="text-[11px] text-[#8E8E9B] flex items-center gap-1.5 mt-0.5 truncate">
                                  {vid.publishedAt && <span>{formatDateShort(vid.publishedAt)}</span>}
                                  {vid.durationSeconds !== undefined && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono-tabular">
                                        {formatDurationSeconds(vid.durationSeconds)}
                                      </span>
                                    </>
                                  )}
                                  {vid.privacyStatus && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="capitalize">{vid.privacyStatus}</span>
                                    </>
                                  )}
                                  {vid.isShort && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>Short</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-4 shrink-0 text-right">
                              <div>
                                <div className="text-[10px] text-[#7D7D8A]">Views</div>
                                <div className="text-xs font-mono-tabular text-[#E4E4EC]">
                                  {formatMetricCount(vid.viewCount)}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] text-[#7D7D8A]">Likes</div>
                                <div className="text-xs font-mono-tabular text-[#E4E4EC]">
                                  {formatMetricCount(vid.likeCount)}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] text-[#7D7D8A]">Comments</div>
                                <div className="text-xs font-mono-tabular text-[#E4E4EC]">
                                  {formatMetricCount(vid.commentCount)}
                                </div>
                              </div>
                              <a
                                href={vid.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 rounded text-[#8E8E9B] hover:text-white hover:bg-[#25252E]"
                                title="Open on YouTube"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {ytError && (
                <div className="p-3 rounded bg-[#2B1418] border border-[#EF4444]/40 text-xs text-[#FCA5A5]">
                  {ytError}
                </div>
              )}
            </>
          )}

          {activeTab === 'tiktok' && (
            <>
              {ttLoading && !ttMetrics ? (
                <div className="p-5 space-y-2.5 rounded border border-[#2B2B36] bg-[#131318]">
                  <div className="h-10 rounded bg-[#1B1B22] animate-pulse" />
                  <div className="h-16 rounded bg-[#1B1B22] animate-pulse" />
                </div>
              ) : !ttMetrics?.connected ? (
                <div className="p-5 rounded border border-[#2B2B36] bg-[#131318] flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-sm font-medium text-[#F4F4F7]">
                      Connect TikTok to inspect account metrics &amp; upload status
                    </div>
                    <p className="text-xs text-[#8E8E9B]">
                      Sign in once to verify live publish status for CHMR uploads and sync creator stats.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTikTokOAuth(false)}
                    className="px-3.5 py-2 rounded bg-[#0F0F12] hover:bg-[#1E1E24] border border-[#3F3F4E] text-xs font-semibold text-white cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    Connect TikTok Account
                  </button>
                </div>
              ) : (
                <>
                  {/* Creator Summary & KPIs */}
                  <div className="rounded border border-[#2B2B36] bg-[#131318] overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#25252D] flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        {ttMetrics.profile?.avatarUrl && (
                          <img
                            src={ttMetrics.profile.avatarUrl}
                            alt={ttMetrics.profile.displayName}
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded object-cover border border-[#2E2E37] shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#F4F4F7] truncate">
                            {ttMetrics.profile?.displayName || 'TikTok Creator'}
                          </div>
                          <div className="text-xs text-[#8E8E9B]">
                            {ttMetrics.hasStatsScope
                              ? 'TikTok Creator Account · Display metrics connected'
                              : 'TikTok Connected · Basic upload & publish status active'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {!ttMetrics.hasStatsScope && (
                          <button
                            type="button"
                            onClick={() => handleTikTokOAuth(true)}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#3B82F6] rounded cursor-pointer whitespace-nowrap"
                          >
                            Sync Creator Stats
                          </button>
                        )}
                        <a
                          href="https://www.tiktok.com/tiktokstudio/analytics"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#D4D4DC] bg-[#202028] hover:bg-[#2A2A34] rounded whitespace-nowrap"
                        >
                          <span>TikTok Studio</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>

                    {ttMetrics.stats ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[#25252D]">
                        <div className="px-4 py-3">
                          <div className="text-[11px] text-[#8E8E9B]">Followers</div>
                          <div className="text-lg font-semibold font-mono-tabular text-[#F4F4F7] mt-0.5">
                            {formatMetricCount(ttMetrics.stats.followerCount)}
                          </div>
                        </div>
                        <div className="px-4 py-3">
                          <div className="text-[11px] text-[#8E8E9B]">Following</div>
                          <div className="text-lg font-semibold font-mono-tabular text-[#F4F4F7] mt-0.5">
                            {formatMetricCount(ttMetrics.stats.followingCount)}
                          </div>
                        </div>
                        <div className="px-4 py-3">
                          <div className="text-[11px] text-[#8E8E9B]">Total Likes</div>
                          <div className="text-lg font-semibold font-mono-tabular text-[#F4F4F7] mt-0.5">
                            {formatMetricCount(ttMetrics.stats.likesCount)}
                          </div>
                        </div>
                        <div className="px-4 py-3">
                          <div className="text-[11px] text-[#8E8E9B]">Videos</div>
                          <div className="text-lg font-semibold font-mono-tabular text-[#F4F4F7] mt-0.5">
                            {formatMetricCount(ttMetrics.stats.videoCount)}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="px-4 py-3 text-xs text-[#9A9AA6]">
                        {ttMetrics.note ||
                          'Click Sync Creator Stats to request Display API permissions (user.info.stats & video.list) from TikTok.'}
                      </div>
                    )}
                  </div>

                  {/* TikTok Videos List (if video.list granted) */}
                  {ttMetrics.videos.length > 0 && (
                    <div className="rounded border border-[#2B2B36] bg-[#131318] overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-[#25252D] text-xs font-semibold text-[#E4E4EC]">
                        Recent TikTok Videos ({ttMetrics.videos.length})
                      </div>
                      <div className="divide-y divide-[#22222A]">
                        {ttMetrics.videos.map((v) => (
                          <div
                            key={v.id}
                            className="px-4 py-2.5 flex items-center justify-between gap-4 hover:bg-[#191920] transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              {v.coverImageUrl ? (
                                <img
                                  src={v.coverImageUrl}
                                  alt={v.title}
                                  referrerPolicy="no-referrer"
                                  className="w-10 h-12 rounded-sm object-cover shrink-0 border border-[#272731]"
                                />
                              ) : (
                                <div className="w-10 h-12 rounded-sm bg-[#1E1E26] border border-[#272731] shrink-0" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium text-[#F4F4F7] truncate">
                                  {v.title}
                                </div>
                                <div className="text-[11px] text-[#8E8E9B] flex items-center gap-1.5 mt-0.5">
                                  {v.createTime && <span>{formatDateShort(v.createTime)}</span>}
                                  {v.duration !== undefined && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono-tabular">
                                        {formatDurationSeconds(v.duration)}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 shrink-0 text-right">
                              <div>
                                <div className="text-[10px] text-[#7D7D8A]">Views</div>
                                <div className="text-xs font-mono-tabular text-[#E4E4EC]">
                                  {formatMetricCount(v.viewCount)}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] text-[#7D7D8A]">Likes</div>
                                <div className="text-xs font-mono-tabular text-[#E4E4EC]">
                                  {formatMetricCount(v.likeCount)}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] text-[#7D7D8A]">Comments</div>
                                <div className="text-xs font-mono-tabular text-[#E4E4EC]">
                                  {formatMetricCount(v.commentCount)}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] text-[#7D7D8A]">Shares</div>
                                <div className="text-xs font-mono-tabular text-[#E4E4EC]">
                                  {formatMetricCount(v.shareCount)}
                                </div>
                              </div>
                              {v.shareUrl && (
                                <a
                                  href={v.shareUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1.5 rounded text-[#8E8E9B] hover:text-white hover:bg-[#25252E]"
                                  title="Open on TikTok"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Live Upload Publish Status Lookup */}
                  <div className="rounded border border-[#2B2B36] bg-[#131318] p-4 space-y-3">
                    <div>
                      <div className="text-xs font-semibold text-[#E4E4EC]">
                        Check Direct Upload Publish Status
                      </div>
                      <p className="text-[11px] text-[#8E8E9B] mt-0.5">
                        Verify live TikTok processing, inbox delivery, or public post ID for any upload sent from CHMR.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={publishIdInput}
                        onChange={(e) => setPublishIdInput(e.target.value)}
                        placeholder="Paste TikTok publish_id..."
                        className="flex-1 bg-[#101014] border border-[#2B2B34] focus:border-[#3B82F6] rounded px-3 py-1.5 text-xs font-mono-tabular text-white outline-none"
                      />
                      <button
                        type="button"
                        disabled={publishStatusLoading}
                        onClick={handleCheckPublishStatus}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#222229] hover:bg-[#2C2C35] text-xs font-medium text-[#E4E4EC] cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <Search className="w-3.5 h-3.5" />
                        <span>{publishStatusLoading ? 'Checking...' : 'Check Status'}</span>
                      </button>
                    </div>

                    {publishStatusResult && (
                      <div className="px-3 py-2.5 rounded bg-[#101014] border border-[#272732] flex items-center justify-between gap-3 flex-wrap text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
                          <span className="font-mono-tabular text-[#F4F4F7]">
                            {publishStatusResult.status}
                          </span>
                          {publishStatusResult.uploadedBytes !== undefined && (
                            <span className="text-[#8E8E9B] font-mono-tabular">
                              · {publishStatusResult.uploadedBytes.toLocaleString()} bytes uploaded
                            </span>
                          )}
                          {publishStatusResult.failReason && (
                            <span className="text-[#FCA5A5]">· {publishStatusResult.failReason}</span>
                          )}
                        </div>
                        {publishStatusResult.publicPostIds && publishStatusResult.publicPostIds.length > 0 && (
                          <span className="text-[11px] font-mono-tabular text-[#93C5FD]">
                            Post IDs: {publishStatusResult.publicPostIds.join(', ')}
                          </span>
                        )}
                      </div>
                    )}

                    {publishStatusError && (
                      <div className="text-xs text-[#FCA5A5]">{publishStatusError}</div>
                    )}
                  </div>
                </>
              )}

              {ttError && (
                <div className="p-3 rounded bg-[#2B1418] border border-[#EF4444]/40 text-xs text-[#FCA5A5]">
                  {ttError}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
