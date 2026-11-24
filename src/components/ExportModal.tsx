import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Hash,
  ListPlus,
  LogOut,
  Play,
  Send,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  CaptionSegment,
  ExportDestination,
  ExportSettings,
  MediaAsset,
  RenderQueueJob,
  SequenceSettings,
  TimelineClip,
  Track,
} from '../types/editor';
import { exportTimelineVideo } from '../utils/exporter';
import { assetUrl } from '../utils/runtime';
import { formatTimecode, generateId } from '../utils/timecode';
import { buildFpsSelectOptions, formatFpsLabel } from '../utils/videoMetadata';
import {
  YOUTUBE_TEST_USERS_URL,
  YouTubeChannelInfo,
  YouTubeRecentVideo,
  ensureYouTubeAccessToken,
  fetchMyYouTubeChannel,
  fetchRecentYouTubeUploads,
  formatSocialCaption,
  getYouTubeAccessToken,
  initYouTubeAuth,
  signInYouTube,
  signOutYouTube,
  uploadVideoToYouTube,
} from '../utils/youtubeAuth';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (path: string) => void;
  onAccountStatusChanged?: () => void;
  onOpenMetrics?: (platform: 'youtube' | 'youtube-shorts') => void;
  sequence: SequenceSettings;
  sourceVideoFps?: number | null;
  tracks: Track[];
  clips: TimelineClip[];
  captions: CaptionSegment[];
  assetsMap: Map<string, MediaAsset>;
  inPoint: number | null;
  outPoint: number | null;
  totalDuration: number;
}

const DESTINATION_CARDS: Array<{
  id: ExportDestination;
  label: string;
  spec: string;
  width: number;
  height: number;
  bitrate: number;
}> = [
  { id: 'download', label: 'Local File', spec: 'MP4 / WebM / WAV / EDL', width: 1920, height: 1080, bitrate: 8 },
  { id: 'youtube', label: 'YouTube', spec: '1080p / 1440p / 4K · Direct', width: 1920, height: 1080, bitrate: 12 },
  { id: 'youtube-shorts', label: 'YouTube Shorts', spec: '1080×1920 · 9:16 · #Shorts', width: 1080, height: 1920, bitrate: 10 },
];

const QUICK_HASHTAGS: Record<ExportDestination, string[]> = {
  download: ['#videoediting', '#filmmaking', '#chmr'],
  youtube: ['#youtube', '#filmmaking', '#cinematography', '#vlog'],
  'youtube-shorts': ['#Shorts', '#youtubeshorts', '#trending', '#viral'],
};

const FORMAT_OPTIONS: Array<{ value: ExportSettings['format']; label: string; ext: string }> = [
  { value: 'mp4-h264', label: 'MP4 Video (H.264 + AAC)', ext: 'mp4' },
  { value: 'webm-vp9', label: 'WebM Video (VP9 + Opus)', ext: 'webm' },
  { value: 'webm-vp8', label: 'WebM Video (VP8 + Opus)', ext: 'webm' },
  { value: 'wav-audio', label: 'Audio-Only Mixdown (WAV 44.1kHz)', ext: 'wav' },
  { value: 'png-frame', label: 'Current Frame Still (PNG)', ext: 'png' },
  { value: 'srt-captions', label: 'Subtitles / Captions (SRT)', ext: 'srt' },
  { value: 'edl-cmx3600', label: 'Edit Decision List (CMX 3600 EDL)', ext: 'edl' },
  { value: 'xml-fcpxml', label: 'Premiere / FCP Interchange (XML)', ext: 'xml' },
];

export function ExportModal({
  isOpen,
  onClose,
  onNavigate,
  onAccountStatusChanged,
  onOpenMetrics,
  sequence,
  sourceVideoFps,
  tracks,
  clips,
  captions,
  assetsMap,
  inPoint,
  outPoint,
  totalDuration,
}: ExportModalProps) {
  const [settings, setSettings] = useState<ExportSettings>({
    filename: `${sequence.name.replace(/\s+/g, '_')}_Master`,
    width: sequence.width === 3840 ? 1920 : sequence.width,
    height: sequence.height === 2160 ? 1080 : sequence.height,
    fps: sequence.fps,
    bitrateMbps: sequence.width === 2560 ? 16 : 8,
    bitrateMode: 'vbr',
    range: 'entire',
    format: 'mp4-h264',
    destination: 'download',
    publishTitle: sequence.name || 'My Edited Video',
    publishDescription: '',
    hashtags: '',
    privacyStatus: 'private',
  });

  const [confirmDirectPublish, setConfirmDirectPublish] = useState(false);

  const [ytUser, setYtUser] = useState<{ name: string; email: string; avatarUrl?: string } | null>(null);
  const [ytChannel, setYtChannel] = useState<YouTubeChannelInfo | null>(null);
  const [ytRecentVideos, setYtRecentVideos] = useState<YouTubeRecentVideo[]>([]);
  const [ytHasUploadToken, setYtHasUploadToken] = useState(false);
  const [ytConnected, setYtConnected] = useState(false);
  const [ytSigningIn, setYtSigningIn] = useState(false);

  const [queue, setQueue] = useState<RenderQueueJob[]>([]);
  const [status, setStatus] = useState<'idle' | 'rendering' | 'uploading' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [renderTime, setRenderTime] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [publishedResult, setPublishedResult] = useState<{ platform: string; url?: string; id?: string } | null>(null);
  const [copiedCaption, setCopiedCaption] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setSettings((s) => ({
      ...s,
      fps: sequence.fps,
      ...(s.destination === 'download' || !s.destination
        ? {
            width: sequence.width === 3840 ? 1920 : sequence.width,
            height: sequence.height === 2160 ? 1080 : sequence.height,
          }
        : {}),
      bitrateMbps:
        sequence.fps >= 90 && s.bitrateMbps < 24
          ? 24
          : sequence.width === 2560 && s.bitrateMbps < 16
          ? 16
          : s.bitrateMbps,
    }));

    const loadYouTubeChannelDetails = async (token: string | null) => {
      if (!token) {
        setYtHasUploadToken(false);
        return;
      }
      setYtHasUploadToken(true);
      try {
        const ch = await fetchMyYouTubeChannel(token);
        setYtChannel(ch);
        if (ch?.uploadsPlaylistId) {
          const videos = await fetchRecentYouTubeUploads(ch.uploadsPlaylistId, token);
          setYtRecentVideos(videos);
        }
      } catch {
        // Channel lookup is optional when account has not created a YouTube channel yet
      }
    };

    const unsub = initYouTubeAuth(
      (user, token) => {
        setYtConnected(true);
        setYtUser({
          name: user.displayName || 'YouTube Creator',
          email: user.email || '',
          avatarUrl: user.photoURL || undefined,
        });
        loadYouTubeChannelDetails(token);
      },
      () => {
        setYtConnected(false);
        setYtUser(null);
        setYtChannel(null);
        setYtRecentVideos([]);
        setYtHasUploadToken(false);
      }
    );

    return () => {
      unsub();
    };
  }, [isOpen, sequence.fps, sequence.width, sequence.height]);

  const destination = settings.destination || 'download';
  const isSocialDestination = destination !== 'download';
  const isShorts = destination === 'youtube-shorts';

  const formattedCaptionPreview = useMemo(() => {
    return formatSocialCaption(
      settings.publishDescription || '',
      settings.hashtags || '',
      isShorts
    );
  }, [settings.publishDescription, settings.hashtags, isShorts]);

  if (!isOpen) return null;

  const currentExt = FORMAT_OPTIONS.find((f) => f.value === settings.format)?.ext || 'mp4';
  const hasValidInOut = inPoint !== null && outPoint !== null && outPoint > inPoint;
  const effectiveDuration =
    settings.range === 'in-out' && hasValidInOut ? outPoint! - inPoint! : totalDuration;

  const handleSelectDestination = (dest: ExportDestination) => {
    const preset = DESTINATION_CARDS.find((d) => d.id === dest)!;
    setConfirmDirectPublish(false);
    setPublishedResult(null);
    setErrorMessage(null);
    setSettings((s) => {
      let nextHashtags = s.hashtags || '';
      if (dest === 'youtube-shorts' && !/#shorts\b/i.test(nextHashtags)) {
        nextHashtags = nextHashtags ? `#Shorts ${nextHashtags}` : '#Shorts';
      }
      const isVideoFormat = s.format === 'mp4-h264' || s.format === 'webm-vp9' || s.format === 'webm-vp8';
      return {
        ...s,
        destination: dest,
        width: dest === 'download' ? s.width : preset.width,
        height: dest === 'download' ? s.height : preset.height,
        fps: s.fps || sequence.fps,
        bitrateMbps: dest === 'download' ? s.bitrateMbps : Math.max(preset.bitrate, s.bitrateMbps),
        format: dest === 'download' ? s.format : isVideoFormat ? s.format : 'mp4-h264',
        hashtags: nextHashtags,
      };
    });
  };

  const handleAppendHashtag = (tag: string) => {
    setSettings((s) => {
      const current = (s.hashtags || '').trim();
      const exists = current.toLowerCase().split(/[\s,]+/).includes(tag.toLowerCase());
      if (exists) return s;
      return { ...s, hashtags: current ? `${current} ${tag}` : tag };
    });
  };

  const handleCopyMetadata = async () => {
    const lines = [
      (settings.publishTitle || '').trim(),
      formattedCaptionPreview.fullText,
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(lines);
      setCopiedCaption(true);
      setTimeout(() => setCopiedCaption(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleGoogleSignIn = async () => {
    setYtSigningIn(true);
    setErrorMessage(null);
    try {
      const { user, accessToken } = await signInYouTube();
      setYtConnected(true);
      setYtHasUploadToken(true);
      setYtUser({
        name: user.displayName || 'YouTube Creator',
        email: user.email || '',
        avatarUrl: user.photoURL || undefined,
      });
      try {
        const ch = await fetchMyYouTubeChannel(accessToken);
        setYtChannel(ch);
        if (ch?.uploadsPlaylistId) {
          const videos = await fetchRecentYouTubeUploads(ch.uploadsPlaylistId, accessToken);
          setYtRecentVideos(videos);
        }
      } catch {
        // channel lookup optional
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setYtSigningIn(false);
    }
  };

  const runSingleExport = async (cfg: ExportSettings, jobId?: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const dest = cfg.destination || 'download';

    if (!jobId) {
      if (dest === 'youtube' || dest === 'youtube-shorts') {
        if (!ytConnected) {
          setErrorMessage('Sign in with Google above to publish directly to YouTube.');
          setStatus('error');
          return;
        }
        if (!confirmDirectPublish) {
          setErrorMessage('Please confirm the direct upload checkbox before publishing to YouTube.');
          setStatus('error');
          return;
        }
        if (!getYouTubeAccessToken()) {
          try {
            const { accessToken } = await ensureYouTubeAccessToken();
            setYtHasUploadToken(Boolean(accessToken));
          } catch (err) {
            setErrorMessage(
              err instanceof Error ? err.message : 'Please authorize YouTube access with Google sign-in.'
            );
            setStatus('error');
            return;
          }
        }
      }
    }

    if (jobId) {
      setQueue((q) => q.map((j) => (j.id === jobId ? { ...j, status: 'rendering', progress: 0 } : j)));
    } else {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
        setDownloadUrl(null);
      }
      setPublishedResult(null);
      setStatus('rendering');
      setProgress(0);
      setUploadProgress(0);
      setErrorMessage(null);
    }

    try {
      const blob = await exportTimelineVideo(
        cfg,
        sequence,
        tracks,
        clips,
        assetsMap,
        captions,
        inPoint,
        outPoint,
        (pct, t) => {
          if (jobId) {
            setQueue((q) => q.map((j) => (j.id === jobId ? { ...j, progress: pct } : j)));
          } else {
            setProgress(pct);
            setRenderTime(t);
          }
        },
        controller.signal
      );

      const url = URL.createObjectURL(blob);

      if (!jobId && (dest === 'youtube' || dest === 'youtube-shorts')) {
        setStatus('uploading');
        const uploaded = await uploadVideoToYouTube({
          blob,
          title: cfg.publishTitle || cfg.filename || sequence.name,
          description: cfg.publishDescription || '',
          hashtags: cfg.hashtags || '',
          privacyStatus: cfg.privacyStatus || 'private',
          isShorts: dest === 'youtube-shorts',
          onProgress: (pct) => setUploadProgress(pct),
        });
        setPublishedResult({
          platform: dest === 'youtube-shorts' ? 'YouTube Shorts' : 'YouTube',
          url: uploaded.url,
          id: uploaded.videoId,
        });
      }

      if (jobId) {
        setQueue((q) =>
          q.map((j) => (j.id === jobId ? { ...j, status: 'done', progress: 100, downloadUrl: url } : j))
        );
      } else {
        setDownloadUrl(url);
        setStatus('done');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      if (jobId) {
        setQueue((q) => q.map((j) => (j.id === jobId ? { ...j, status: 'error', error: msg } : j)));
      } else if (controller.signal.aborted) {
        setStatus('idle');
      } else {
        setErrorMessage(msg);
        setStatus('error');
      }
    }
  };

  const handleRunQueue = async () => {
    for (const job of queue) {
      if (job.status === 'queued') {
        await runSingleExport(job.settings, job.id);
      }
    }
  };

  const handleClose = () => {
    if (status === 'rendering') abortRef.current?.abort();
    onClose();
  };

  const actionButtonLabel =
    status === 'rendering'
      ? 'Rendering...'
      : status === 'uploading'
      ? 'Uploading...'
      : destination === 'youtube'
      ? 'Render & Publish to YouTube'
      : destination === 'youtube-shorts'
      ? 'Render & Publish Short'
      : 'Export Now';

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#18181D] border border-[#2E2E37] rounded-lg shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-5 py-3.5 bg-[#141418] border-b border-[#27272E] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <img src={assetUrl('chmr-logo.png')} alt="CHMR" className="w-5 h-5 rounded object-cover" />
            <h2 className="text-sm font-semibold text-[#F4F4F7]">CHMR · Export &amp; Publish Video</h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded text-[#8E8E9B] hover:text-white hover:bg-[#25252D] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Destination Cards */}
          <div>
            <label className="block text-xs text-[#A1A1AF] mb-1.5">Export Destination</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {DESTINATION_CARDS.map((card) => {
                const active = destination === card.id;
                return (
                  <button
                    key={card.id}
                    type="button"
                    disabled={status === 'rendering' || status === 'uploading'}
                    onClick={() => handleSelectDestination(card.id)}
                    className={`p-2.5 rounded border text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#2563EB]/15 border-[#3B82F6] text-white'
                        : 'bg-[#121216] border-[#2B2B34] hover:border-[#3E3E4A] text-[#D4D4DC]'
                    }`}
                  >
                    <div className="text-xs font-semibold truncate">{card.label}</div>
                    <div className="text-[10px] font-mono-tabular text-[#8E8E9B] mt-0.5 truncate">
                      {card.spec}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Account Authentication for Social Destinations */}
          {(destination === 'youtube' || destination === 'youtube-shorts') && (
            <div className="p-3 rounded border border-[#2B2B36] bg-[#131318] space-y-2.5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                {ytConnected && ytUser ? (
                  <>
                    <div className="flex items-center gap-2.5 min-w-0">
                      {(ytChannel?.avatarUrl || ytUser.avatarUrl) ? (
                        <img
                          src={ytChannel?.avatarUrl || ytUser.avatarUrl}
                          alt={ytChannel?.title || ytUser.name}
                          className="w-8 h-8 rounded object-cover border border-[#2E2E37] shrink-0"
                        />
                      ) : (
                        <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] shrink-0" />
                          <span className="text-xs font-medium text-[#E4E4EC] truncate">
                            {ytChannel ? `${ytChannel.title}` : ytUser.name}
                          </span>
                          {ytChannel?.handle && (
                            <span className="text-[10px] font-mono-tabular text-[#8E8E9B] truncate">
                              {ytChannel.handle}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono-tabular text-[#8E8E9B] truncate mt-0.5">
                          {ytChannel ? (
                            <>
                              {ytChannel.subscriberCount
                                ? `${Number(ytChannel.subscriberCount).toLocaleString()} subscribers · `
                                : ''}
                              {ytChannel.viewCount
                                ? `${Number(ytChannel.viewCount).toLocaleString()} views · `
                                : ''}
                              {ytChannel.videoCount
                                ? `${Number(ytChannel.videoCount).toLocaleString()} videos`
                                : 'Ready for upload'}
                            </>
                          ) : (
                            <>
                              {ytUser.email ? `${ytUser.email} · ` : ''}
                              {ytHasUploadToken
                                ? 'Ready for direct YouTube upload'
                                : 'Saved account · Click Authorize or Publish to refresh upload token'}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!ytHasUploadToken && (
                        <button
                          type="button"
                          disabled={ytSigningIn}
                          onClick={async () => {
                            await handleGoogleSignIn();
                            onAccountStatusChanged?.();
                          }}
                          className="px-2.5 py-1 text-[11px] font-semibold text-white bg-[#2563EB] hover:bg-[#3B82F6] rounded cursor-pointer disabled:opacity-60"
                        >
                          {ytSigningIn ? 'Authorizing...' : 'Authorize Upload'}
                        </button>
                      )}
                      {onOpenMetrics && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenMetrics(destination === 'youtube-shorts' ? 'youtube-shorts' : 'youtube');
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#D4D4DC] bg-[#222229] hover:bg-[#2C2C35] rounded cursor-pointer"
                        >
                          <BarChart3 className="w-3 h-3 text-[#60A5FA]" />
                          <span>Metrics</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          await signOutYouTube();
                          onAccountStatusChanged?.();
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-[#D4D4DC] bg-[#222229] hover:bg-[#2C2C35] rounded cursor-pointer"
                      >
                        <LogOut className="w-3 h-3" />
                        Sign Out
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-[#E4E4EC] font-medium">
                        Connect your YouTube channel to upload {destination === 'youtube-shorts' ? 'YouTube Shorts' : 'videos'} directly
                      </div>
                      <div className="text-[11px] text-[#8E8E9B] mt-0.5">
                        Sign in with your Google project owner account, or{' '}
                        <a
                          href={YOUTUBE_TEST_USERS_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#60A5FA] hover:underline"
                        >
                          add another Gmail under Test users
                        </a>{' '}
                        in Google Cloud if Google shows Error 403.
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={ytSigningIn}
                      onClick={async () => {
                        await handleGoogleSignIn();
                        onAccountStatusChanged?.();
                      }}
                      className="flex items-center gap-2.5 px-3 py-1.5 rounded bg-white hover:bg-[#F3F4F6] text-[#1F2937] text-xs font-semibold border border-[#D1D5DB] shadow-sm transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                      </svg>
                      <span>{ytSigningIn ? 'Signing in...' : 'Sign in with Google'}</span>
                    </button>
                  </>
                )}
              </div>

              {ytConnected && ytRecentVideos.length > 0 && (() => {
                const shortsOnly = destination === 'youtube-shorts' ? ytRecentVideos.filter((v) => v.isShort) : [];
                const visibleVideos = destination === 'youtube-shorts' && shortsOnly.length > 0 ? shortsOnly : ytRecentVideos;
                return (
                  <div className="pt-2 border-t border-[#23232D]">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-medium text-[#8E8E9B]">
                        {destination === 'youtube-shorts' && shortsOnly.length > 0
                          ? 'Recent Shorts Performance'
                          : 'Recent Channel Uploads'}
                      </span>
                      {onOpenMetrics && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenMetrics(destination === 'youtube-shorts' ? 'youtube-shorts' : 'youtube');
                          }}
                          className="text-[11px] text-[#60A5FA] hover:underline cursor-pointer"
                        >
                          All metrics
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {visibleVideos.slice(0, 4).map((vid) => (
                        <a
                          key={vid.id}
                          href={vid.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 p-1.5 rounded bg-[#18181F] hover:bg-[#22222C] border border-[#262632] min-w-0 transition-colors"
                        >
                          {vid.thumbnailUrl && (
                            <img
                              src={vid.thumbnailUrl}
                              alt={vid.title}
                              referrerPolicy="no-referrer"
                              className="w-10 h-6 rounded-sm object-cover shrink-0"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] text-[#E4E4EC] truncate">{vid.title}</div>
                            <div className="text-[10px] font-mono-tabular text-[#8E8E9B] truncate">
                              {vid.viewCount !== undefined
                                ? `${Number(vid.viewCount).toLocaleString()} views · ${Number(vid.likeCount || 0).toLocaleString()} likes · ${Number(vid.commentCount || 0).toLocaleString()} comments`
                                : 'Open on YouTube'}
                            </div>
                          </div>
                          <ExternalLink className="w-3 h-3 text-[#7D7D8A] shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Post Title, Description, Hashtags & Visibility */}
          <div className="p-3.5 rounded border border-[#2B2B34] bg-[#131318] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#E4E4EC]">
                <Hash className="w-3.5 h-3.5 text-[#3B82F6]" />
                <span>Title, Description &amp; Hashtags</span>
              </div>
              <button
                type="button"
                onClick={handleCopyMetadata}
                className="flex items-center gap-1 px-2 py-1 text-[11px] bg-[#202028] hover:bg-[#2A2A34] text-[#D4D4DC] rounded cursor-pointer"
              >
                {copiedCaption ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
                <span>{copiedCaption ? 'Copied' : 'Copy Caption'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="sm:col-span-2">
                <label className="block text-[11px] text-[#9A9AA6] mb-1">Video Title</label>
                <input
                  type="text"
                  disabled={status === 'rendering' || status === 'uploading'}
                  value={settings.publishTitle || ''}
                  onChange={(e) => setSettings((s) => ({ ...s, publishTitle: e.target.value }))}
                  placeholder="Enter video title..."
                  className="w-full bg-[#101014] border border-[#2B2B34] focus:border-[#3B82F6] rounded px-2.5 py-1.5 text-xs text-white outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[#9A9AA6] mb-1">Visibility</label>
                <select
                  disabled={status === 'rendering' || status === 'uploading'}
                  value={settings.privacyStatus || 'private'}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      privacyStatus: e.target.value as 'public' | 'unlisted' | 'private',
                    }))
                  }
                  className="w-full bg-[#101014] border border-[#2B2B34] rounded px-2.5 py-1.5 text-xs text-[#E4E4EC] outline-none"
                >
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-[#9A9AA6] mb-1">Description</label>
              <textarea
                rows={2}
                disabled={status === 'rendering' || status === 'uploading'}
                value={settings.publishDescription || ''}
                onChange={(e) => setSettings((s) => ({ ...s, publishDescription: e.target.value }))}
                placeholder="Write a description for your YouTube video or Short..."
                className="w-full bg-[#101014] border border-[#2B2B34] focus:border-[#3B82F6] rounded px-2.5 py-1.5 text-xs text-white outline-none resize-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="text-[11px] text-[#9A9AA6]">Hashtags</label>
                {isShorts && (
                  <span className="text-[10px] text-[#60A5FA]">#Shorts auto-included for Shorts feed</span>
                )}
              </div>
              <input
                type="text"
                disabled={status === 'rendering' || status === 'uploading'}
                value={settings.hashtags || ''}
                onChange={(e) => setSettings((s) => ({ ...s, hashtags: e.target.value }))}
                placeholder="#filmmaking #shorts #youtube"
                className="w-full bg-[#101014] border border-[#2B2B34] focus:border-[#3B82F6] rounded px-2.5 py-1.5 text-xs text-white outline-none"
              />
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {QUICK_HASHTAGS[destination].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleAppendHashtag(tag)}
                    className="px-2 py-0.5 text-[10px] rounded bg-[#1B1B22] hover:bg-[#272732] border border-[#2B2B36] text-[#B8B8C4] cursor-pointer"
                  >
                    + {tag}
                  </button>
                ))}
              </div>
            </div>

            {isSocialDestination && (
              <label className="flex items-center gap-2 pt-1 text-[11px] text-[#D4D4DC] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={confirmDirectPublish}
                  onChange={(e) => setConfirmDirectPublish(e.target.checked)}
                  className="rounded border-[#383844] bg-[#101014] accent-[#3B82F6]"
                />
                <span>
                  Confirm direct upload to {destination === 'youtube-shorts' ? 'YouTube Shorts' : 'YouTube'} with this title, description, and visibility.
                </span>
              </label>
            )}
          </div>

          {/* Technical Output Settings */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#A1A1AF] mb-1.5">Output File Name</label>
              <div className="flex items-center bg-[#111114] border border-[#2B2B34] rounded px-3 py-1.5">
                <input
                  type="text"
                  disabled={status === 'rendering' || status === 'uploading'}
                  value={settings.filename}
                  onChange={(e) => setSettings((s) => ({ ...s, filename: e.target.value }))}
                  className="flex-1 bg-transparent text-xs text-white outline-none min-w-0"
                />
                <span className="text-xs font-mono-tabular text-[#7D7D8A]">.{currentExt}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#A1A1AF] mb-1.5">Format &amp; Interchange</label>
              <select
                disabled={status === 'rendering' || status === 'uploading'}
                value={settings.format}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, format: e.target.value as ExportSettings['format'] }))
                }
                className="w-full bg-[#111114] border border-[#2B2B34] rounded px-2.5 py-1.5 text-xs text-[#E4E4EC] outline-none disabled:opacity-60"
              >
                {FORMAT_OPTIONS.filter((f) =>
                  isSocialDestination
                    ? f.value === 'mp4-h264' || f.value === 'webm-vp9' || f.value === 'webm-vp8'
                    : true
                ).map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-[#A1A1AF] mb-1.5">Resolution</label>
              <select
                disabled={status === 'rendering' || status === 'uploading'}
                value={`${settings.width}x${settings.height}`}
                onChange={(e) => {
                  const [w, h] = e.target.value.split('x').map(Number);
                  setSettings((s) => ({
                    ...s,
                    width: w,
                    height: h,
                    bitrateMbps:
                      w >= 3840 && s.bitrateMbps < 24
                        ? 24
                        : w === 2560 && s.bitrateMbps < 16
                        ? 16
                        : s.bitrateMbps,
                  }));
                }}
                className="w-full bg-[#111114] border border-[#2B2B34] rounded px-2.5 py-1.5 text-xs text-[#E4E4EC] outline-none"
              >
                <option value="3840x2160">3840 × 2160 (4K UHD)</option>
                <option value="2560x1440">2560 × 1440 (1440p QHD)</option>
                <option value="1920x1080">1920 × 1080 (YouTube 1080p HD)</option>
                <option value="1280x720">1280 × 720 (720p HD)</option>
                <option value="1080x1920">1080 × 1920 (YouTube Shorts 9:16)</option>
                <option value="1080x1080">1080 × 1080 (Square 1:1)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-[#A1A1AF] mb-1.5">FPS</label>
                <select
                  disabled={status === 'rendering' || status === 'uploading'}
                  value={settings.fps}
                  onChange={(e) => setSettings((s) => ({ ...s, fps: Number(e.target.value) }))}
                  className="w-full bg-[#111114] border border-[#2B2B34] rounded px-2 py-1.5 text-xs text-[#E4E4EC] outline-none"
                >
                  {buildFpsSelectOptions(settings.fps, sourceVideoFps || sequence.fps).map((fpsOpt) => {
                    const matchedSource = sourceVideoFps && Math.abs(fpsOpt - sourceVideoFps) < 0.01;
                    const matchedSeq = Math.abs(fpsOpt - sequence.fps) < 0.01;
                    return (
                      <option key={fpsOpt} value={fpsOpt}>
                        {formatFpsLabel(fpsOpt)}
                        {matchedSource ? ' (Video)' : matchedSeq ? ' (Sequence)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#A1A1AF] mb-1.5">Bitrate ({settings.bitrateMode.toUpperCase()})</label>
                <select
                  disabled={status === 'rendering' || status === 'uploading'}
                  value={settings.bitrateMbps}
                  onChange={(e) => setSettings((s) => ({ ...s, bitrateMbps: Number(e.target.value) }))}
                  className="w-full bg-[#111114] border border-[#2B2B34] rounded px-2 py-1.5 text-xs text-[#E4E4EC] outline-none"
                >
                  <option value={4}>4 Mbps</option>
                  <option value={8}>8 Mbps</option>
                  <option value={12}>12 Mbps</option>
                  <option value={16}>16 Mbps</option>
                  <option value={24}>24 Mbps</option>
                  <option value={36}>36 Mbps</option>
                  <option value={50}>50 Mbps</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 px-3 py-2 bg-[#121216] border border-[#25252D] rounded text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[#8E8E9B]">Range:</span>
              <button
                type="button"
                onClick={() => setSettings((s) => ({ ...s, range: 'entire' }))}
                className={`px-2 py-0.5 rounded cursor-pointer ${
                  settings.range === 'entire' ? 'bg-[#2563EB] text-white' : 'text-[#A1A1AF]'
                }`}
              >
                Entire Sequence
              </button>
              <button
                type="button"
                disabled={!hasValidInOut}
                onClick={() => setSettings((s) => ({ ...s, range: 'in-out' }))}
                className={`px-2 py-0.5 rounded cursor-pointer disabled:opacity-40 ${
                  settings.range === 'in-out' ? 'bg-[#2563EB] text-white' : 'text-[#A1A1AF]'
                }`}
              >
                In/Out
              </button>
            </div>
            <span className="font-mono-tabular text-[#E4E4EC]">
              {formatTimecode(effectiveDuration, settings.fps)}
            </span>
          </div>

          {status === 'rendering' && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#D4D4DC]">Step 1: Encoding frames &amp; audio mix...</span>
                <span className="font-mono-tabular text-[#60A5FA]">{Math.round(progress)}%</span>
              </div>
              <div className="h-2 bg-[#111114] rounded overflow-hidden border border-[#27272E]">
                <div className="h-full bg-[#3B82F6] transition-all duration-150" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-[11px] font-mono-tabular text-[#7D7D8A]">
                Timecode {formatTimecode(renderTime, settings.fps)}
              </p>
            </div>
          )}

          {status === 'uploading' && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-[#D4D4DC]">
                  <UploadCloud className="w-3.5 h-3.5 text-[#60A5FA]" />
                  Step 2: Uploading to {destination === 'youtube-shorts' ? 'YouTube Shorts' : 'YouTube'}...
                </span>
                <span className="font-mono-tabular text-[#60A5FA]">{Math.round(uploadProgress)}%</span>
              </div>
              <div className="h-2 bg-[#111114] rounded overflow-hidden border border-[#27272E]">
                <div className="h-full bg-[#10B981] transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          {status === 'done' && downloadUrl && (
            <div className="p-3 rounded bg-[#0E2923] border border-[#10B981]/40 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-xs text-[#A7F3D0] min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
                  <span className="truncate">
                    {publishedResult
                      ? `Published to ${publishedResult.platform}${publishedResult.id ? ` (ID: ${publishedResult.id})` : ''}!`
                      : `Export complete (${settings.filename}.${currentExt}).`}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {publishedResult?.url && (
                    <a
                      href={publishedResult.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#1E293B] hover:bg-[#334155] text-xs font-medium text-white"
                    >
                      <ExternalLink className="w-3 h-3" />
                      View
                    </a>
                  )}
                  <a
                    href={downloadUrl}
                    download={`${settings.filename || 'chmr_export'}.${currentExt}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#10B981] hover:bg-[#059669] text-xs font-semibold text-[#052E16] whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Copy
                  </a>
                </div>
              </div>
            </div>
          )}

          {status === 'error' && errorMessage && (
            <div className="p-3 rounded bg-[#2B1418] border border-[#EF4444]/40 text-xs text-[#FCA5A5]">
              {errorMessage}
            </div>
          )}

          {/* Media Encoder Batch Queue */}
          {queue.length > 0 && (
            <div className="border-t border-[#27272E] pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#D4D4DC]">Render Queue ({queue.length})</span>
                <button
                  type="button"
                  onClick={handleRunQueue}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-[#2563EB] hover:bg-[#3B82F6] text-white rounded cursor-pointer"
                >
                  <Play className="w-3 h-3" />
                  Start Queue
                </button>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {queue.map((job) => {
                  const ext = FORMAT_OPTIONS.find((f) => f.value === job.settings.format)?.ext || 'webm';
                  return (
                    <div
                      key={job.id}
                      className="px-3 py-2 rounded bg-[#121216] border border-[#25252D] flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-[#E4E4EC] truncate">
                          {job.settings.filename}.{ext}
                        </div>
                        <div className="text-[10px] font-mono-tabular text-[#7D7D8A]">
                          {job.settings.width}×{job.settings.height} · {job.settings.fps}fps · {job.status} ({Math.round(job.progress)}%)
                        </div>
                      </div>
                      {job.status === 'done' && job.downloadUrl && (
                        <a
                          href={job.downloadUrl}
                          download={`${job.settings.filename}.${ext}`}
                          className="px-2 py-1 rounded bg-[#10B981] text-[#052E16] text-[11px] font-semibold shrink-0"
                        >
                          Save
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-[#141418] border-t border-[#27272E] flex items-center justify-between gap-2 shrink-0 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={status === 'rendering' || status === 'uploading'}
              onClick={() =>
                setQueue((q) => [
                  ...q,
                  { id: generateId('job'), settings: { ...settings }, status: 'queued', progress: 0 },
                ])
              }
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#D4D4DC] bg-[#222229] hover:bg-[#2C2C35] rounded cursor-pointer"
            >
              <ListPlus className="w-3.5 h-3.5 text-[#60A5FA]" />
              Queue
            </button>
            <div className="hidden sm:flex items-center gap-2 text-[11px] text-[#7D7D8A]">
              <a
                href="#/terms"
                onClick={(e) => {
                  if (onNavigate) {
                    e.preventDefault();
                    onClose();
                    onNavigate('/terms');
                  }
                }}
                className="hover:text-[#D4D4DC] hover:underline underline-offset-2"
              >
                Terms of Service
              </a>
              <span>·</span>
              <a
                href="#/privacy"
                onClick={(e) => {
                  if (onNavigate) {
                    e.preventDefault();
                    onClose();
                    onNavigate('/privacy');
                  }
                }}
                className="hover:text-[#D4D4DC] hover:underline underline-offset-2"
              >
                Privacy Policy
              </a>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-3.5 py-1.5 text-xs font-medium text-[#C2C2CC] bg-[#222229] hover:bg-[#2C2C35] rounded cursor-pointer"
            >
              {status === 'rendering' ? 'Cancel' : 'Close'}
            </button>
            <button
              type="button"
              disabled={status === 'rendering' || status === 'uploading' || clips.length === 0}
              onClick={() => runSingleExport(settings)}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#3B82F6] rounded disabled:opacity-45 cursor-pointer"
            >
              {isSocialDestination && <Send className="w-3.5 h-3.5" />}
              <span>{actionButtonLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
