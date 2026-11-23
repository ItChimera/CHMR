import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { AiActionPayload } from './components/AiAndReviewTabs';
import { ExportModal } from './components/ExportModal';
import { HomeScreen } from './components/HomeScreen';
import { InspectorPanel } from './components/InspectorPanel';
import { LegalPages } from './components/LegalPages';
import { MetricsDashboard, MetricsPlatformTab } from './components/MetricsDashboard';
import { MonitorPanel } from './components/MonitorPanel';
import { OfflineIndicator } from './components/PWAInstallButton';
import { ProjectBin } from './components/ProjectBin';
import { ShortcutsModal } from './components/ShortcutsModal';
import { TikTokCallbackView } from './components/TikTokCallbackView';
import { TimelinePanel } from './components/TimelinePanel';
import { AppViewMode, TopBar } from './components/TopBar';
import {
  COLOR_PRESETS,
  DEFAULT_AUDIO,
  DEFAULT_COLOR_GRADE,
  DEFAULT_TRANSFORM,
  DEFAULT_VFX,
  INITIAL_BINS,
  INITIAL_CAPTIONS,
  INITIAL_MARKERS,
  INITIAL_REVIEW_COMMENTS,
  INITIAL_TIMELINE_CLIPS,
  INITIAL_TRACKS,
  SAMPLE_MEDIA_ASSETS,
} from './data/presets';
import { useAudioEngine } from './hooks/useAudioEngine';
import {
  BinTab,
  CaptionSegment,
  ClipLabelColor,
  ClipMarker,
  EditorSnapshot,
  InspectorTab,
  MediaAsset,
  MediaBinFolder,
  MonitorInteractionMode,
  ProjectVersion,
  ReviewComment,
  SequenceSettings,
  TextConfig,
  TimelineClip,
  ToolMode,
  Track,
  TransitionType,
  WorkspaceMode,
} from './types/editor';
import { decodeWaveformFromUrl } from './utils/audioSynth';
import { computeAutoColorGrade } from './utils/sceneDetect';
import { clamp, generateId } from './utils/timecode';
import {
  fetchTikTokStatus,
  OAUTH_BROADCAST_CHANNEL,
  setStoredTikTokSealedSession,
  TIKTOK_SEALED_SESSION_KEY,
} from './utils/tiktokAuth';
import { detectVideoFps } from './utils/videoMetadata';
import { fetchMyYouTubeChannel, initYouTubeAuth } from './utils/youtubeAuth';
import { getAppBaseDir } from './utils/runtime';
import studioDirectorImg from './assets/images/footage_studio_director_1794865909899.jpg';

function readAppRoute(): string {
  if (typeof window === 'undefined') return '/';
  const hash = window.location.hash || '';
  if (hash.startsWith('#/')) {
    return hash.slice(1).split('?')[0] || '/';
  }
  const baseDir = getAppBaseDir();
  let pathname = window.location.pathname || '/';
  if (baseDir !== '/' && pathname.startsWith(baseDir)) {
    pathname = '/' + pathname.slice(baseDir.length);
  }
  return pathname || '/';
}

const INITIAL_SEQUENCE: SequenceSettings = {
  name: 'Untitled Sequence',
  width: 1920,
  height: 1080,
  fps: 30,
  aspectPreset: '16:9-hd',
  colorSpace: 'Rec.709',
  hdrMode: false,
  proxyMode: false,
};

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() => readAppRoute());

  useEffect(() => {
    const syncRoute = () => setCurrentPath(readAppRoute());
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  const navigateTo = useCallback((path: string) => {
    if (typeof window !== 'undefined') {
      const normalized = path.startsWith('/') ? path : `/${path}`;
      const baseDir = getAppBaseDir();
      const useHash = baseDir !== '/' || window.location.hostname.endsWith('.github.io');
      if (useHash) {
        if (normalized === '/') {
          window.history.pushState({}, '', baseDir);
        } else {
          window.location.hash = `#${normalized}`;
        }
      } else if (window.location.pathname !== normalized) {
        window.history.pushState({}, '', normalized);
      }
    }
    setCurrentPath(path);
  }, []);

  const [appView, setAppView] = useState<AppViewMode>('home');
  const [workspace, setWorkspace] = useState<WorkspaceMode>('Editing');
  const [binTab, setBinTab] = useState<BinTab>('project');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('motion');
  const [monitorMode, setMonitorMode] = useState<'program' | 'source'>('program');

  const [sequence, setSequence] = useState<SequenceSettings>(INITIAL_SEQUENCE);
  const [bins, setBins] = useState<MediaBinFolder[]>(INITIAL_BINS);
  const [activeBinId, setActiveBinId] = useState('bin_all');
  const [assets, setAssets] = useState<MediaAsset[]>(SAMPLE_MEDIA_ASSETS);
  const [tracks, setTracks] = useState<Track[]>(INITIAL_TRACKS);
  const [clips, setClips] = useState<TimelineClip[]>(INITIAL_TIMELINE_CLIPS);
  const [markers, setMarkers] = useState<ClipMarker[]>(INITIAL_MARKERS);
  const [captions, setCaptions] = useState<CaptionSegment[]>(INITIAL_CAPTIONS);
  const [showCaptionsOverlay, setShowCaptionsOverlay] = useState(false);
  const [monitorInteractionMode, setMonitorInteractionMode] = useState<MonitorInteractionMode>('none');
  const [checkerboardBg, setCheckerboardBg] = useState(false);

  const [comments, setComments] = useState<ReviewComment[]>(INITIAL_REVIEW_COMMENTS);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [clipboardClip, setClipboardClip] = useState<TimelineClip | null>(null);

  const [past, setPast] = useState<EditorSnapshot[]>([]);
  const [future, setFuture] = useState<EditorSnapshot[]>([]);
  const dragSnapshotRef = useRef<EditorSnapshot | null>(null);
  const manualFpsOverrideRef = useRef(false);
  const hasMatchedVideoFpsRef = useRef(false);

  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(52);
  const [masterVolume, setMasterVolume] = useState(100);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [metricsPlatform, setMetricsPlatform] = useState<MetricsPlatformTab>('youtube');
  const [lastTikTokPublishId, setLastTikTokPublishId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('chmr_last_tiktok_publish_id');
    } catch {
      return null;
    }
  });
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [savedTikTokUser, setSavedTikTokUser] = useState<{ displayName: string; avatarUrl?: string } | null>(null);
  const [savedYouTubeUser, setSavedYouTubeUser] = useState<{ name: string; avatarUrl?: string } | null>(null);

  const [studioLayout, setStudioLayout] = useState<{
    binWidth: number | null;
    inspectorWidth: number | null;
    timelineHeight: number;
  }>(() => {
    try {
      const raw = localStorage.getItem('chmr_studio_layout_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          binWidth: typeof parsed.binWidth === 'number' ? clamp(parsed.binWidth, 180, 560) : null,
          inspectorWidth: typeof parsed.inspectorWidth === 'number' ? clamp(parsed.inspectorWidth, 220, 560) : null,
          timelineHeight: typeof parsed.timelineHeight === 'number' ? clamp(parsed.timelineHeight, 170, 620) : 330,
        };
      }
    } catch {
      // ignore
    }
    return { binWidth: null, inspectorWidth: null, timelineHeight: 330 };
  });
  const [activeStudioResize, setActiveStudioResize] = useState<'bin' | 'inspector' | 'timeline' | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('chmr_studio_layout_v1', JSON.stringify(studioLayout));
    } catch {
      // ignore
    }
  }, [studioLayout]);

  const refreshSavedAccounts = useCallback(async () => {
    const data = await fetchTikTokStatus();
    if (data) {
      setSavedTikTokUser(data.connected && data.user ? data.user : null);
    }
  }, []);

  useEffect(() => {
    refreshSavedAccounts();
    const unsubYt = initYouTubeAuth(
      (user, token) => {
        setSavedYouTubeUser({
          name: user.displayName || 'YouTube Creator',
          avatarUrl: user.photoURL || undefined,
        });
        if (token) {
          fetchMyYouTubeChannel(token)
            .then((ch) => {
              if (ch) {
                setSavedYouTubeUser({
                  name: ch.title,
                  avatarUrl: ch.avatarUrl || user.photoURL || undefined,
                });
              }
            })
            .catch(() => {});
        }
      },
      () => setSavedYouTubeUser(null)
    );
    const onOAuthMsg = (event: MessageEvent) => {
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
        refreshSavedAccounts();
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === TIKTOK_SEALED_SESSION_KEY) {
        refreshSavedAccounts();
      }
    };
    const onWindowFocus = () => {
      refreshSavedAccounts();
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
            refreshSavedAccounts();
          }
        };
      } catch {
        bc = null;
      }
    }
    window.addEventListener('message', onOAuthMsg);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onWindowFocus);
    return () => {
      unsubYt();
      window.removeEventListener('message', onOAuthMsg);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onWindowFocus);
      bc?.close();
    };
  }, [refreshSavedAccounts]);

  const assetsMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  const totalDuration = useMemo(() => {
    const maxEnd = clips.reduce((acc, c) => Math.max(acc, c.start + c.duration), 0);
    return Math.max(10, maxEnd);
  }, [clips]);

  const selectedClip = useMemo(
    () => clips.find((c) => c.id === selectedClipId) || null,
    [clips, selectedClipId]
  );

  const sourceAsset = useMemo(
    () => assets.find((a) => a.id === selectedSourceId) || null,
    [assets, selectedSourceId]
  );

  const sourceVideoFps = useMemo(() => {
    if (selectedClip?.type === 'video') {
      const selAsset = assetsMap.get(selectedClip.assetId);
      if (selAsset?.fps) return selAsset.fps;
    }
    const timelineVideoClip = clips
      .filter((c) => c.type === 'video')
      .slice()
      .sort((a, b) => a.start - b.start)[0];
    if (timelineVideoClip) {
      const clipAsset = assetsMap.get(timelineVideoClip.assetId);
      if (clipAsset?.fps) return clipAsset.fps;
    }
    if (sourceAsset?.type === 'video' && sourceAsset.fps) {
      return sourceAsset.fps;
    }
    const firstVideoAsset = assets.find((a) => a.type === 'video' && a.fps);
    return firstVideoAsset?.fps ?? null;
  }, [selectedClip, clips, assetsMap, sourceAsset, assets]);

  const { getMeterLevels, ensureContext } = useAudioEngine(
    isPlaying,
    playhead,
    tracks,
    clips,
    assetsMap,
    masterVolume
  );

  const commitSnapshot = useCallback(
    (prevTracks: Track[], prevClips: TimelineClip[], prevMarkers = markers, prevCaptions = captions) => {
      setPast((p) => [
        ...p.slice(-39),
        { tracks: prevTracks, clips: prevClips, markers: prevMarkers, captions: prevCaptions },
      ]);
      setFuture([]);
    },
    [markers, captions]
  );

  const handleUndo = useCallback(() => {
    setPast((prevPast) => {
      if (prevPast.length === 0) return prevPast;
      const previous = prevPast[prevPast.length - 1];
      setFuture((f) => [{ tracks, clips, markers, captions }, ...f]);
      setTracks(previous.tracks);
      setClips(previous.clips);
      setMarkers(previous.markers);
      setCaptions(previous.captions);
      return prevPast.slice(0, -1);
    });
  }, [tracks, clips, markers, captions]);

  const handleRedo = useCallback(() => {
    setFuture((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture;
      const next = prevFuture[0];
      setPast((p) => [...p, { tracks, clips, markers, captions }]);
      setTracks(next.tracks);
      setClips(next.clips);
      setMarkers(next.markers);
      setCaptions(next.captions);
      return prevFuture.slice(1);
    });
  }, [tracks, clips, markers, captions]);

  useEffect(() => {
    if (!isPlaying) return;
    let lastTime = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      setPlayhead((prev) => {
        const next = prev + dt;
        const limitEnd = outPoint !== null && inPoint !== null && outPoint > inPoint ? outPoint : totalDuration;
        const limitStart = outPoint !== null && inPoint !== null && outPoint > inPoint ? inPoint : 0;

        if (next >= limitEnd) {
          if (loopEnabled) return limitStart;
          setIsPlaying(false);
          return limitEnd;
        }
        return next;
      });
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, totalDuration, loopEnabled, inPoint, outPoint]);

  const handleTogglePlay = useCallback(() => {
    ensureContext();
    setIsPlaying((playing) => {
      if (!playing && playhead >= totalDuration - 0.05) setPlayhead(0);
      return !playing;
    });
  }, [ensureContext, playhead, totalDuration]);

  const handleSeek = useCallback(
    (time: number) => {
      setPlayhead(clamp(time, 0, Math.max(totalDuration, 60)));
    },
    [totalDuration]
  );

  const handleStepFrame = useCallback(
    (deltaFrames: number) => {
      setIsPlaying(false);
      setPlayhead((prev) => Math.max(0, prev + deltaFrames / sequence.fps));
    },
    [sequence.fps]
  );

  const handleSelectWorkspace = (mode: WorkspaceMode) => {
    setWorkspace(mode);
    if (mode === 'Assembly') setBinTab('project');
    else if (mode === 'Color') {
      setBinTab('effects');
      setInspectorTab('color');
    } else if (mode === 'Audio') {
      setInspectorTab('audio');
    } else if (mode === 'Effects') {
      setBinTab('effects');
      setInspectorTab('motion');
    } else if (mode === 'Captions') {
      setInspectorTab('ai');
      setShowCaptionsOverlay(true);
    } else {
      setBinTab('project');
      setInspectorTab('motion');
    }
  };

  const handleChangeAspectPreset = useCallback((preset: SequenceSettings['aspectPreset']) => {
    const dims: Record<SequenceSettings['aspectPreset'], [number, number]> = {
      '16:9-hd': [1920, 1080],
      '16:9-4k': [3840, 2160],
      '9:16-vertical': [1080, 1920],
      '1:1-square': [1080, 1080],
      '4:5-social': [1080, 1350],
    };
    const [w, h] = dims[preset];
    setSequence((s) => ({ ...s, aspectPreset: preset, width: w, height: h }));
  }, []);

  const handleSelectClip = useCallback(
    (clipId: string | null) => {
      setSelectedClipId(clipId);
      if (!clipId) return;
      const target = clips.find((c) => c.id === clipId);
      if (!target) return;
      if (target.type === 'title') setInspectorTab('graphics');
      else if (target.type === 'audio' && inspectorTab === 'color') setInspectorTab('audio');
    },
    [clips, inspectorTab]
  );

  // Move clip (supports Slide Edit mode)
  const handleMoveClip = useCallback(
    (clipId: string, newStart: number, newTrackId: string, commitHistory: boolean, mode: ToolMode = 'select') => {
      if (!dragSnapshotRef.current) {
        dragSnapshotRef.current = { tracks, clips, markers, captions };
      }

      setClips((prev) => {
        const target = prev.find((c) => c.id === clipId);
        if (!target) return prev;
        const delta = newStart - target.start;

        if (mode === 'slide') {
          return prev.map((c) => {
            if (c.id === clipId) return { ...c, start: newStart };
            if (c.trackId !== target.trackId) return c;
            // Adjust adjacent clips on same track
            if (Math.abs(c.start + c.duration - target.start) < 0.08) {
              return { ...c, duration: Math.max(0.2, c.duration + delta) };
            }
            if (Math.abs(c.start - (target.start + target.duration)) < 0.08) {
              return { ...c, start: Math.max(0, c.start + delta), duration: Math.max(0.2, c.duration - delta) };
            }
            return c;
          });
        }

        return prev.map((c) => (c.id === clipId ? { ...c, start: newStart, trackId: newTrackId } : c));
      });

      if (commitHistory && dragSnapshotRef.current) {
        const snap = dragSnapshotRef.current;
        dragSnapshotRef.current = null;
        commitSnapshot(snap.tracks, snap.clips, snap.markers, snap.captions);
      }
    },
    [tracks, clips, markers, captions, commitSnapshot]
  );

  // Trim clip (supports Selection, Ripple Edit, Roll Edit!)
  const handleTrimClip = useCallback(
    (
      clipId: string,
      edge: 'left' | 'right',
      newStart: number,
      newDuration: number,
      newInPoint: number,
      commitHistory: boolean,
      mode: ToolMode = 'select'
    ) => {
      if (!dragSnapshotRef.current) {
        dragSnapshotRef.current = { tracks, clips, markers, captions };
      }

      setClips((prev) => {
        const target = prev.find((c) => c.id === clipId);
        if (!target) return prev;
        const oldEnd = target.start + target.duration;
        const newEnd = newStart + newDuration;
        const endDelta = newEnd - oldEnd;

        return prev.map((c) => {
          if (c.id === clipId) {
            return { ...c, start: newStart, duration: newDuration, inPoint: newInPoint };
          }
          if (c.trackId !== target.trackId) return c;

          // Ripple Edit shifts downstream clips on the same track
          if (mode === 'ripple' && edge === 'right' && c.start >= oldEnd - 0.05) {
            return { ...c, start: Math.max(0, c.start + endDelta) };
          }
          // Roll Edit adjusts adjacent clip sharing the cut point
          if (mode === 'roll') {
            if (edge === 'right' && Math.abs(c.start - oldEnd) < 0.08) {
              const adjDur = Math.max(0.15, c.duration - endDelta);
              return { ...c, start: newEnd, duration: adjDur, inPoint: Math.max(0, c.inPoint + endDelta * c.speed) };
            }
            if (edge === 'left' && Math.abs(c.start + c.duration - target.start) < 0.08) {
              return { ...c, duration: Math.max(0.15, newStart - c.start) };
            }
          }
          return c;
        });
      });

      if (commitHistory && dragSnapshotRef.current) {
        const snap = dragSnapshotRef.current;
        dragSnapshotRef.current = null;
        commitSnapshot(snap.tracks, snap.clips, snap.markers, snap.captions);
      }
    },
    [tracks, clips, markers, captions, commitSnapshot]
  );

  const handleSlipClip = useCallback(
    (clipId: string, newInPoint: number, commitHistory: boolean) => {
      if (!dragSnapshotRef.current) {
        dragSnapshotRef.current = { tracks, clips, markers, captions };
      }
      setClips((prev) => prev.map((c) => (c.id === clipId ? { ...c, inPoint: newInPoint } : c)));
      if (commitHistory && dragSnapshotRef.current) {
        const snap = dragSnapshotRef.current;
        dragSnapshotRef.current = null;
        commitSnapshot(snap.tracks, snap.clips, snap.markers, snap.captions);
      }
    },
    [tracks, clips, markers, captions, commitSnapshot]
  );

  const handleSplitClipAt = useCallback(
    (clipId: string, splitTime: number) => {
      const target = clips.find((c) => c.id === clipId);
      if (!target) return;
      if (splitTime <= target.start + 0.1 || splitTime >= target.start + target.duration - 0.1) return;
      const track = tracks.find((t) => t.id === target.trackId);
      if (track?.locked) return;

      commitSnapshot(tracks, clips);
      const leftDur = splitTime - target.start;
      const rightDur = target.duration - leftDur;

      const leftClip: TimelineClip = { ...target, duration: leftDur, transitionOut: { type: 'none', duration: 0 } };
      const rightClip: TimelineClip = {
        ...target,
        id: generateId('clip'),
        start: splitTime,
        duration: rightDur,
        inPoint: target.inPoint + leftDur * target.speed,
        transitionIn: { type: 'none', duration: 0 },
      };

      setClips((prev) => prev.flatMap((c) => (c.id === clipId ? [leftClip, rightClip] : [c])));
      setSelectedClipId(rightClip.id);
    },
    [clips, tracks, commitSnapshot]
  );

  const handleSplitClipMultiple = useCallback(
    (clipId: string, splitTimes: number[]) => {
      const target = clips.find((c) => c.id === clipId);
      if (!target || splitTimes.length === 0) return;
      commitSnapshot(tracks, clips);

      const sorted = [...splitTimes]
        .filter((t) => t > target.start + 0.15 && t < target.start + target.duration - 0.15)
        .sort((a, b) => a - b);
      if (sorted.length === 0) return;

      const boundaries = [target.start, ...sorted, target.start + target.duration];
      const segments: TimelineClip[] = [];
      for (let i = 0; i < boundaries.length - 1; i++) {
        const st = boundaries[i];
        const dur = boundaries[i + 1] - st;
        segments.push({
          ...target,
          id: i === 0 ? target.id : generateId('clip'),
          start: st,
          duration: dur,
          inPoint: target.inPoint + (st - target.start) * target.speed,
        });
      }
      setClips((prev) => prev.flatMap((c) => (c.id === clipId ? segments : [c])));
    },
    [clips, tracks, commitSnapshot]
  );

  const handleSplitAtPlayhead = useCallback(() => {
    const candidates = clips.filter((c) => {
      const tr = tracks.find((t) => t.id === c.trackId);
      if (tr?.locked) return false;
      return playhead > c.start + 0.1 && playhead < c.start + c.duration - 0.1;
    });
    if (candidates.length === 0) return;
    const preferred = candidates.find((c) => c.id === selectedClipId) || candidates[0];
    handleSplitClipAt(preferred.id, playhead);
  }, [clips, tracks, playhead, selectedClipId, handleSplitClipAt]);

  const handleDeleteSelectedClip = useCallback(
    (ripple = false) => {
      if (!selectedClipId) return;
      const target = clips.find((c) => c.id === selectedClipId);
      if (!target) return;
      const track = tracks.find((t) => t.id === target.trackId);
      if (track?.locked) return;

      commitSnapshot(tracks, clips);
      setClips((prev) => {
        const filtered = prev.filter((c) => c.id !== selectedClipId);
        if (!ripple) return filtered;
        return filtered.map((c) =>
          c.trackId === target.trackId && c.start >= target.start + target.duration - 0.05
            ? { ...c, start: Math.max(0, c.start - target.duration) }
            : c
        );
      });
      setSelectedClipId(null);
    },
    [selectedClipId, clips, tracks, commitSnapshot]
  );

  const handleDuplicateSelectedClip = useCallback(() => {
    if (!selectedClipId) return;
    const target = clips.find((c) => c.id === selectedClipId);
    if (!target) return;
    commitSnapshot(tracks, clips);
    const clone: TimelineClip = {
      ...target,
      id: generateId('clip'),
      start: target.start + target.duration,
      transform: { ...target.transform },
      color: { ...target.color },
      vfx: { ...target.vfx },
      audio: { ...target.audio },
      text: target.text ? { ...target.text } : undefined,
      transitionIn: { ...target.transitionIn },
      transitionOut: { ...target.transitionOut },
    };
    setClips((prev) => [...prev, clone]);
    setSelectedClipId(clone.id);
  }, [selectedClipId, clips, tracks, commitSnapshot]);

  const handleNestSelectedClip = useCallback(() => {
    if (!selectedClipId) return;
    const target = clips.find((c) => c.id === selectedClipId);
    if (!target || target.type === 'audio') return;
    commitSnapshot(tracks, clips);

    const nestedAssetId = generateId('nested_asset');
    const nestedAsset: MediaAsset = {
      id: nestedAssetId,
      name: `Nested (${target.name})`,
      type: 'nested',
      src: '',
      duration: target.duration,
      thumbnailUrl: assetsMap.get(target.assetId)?.thumbnailUrl,
      nestedClips: [{ ...target, start: 0, trackId: 'V1' }],
      binId: 'bin_a_cam',
      label: 'violet',
    };
    setAssets((prev) => [nestedAsset, ...prev]);
    setClips((prev) =>
      prev.map((c) =>
        c.id === target.id
          ? { ...c, assetId: nestedAssetId, name: nestedAsset.name, type: 'nested', inPoint: 0, label: 'violet' }
          : c
      )
    );
  }, [selectedClipId, clips, tracks, assetsMap, commitSnapshot]);

  const addAssetAsClip = useCallback(
    (asset: MediaAsset, trackId?: string, startAt?: number, inPt = 0, outPt?: number) => {
      commitSnapshot(tracks, clips);
      const targetedAudio = tracks.find((t) => t.type === 'audio' && t.targeted && !t.locked)?.id;
      const targetedVideo = tracks.find((t) => t.type === 'video' && t.targeted && !t.locked)?.id;

      const targetTrack =
        trackId ||
        (asset.type === 'audio'
          ? targetedAudio || tracks.find((t) => t.type === 'audio' && !t.locked)?.id || 'A1'
          : targetedVideo ||
            tracks.find((t) => t.id === 'V1' && !t.locked)?.id ||
            tracks.find((t) => t.type === 'video' && !t.locked)?.id ||
            'V1');

      let resolvedStart = startAt;
      if (resolvedStart === undefined) {
        const trackClips = clips.filter((c) => c.trackId === targetTrack);
        resolvedStart = trackClips.reduce((acc, c) => Math.max(acc, c.start + c.duration), 0);
      }

      const clipDuration = outPt !== undefined ? Math.max(0.2, outPt - inPt) : asset.duration;
      const newClip: TimelineClip = {
        id: generateId('clip'),
        assetId: asset.id,
        trackId: targetTrack,
        name: asset.name,
        type: asset.type,
        start: resolvedStart,
        duration: clipDuration,
        inPoint: inPt,
        speed: 1,
        reversed: false,
        disabled: false,
        label: asset.label,
        multicamAngles: asset.multicamGroup ? ['asset_studio_director', 'asset_neon_city', 'asset_alpine_ridge', 'asset_coastal_waves'] : undefined,
        activeAngleIndex: 0,
        transform: { ...DEFAULT_TRANSFORM, ...(asset.defaultTransform || {}) },
        color: { ...DEFAULT_COLOR_GRADE, ...(asset.defaultColorGrade || {}) },
        vfx: { ...DEFAULT_VFX },
        audio: { ...DEFAULT_AUDIO, essentialCategory: asset.type === 'audio' ? 'music' : 'dialogue' },
        transitionIn: { type: 'none', duration: 0 },
        transitionOut: { type: 'none', duration: 0 },
      };

      setClips((prev) => [...prev, newClip]);
      setSelectedClipId(newClip.id);
      setPlayhead(resolvedStart);
      setMonitorMode('program');

      if (
        asset.type === 'video' &&
        asset.fps &&
        !manualFpsOverrideRef.current &&
        clips.every((c) => c.type !== 'video')
      ) {
        hasMatchedVideoFpsRef.current = true;
        setSequence((s) => (s.fps === asset.fps ? s : { ...s, fps: asset.fps! }));
      }
    },
    [tracks, clips, commitSnapshot]
  );

  const handleInsertTitle = useCallback(
    (name: string, textConfig: TextConfig, trackId = 'V2', startTime = playhead) => {
      commitSnapshot(tracks, clips);
      const targetTrack =
        tracks.find((t) => t.id === trackId && !t.locked)?.id ||
        tracks.find((t) => t.type === 'video' && !t.locked)?.id ||
        'V2';

      const newClip: TimelineClip = {
        id: generateId('title'),
        assetId: 'title_custom',
        trackId: targetTrack,
        name,
        type: 'title',
        start: startTime,
        duration: 4.0,
        inPoint: 0,
        speed: 1,
        reversed: false,
        disabled: false,
        label: 'violet',
        transform: { ...DEFAULT_TRANSFORM },
        color: { ...DEFAULT_COLOR_GRADE },
        vfx: { ...DEFAULT_VFX },
        audio: { ...DEFAULT_AUDIO },
        text: textConfig,
        transitionIn: { type: 'cross-dissolve', duration: 0.4 },
        transitionOut: { type: 'cross-dissolve', duration: 0.4 },
      };

      setClips((prev) => [...prev, newClip]);
      setSelectedClipId(newClip.id);
      setInspectorTab('graphics');
      setMonitorMode('program');
    },
    [tracks, clips, playhead, commitSnapshot]
  );

  const handleImportFiles = useCallback(async (fileList: FileList) => {
    const newAssets: MediaAsset[] = [];

    for (const file of Array.from(fileList)) {
      const url = URL.createObjectURL(file);
      const mime = file.type;
      const isVideoFile =
        mime.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name);

      if (isVideoFile) {
        const metaPromise = new Promise<{ duration: number; width: number; height: number; thumb?: string }>((resolve) => {
          const v = document.createElement('video');
          v.preload = 'metadata';
          v.muted = true;
          v.src = url;
          v.onloadeddata = () => {
            v.currentTime = Math.min(0.5, (v.duration || 2) * 0.2);
          };
          v.onseeked = () => {
            let thumb: string | undefined;
            try {
              const c = document.createElement('canvas');
              c.width = 320;
              c.height = 180;
              const ctx = c.getContext('2d');
              if (ctx && v.videoWidth > 0) {
                ctx.drawImage(v, 0, 0, c.width, c.height);
                thumb = c.toDataURL('image/jpeg', 0.75);
              }
            } catch {
              // ignore
            }
            resolve({
              duration: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 6,
              width: v.videoWidth || 1920,
              height: v.videoHeight || 1080,
              thumb,
            });
          };
          v.onerror = () => resolve({ duration: 6, width: 1920, height: 1080 });
        });

        const [meta, detectedFps] = await Promise.all([metaPromise, detectVideoFps(file, url)]);

        newAssets.push({
          id: generateId('asset'),
          name: file.name,
          type: 'video',
          src: url,
          thumbnailUrl: meta.thumb,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          fps: detectedFps ?? 30,
          hasAudio: true,
          binId: 'bin_a_cam',
          label: 'blue',
        });
      } else if (mime.startsWith('audio/')) {
        const duration = await new Promise<number>((resolve) => {
          const a = new Audio(url);
          a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 10);
          a.onerror = () => resolve(10);
        });
        const waveform = await decodeWaveformFromUrl(url);
        newAssets.push({
          id: generateId('asset'),
          name: file.name,
          type: 'audio',
          src: url,
          duration,
          waveform,
          hasAudio: true,
          binId: 'bin_audio',
          label: 'teal',
        });
      } else if (mime.startsWith('image/')) {
        newAssets.push({
          id: generateId('asset'),
          name: file.name,
          type: 'image',
          src: url,
          thumbnailUrl: url,
          duration: 5,
          width: 1920,
          height: 1080,
          motionPreset: 'none',
          binId: 'bin_b_roll',
          label: 'amber',
        });
      }
    }

    if (newAssets.length > 0) {
      setAssets((prev) => [...newAssets, ...prev]);
      setSelectedSourceId(newAssets[0].id);

      const firstImportedVideo = newAssets.find((a) => a.type === 'video' && a.fps);
      if (
        firstImportedVideo?.fps &&
        !manualFpsOverrideRef.current &&
        (!hasMatchedVideoFpsRef.current || clips.every((c) => c.type !== 'video'))
      ) {
        hasMatchedVideoFpsRef.current = true;
        setSequence((s) => ({ ...s, fps: firstImportedVideo.fps! }));
      }
    }
  }, [clips]);

  const handleRecordedVoiceover = useCallback(
    async (blob: Blob, startAt: number) => {
      const url = URL.createObjectURL(blob);
      const duration = await new Promise<number>((resolve) => {
        const a = new Audio(url);
        a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 4);
        a.onerror = () => resolve(4);
      });
      const waveform = await decodeWaveformFromUrl(url);
      const voAsset: MediaAsset = {
        id: generateId('vo'),
        name: `VO_Mic_${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.webm`,
        type: 'audio',
        src: url,
        duration,
        waveform,
        hasAudio: true,
        binId: 'bin_audio',
        label: 'rose',
      };
      setAssets((prev) => [voAsset, ...prev]);
      addAssetAsClip(voAsset, 'A2', startAt);
    },
    [addAssetAsClip]
  );

  const handleAddGeneratedVoiceover = useCallback(
    async (name: string, base64Wav: string) => {
      const binStr = atob(base64Wav);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const duration = await new Promise<number>((resolve) => {
        const a = new Audio(url);
        a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 4);
        a.onerror = () => resolve(4);
      });
      const waveform = await decodeWaveformFromUrl(url);
      const voAsset: MediaAsset = {
        id: generateId('aivo'),
        name,
        type: 'audio',
        src: url,
        duration,
        waveform,
        hasAudio: true,
        binId: 'bin_audio',
        label: 'violet',
      };
      setAssets((prev) => [voAsset, ...prev]);
      addAssetAsClip(voAsset, 'A2', playhead);
    },
    [addAssetAsClip, playhead]
  );

  const handleUpdateClip = useCallback((clipId: string, updater: (clip: TimelineClip) => TimelineClip) => {
    setClips((prev) => prev.map((c) => (c.id === clipId ? updater(c) : c)));
  }, []);

  const handleApplyColorPreset = useCallback(
    (presetId: string) => {
      if (!selectedClipId) return;
      const preset = COLOR_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      commitSnapshot(tracks, clips);
      handleUpdateClip(selectedClipId, (c) => ({
        ...c,
        color: { ...c.color, presetId: preset.id, ...preset.grade },
      }));
    },
    [selectedClipId, tracks, clips, commitSnapshot, handleUpdateClip]
  );

  const handleChangeMonitorInteractionMode = useCallback((mode: MonitorInteractionMode) => {
    if (mode !== 'none') {
      setMonitorMode('program');
    }
    setMonitorInteractionMode(mode);
  }, []);

  const resolveChromaTargetClip = useCallback((): TimelineClip | null => {
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
    return (
      (selectedClip && activeVisualClipsAtPlayhead.some((c) => c.id === selectedClip.id)
        ? selectedClip
        : activeVisualClipsAtPlayhead[0]) || selectedClip
    );
  }, [tracks, clips, playhead, selectedClip]);

  const handlePickChromaColor = useCallback(
    (hex: string, addAsShade: boolean, keepPicking = false) => {
      const target = resolveChromaTargetClip();
      if (!target) {
        setMonitorInteractionMode('none');
        return;
      }
      const normalized = hex.toUpperCase();
      commitSnapshot(tracks, clips);
      handleUpdateClip(target.id, (c) => {
        const ck = c.vfx.chromaKey;
        if (addAsShade) {
          const existing = ck.additionalColors || [];
          const nextAdditional =
            normalized !== ck.color.toUpperCase() && !existing.includes(normalized)
              ? [...existing, normalized].slice(0, 6)
              : existing;
          return {
            ...c,
            vfx: {
              ...c.vfx,
              chromaKey: {
                ...ck,
                enabled: true,
                additionalColors: nextAdditional,
              },
            },
          };
        }
        return {
          ...c,
          vfx: {
            ...c.vfx,
            chromaKey: {
              ...ck,
              enabled: true,
              color: normalized,
            },
          },
        };
      });
      setSelectedClipId(target.id);
      setInspectorTab('motion');
      if (!keepPicking) {
        setMonitorInteractionMode('none');
      }
    },
    [resolveChromaTargetClip, tracks, clips, commitSnapshot, handleUpdateClip]
  );

  const handleSetChromaRegion = useCallback(
    (region: { x: number; y: number; width: number; height: number }) => {
      const target = resolveChromaTargetClip();
      if (!target) {
        setMonitorInteractionMode('none');
        return;
      }
      commitSnapshot(tracks, clips);
      handleUpdateClip(target.id, (c) => ({
        ...c,
        vfx: {
          ...c.vfx,
          chromaKey: {
            ...c.vfx.chromaKey,
            enabled: true,
            region: {
              ...region,
              enabled: true,
              feather: c.vfx.chromaKey.region?.feather ?? 4,
            },
          },
        },
      }));
      setSelectedClipId(target.id);
      setInspectorTab('motion');
      setMonitorInteractionMode('none');
    },
    [resolveChromaTargetClip, tracks, clips, commitSnapshot, handleUpdateClip]
  );

  const handleBatchApplyColorGrade = useCallback(
    (assetIds: string[], presetId: string): { updatedAssets: number; updatedClips: number } => {
      const preset = COLOR_PRESETS.find((p) => p.id === presetId);
      if (!preset || assetIds.length === 0) return { updatedAssets: 0, updatedClips: 0 };

      const idSet = new Set(assetIds);
      const updatedAssets = assets.filter((a) => idSet.has(a.id) && a.type !== 'audio').length;
      const matchingClipIds = new Set(
        clips.filter((c) => idSet.has(c.assetId) && c.type !== 'audio').map((c) => c.id)
      );

      setAssets((prev) =>
        prev.map((a) =>
          idSet.has(a.id) && a.type !== 'audio'
            ? {
                ...a,
                defaultColorGrade: {
                  ...DEFAULT_COLOR_GRADE,
                  presetId: preset.id,
                  ...preset.grade,
                },
              }
            : a
        )
      );

      if (matchingClipIds.size > 0) {
        commitSnapshot(tracks, clips);
        setClips((prev) =>
          prev.map((c) =>
            matchingClipIds.has(c.id)
              ? {
                  ...c,
                  color: {
                    ...c.color,
                    presetId: preset.id,
                    ...preset.grade,
                  },
                }
              : c
          )
        );
      }

      return { updatedAssets, updatedClips: matchingClipIds.size };
    },
    [assets, clips, tracks, commitSnapshot]
  );

  const handleBatchResizeAssets = useCallback(
    (
      assetIds: string[],
      options: { scale: number; width?: number; height?: number; resetPosition?: boolean }
    ): { updatedAssets: number; updatedClips: number } => {
      if (assetIds.length === 0) return { updatedAssets: 0, updatedClips: 0 };

      const idSet = new Set(assetIds);
      const updatedAssets = assets.filter((a) => idSet.has(a.id) && a.type !== 'audio').length;
      const matchingClipIds = new Set(
        clips.filter((c) => idSet.has(c.assetId) && c.type !== 'audio').map((c) => c.id)
      );

      setAssets((prev) =>
        prev.map((a) =>
          idSet.has(a.id) && a.type !== 'audio'
            ? {
                ...a,
                width: options.width ?? a.width,
                height: options.height ?? a.height,
                defaultTransform: {
                  ...(a.defaultTransform || {}),
                  scale: options.scale,
                  ...(options.resetPosition ? { x: 0, y: 0 } : {}),
                },
              }
            : a
        )
      );

      if (matchingClipIds.size > 0) {
        commitSnapshot(tracks, clips);
        setClips((prev) =>
          prev.map((c) =>
            matchingClipIds.has(c.id)
              ? {
                  ...c,
                  transform: {
                    ...c.transform,
                    scale: options.scale,
                    ...(options.resetPosition ? { x: 0, y: 0 } : {}),
                  },
                }
              : c
          )
        );
      }

      return { updatedAssets, updatedClips: matchingClipIds.size };
    },
    [assets, clips, tracks, commitSnapshot]
  );

  const handleApplyEffect = useCallback(
    (updater: (clip: TimelineClip) => Partial<TimelineClip>) => {
      if (!selectedClipId) return;
      commitSnapshot(tracks, clips);
      handleUpdateClip(selectedClipId, (c) => ({ ...c, ...updater(c) }));
      setInspectorTab('motion');
    },
    [selectedClipId, tracks, clips, commitSnapshot, handleUpdateClip]
  );

  const handleApplyTransition = useCallback(
    (clipId: string, edge: 'in' | 'out', type: TransitionType, duration = 0.6) => {
      commitSnapshot(tracks, clips);
      handleUpdateClip(clipId, (c) => ({
        ...c,
        [edge === 'in' ? 'transitionIn' : 'transitionOut']: { type, duration },
      }));
    },
    [tracks, clips, commitSnapshot, handleUpdateClip]
  );

  const handleCreateAdjustmentLayer = useCallback(() => {
    commitSnapshot(tracks, clips);
    const adj: TimelineClip = {
      id: generateId('adj'),
      assetId: 'adjustment_layer',
      trackId: 'V3',
      name: 'Adjustment Layer',
      type: 'adjustment',
      start: playhead,
      duration: 5.0,
      inPoint: 0,
      speed: 1,
      reversed: false,
      disabled: false,
      label: 'amber',
      transform: { ...DEFAULT_TRANSFORM },
      color: { ...DEFAULT_COLOR_GRADE, contrast: 14, vignette: 25 },
      vfx: { ...DEFAULT_VFX },
      audio: { ...DEFAULT_AUDIO },
      transitionIn: { type: 'none', duration: 0 },
      transitionOut: { type: 'none', duration: 0 },
    };
    setClips((prev) => [...prev, adj]);
    setSelectedClipId(adj.id);
    setInspectorTab('color');
  }, [tracks, clips, playhead, commitSnapshot]);

  const handleRemixMusicToSequence = useCallback(() => {
    const videoEnd = clips
      .filter((c) => c.type !== 'audio')
      .reduce((acc, c) => Math.max(acc, c.start + c.duration), 0);
    if (videoEnd <= 0.5) return;
    commitSnapshot(tracks, clips);
    setClips((prev) =>
      prev.map((c) =>
        c.type === 'audio' && c.start < videoEnd
          ? {
              ...c,
              duration: Math.max(1, videoEnd - c.start),
              audio: { ...c.audio, fadeOut: Math.min(1.5, (videoEnd - c.start) * 0.2) },
            }
          : c
      )
    );
  }, [clips, tracks, commitSnapshot]);

  // Execute AI Assistant natural-language commands
  const handleExecuteAiActions = useCallback(
    async (actions: AiActionPayload[]) => {
      for (const act of actions) {
        const targetId = act.clipId || selectedClipId || clips[0]?.id;
        switch (act.type) {
          case 'split_at_playhead':
            handleSplitAtPlayhead();
            break;
          case 'add_marker':
            setMarkers((m) => [
              ...m,
              {
                id: generateId('mk'),
                time: act.time ?? playhead,
                label: act.name || 'AI Marker',
                color: 'amber',
              },
            ]);
            break;
          case 'apply_color_preset':
            if (targetId && act.presetId) {
              const preset = COLOR_PRESETS.find((p) => p.id === act.presetId);
              if (preset) {
                handleUpdateClip(targetId, (c) => ({
                  ...c,
                  color: { ...c.color, presetId: preset.id, ...preset.grade },
                }));
              }
            }
            break;
          case 'auto_color':
            if (targetId) {
              const target = clips.find((c) => c.id === targetId);
              const asset = target ? assetsMap.get(target.assetId) : null;
              if (target && asset) {
                const grade = await computeAutoColorGrade(asset, target.color);
                handleUpdateClip(targetId, (c) => ({ ...c, color: { ...c.color, ...grade } }));
              }
            }
            break;
          case 'set_label_color':
            if (targetId && act.label) {
              handleUpdateClip(targetId, (c) => ({ ...c, label: act.label }));
            }
            break;
          case 'rename_clip':
            if (targetId && act.name) {
              handleUpdateClip(targetId, (c) => ({ ...c, name: act.name! }));
            }
            break;
          case 'create_title':
            handleInsertTitle(act.text || 'TITLE', {
              text: act.text || 'NEW TITLE',
              subtitle: act.subtitle || '',
              fontFamily: 'Plus Jakarta Sans',
              fontSize: act.layout === 'lower-third' ? 34 : 72,
              fontWeight: '700',
              color: '#FFFFFF',
              bgColor: '#09090B',
              bgOpacity: act.layout === 'lower-third' ? 76 : 0,
              align: act.layout === 'lower-third' ? 'left' : 'center',
              letterSpacing: act.layout === 'lower-third' ? 2 : 10,
              layout: (act.layout as TextConfig['layout']) || 'lower-third',
              animation: 'fade-up',
            });
            break;
          case 'apply_transition':
            if (targetId && act.transitionType) {
              handleApplyTransition(targetId, act.edge || 'in', act.transitionType as TransitionType, 0.65);
            }
            break;
          case 'auto_reframe':
            if (act.aspect === '9:16') handleChangeAspectPreset('9:16-vertical');
            else if (act.aspect === '1:1') handleChangeAspectPreset('1:1-square');
            else if (act.aspect === '4:5') handleChangeAspectPreset('4:5-social');
            else handleChangeAspectPreset('16:9-hd');
            break;
          case 'duck_music':
            setClips((prev) =>
              prev.map((c) =>
                c.type === 'audio'
                  ? { ...c, audio: { ...c.audio, essentialCategory: 'music', autoDuckMusic: true, volume: Math.min(c.audio.volume, 55) } }
                  : c
              )
            );
            break;
          case 'add_adjustment_layer':
            handleCreateAdjustmentLayer();
            break;
        }
      }
    },
    [
      selectedClipId,
      clips,
      playhead,
      assetsMap,
      handleSplitAtPlayhead,
      handleUpdateClip,
      handleInsertTitle,
      handleApplyTransition,
      handleChangeAspectPreset,
      handleCreateAdjustmentLayer,
    ]
  );

  // Keyboard shortcuts (active inside Edit & Upload Studio)
  useEffect(() => {
    if (appView !== 'studio') return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && selectedClip) {
        e.preventDefault();
        setClipboardClip(selectedClip);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x' && selectedClip) {
        e.preventDefault();
        setClipboardClip(selectedClip);
        handleDeleteSelectedClip(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && clipboardClip) {
        e.preventDefault();
        commitSnapshot(tracks, clips);
        const pasted: TimelineClip = { ...clipboardClip, id: generateId('clip'), start: playhead };
        setClips((prev) => [...prev, pasted]);
        setSelectedClipId(pasted.id);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && selectedClip) {
        e.preventDefault();
        handleDuplicateSelectedClip();
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          handleTogglePlay();
          break;
        case 'v':
        case 'V':
          setToolMode('select');
          break;
        case 'b':
        case 'B':
          setToolMode('ripple');
          break;
        case 'n':
        case 'N':
          setToolMode('roll');
          break;
        case 'y':
        case 'Y':
          setToolMode('slip');
          break;
        case 'u':
        case 'U':
          setToolMode('slide');
          break;
        case 'c':
        case 'C':
          setToolMode('razor');
          break;
        case 't':
        case 'T':
          setToolMode('text');
          break;
        case 'h':
        case 'H':
          setToolMode('hand');
          break;
        case 's':
        case 'S':
          setSnapEnabled((s) => !s);
          break;
        case 'm':
        case 'M':
          setMarkers((mk) => [
            ...mk,
            { id: generateId('mk'), time: playhead, label: `Marker ${mk.length + 1}`, color: 'amber' },
          ]);
          break;
        case 'i':
        case 'I':
          setInPoint(playhead);
          break;
        case 'o':
        case 'O':
          setOutPoint(playhead);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleStepFrame(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleStepFrame(1);
          break;
        case 'Home':
          e.preventDefault();
          handleSeek(0);
          break;
        case 'End':
          e.preventDefault();
          handleSeek(totalDuration);
          break;
        case 'Delete':
        case 'Backspace':
          if (selectedClipId) {
            e.preventDefault();
            handleDeleteSelectedClip(e.shiftKey);
          }
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    appView,
    handleUndo,
    handleRedo,
    handleTogglePlay,
    handleStepFrame,
    handleSeek,
    handleDeleteSelectedClip,
    handleDuplicateSelectedClip,
    commitSnapshot,
    selectedClip,
    clipboardClip,
    tracks,
    clips,
    playhead,
    totalDuration,
    selectedClipId,
  ]);

  const defaultBinWidth = workspace === 'Assembly' ? 340 : workspace === 'Color' ? 240 : 280;
  const defaultInspectorWidth =
    workspace === 'Color' || workspace === 'Audio' || workspace === 'Captions' ? 340 : 300;
  const resolvedBinWidth = studioLayout.binWidth ?? defaultBinWidth;
  const resolvedInspectorWidth = studioLayout.inspectorWidth ?? defaultInspectorWidth;
  const resolvedTimelineHeight = studioLayout.timelineHeight;
  const isStudioLayoutCustomized =
    studioLayout.binWidth !== null ||
    studioLayout.inspectorWidth !== null ||
    studioLayout.timelineHeight !== 330;

  const startStudioResize = (kind: 'bin' | 'inspector' | 'timeline', e: React.MouseEvent) => {
    e.preventDefault();
    setActiveStudioResize(kind);
    const startX = e.clientX;
    const startY = e.clientY;
    const startBin = resolvedBinWidth;
    const startInspector = resolvedInspectorWidth;
    const startTimeline = resolvedTimelineHeight;

    const onMove = (ev: MouseEvent) => {
      if (kind === 'bin') {
        const next = clamp(startBin + (ev.clientX - startX), 180, 560);
        setStudioLayout((prev) => ({ ...prev, binWidth: Math.round(next) }));
      } else if (kind === 'inspector') {
        const next = clamp(startInspector - (ev.clientX - startX), 220, 560);
        setStudioLayout((prev) => ({ ...prev, inspectorWidth: Math.round(next) }));
      } else {
        const maxTimeline = Math.max(240, window.innerHeight - 230);
        const next = clamp(startTimeline - (ev.clientY - startY), 170, maxTimeline);
        setStudioLayout((prev) => ({ ...prev, timelineHeight: Math.round(next) }));
      }
    };

    const onUp = () => {
      setActiveStudioResize(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleSelectView = useCallback((view: AppViewMode) => {
    if (view !== 'studio') {
      setIsPlaying(false);
    }
    setAppView(view);
  }, []);

  const normalizedPath = currentPath.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/auth/tiktok/callback') {
    return (
      <TikTokCallbackView
        onFallbackHome={() => {
          refreshSavedAccounts();
          navigateTo('/');
        }}
      />
    );
  }
  if (normalizedPath === '/terms' || normalizedPath === '/terms-of-service') {
    return <LegalPages doc="terms" onNavigate={navigateTo} />;
  }
  if (normalizedPath === '/privacy' || normalizedPath === '/privacy-policy') {
    return <LegalPages doc="privacy" onNavigate={navigateTo} />;
  }

  return (
    <div className="h-screen w-screen bg-[#121214] text-[#EAEAF0] flex flex-col overflow-hidden">
      <TopBar
        activeView={appView}
        onSelectView={handleSelectView}
        onOpenExport={() => {
          setIsPlaying(false);
          setIsExportOpen(true);
        }}
        onNavigate={navigateTo}
        savedTikTokUser={savedTikTokUser}
        savedYouTubeUser={savedYouTubeUser}
      />

      {appView === 'home' && (
        <HomeScreen
          sequence={sequence}
          clipCount={clips.length}
          totalDuration={totalDuration}
          assets={assets}
          savedTikTokUser={savedTikTokUser}
          savedYouTubeUser={savedYouTubeUser}
          onOpenMetrics={(platform) => {
            if (platform) setMetricsPlatform(platform);
            setIsPlaying(false);
            setAppView('metrics');
          }}
          onOpenEditor={(ws) => {
            if (ws) handleSelectWorkspace(ws);
            setAppView('studio');
          }}
          onOpenExport={() => {
            setIsPlaying(false);
            setIsExportOpen(true);
          }}
          onImportFiles={handleImportFiles}
          onSelectAssetAndEdit={(assetId) => {
            setSelectedSourceId(assetId);
            setMonitorMode('source');
            handleSelectWorkspace('Editing');
            setAppView('studio');
          }}
        />
      )}

      {appView === 'metrics' && (
        <MetricsDashboard
          initialPlatform={metricsPlatform}
          recentTikTokPublishId={lastTikTokPublishId}
          onBackHome={() => setAppView('home')}
          onOpenEditor={() => setAppView('studio')}
          onOpenExport={() => setIsExportOpen(true)}
          onAccountStatusChanged={refreshSavedAccounts}
        />
      )}

      {appView === 'studio' && (
        <>
          <div className="h-8 px-4 bg-[#131317] border-b border-[#24242C] flex items-center justify-between gap-4 shrink-0 select-none">
            <div className="flex items-center gap-4 overflow-x-auto">
              {(['Assembly', 'Editing', 'Color', 'Audio', 'Effects', 'Captions'] as WorkspaceMode[]).map((ws) => {
                const active = workspace === ws;
                return (
                  <button
                    key={ws}
                    type="button"
                    onClick={() => handleSelectWorkspace(ws)}
                    className={`py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active ? 'text-[#60A5FA]' : 'text-[#8E8E9B] hover:text-[#EAEAF0]'
                    }`}
                  >
                    {ws}
                  </button>
                );
              })}
            </div>
            <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono-tabular text-[#7D7D8A] shrink-0">
              {isStudioLayoutCustomized && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setStudioLayout({ binWidth: null, inspectorWidth: null, timelineHeight: 330 })
                    }
                    title="Reset Edit Windows to Default Sizes"
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1B1B22] hover:bg-[#262630] border border-[#2C2C38] text-[10px] font-sans text-[#B4B4C2] hover:text-white cursor-pointer"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Reset Layout</span>
                  </button>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span>{sequence.name}</span>
              <span aria-hidden="true">·</span>
              <span>
                {sequence.width}×{sequence.height} · {sequence.fps}fps
              </span>
            </div>
          </div>

          <div
            className={`flex-1 min-h-0 flex overflow-hidden ${
              activeStudioResize === 'bin' || activeStudioResize === 'inspector' ? 'select-none cursor-col-resize' : ''
            } ${activeStudioResize === 'timeline' ? 'select-none cursor-row-resize' : ''}`}
          >
        <div style={{ width: `${resolvedBinWidth}px` }} className="shrink-0 hidden md:block h-full">
          <ProjectBin
            activeTab={binTab}
            onTabChange={setBinTab}
            bins={bins}
            activeBinId={activeBinId}
            onSelectBin={setActiveBinId}
            onCreateBin={() => {
              const newBin: MediaBinFolder = { id: generateId('bin'), name: `Bin ${bins.length}` };
              setBins((b) => [...b, newBin]);
              setActiveBinId(newBin.id);
            }}
            assets={assets}
            selectedSourceId={selectedSourceId}
            hasSelectedClip={Boolean(selectedClip)}
            onSelectSource={(id) => {
              setSelectedSourceId(id);
              setMonitorMode('source');
            }}
            onAddToTimeline={(asset) => addAssetAsClip(asset)}
            onImportFiles={handleImportFiles}
            onCreateColorMatte={() => {
              const palette = ['#0F172A', '#1E293B', '#18181B', '#312E81', '#064E3B'];
              const matteColor = palette[assets.length % palette.length];
              const matteAsset: MediaAsset = {
                id: generateId('matte'),
                name: `Color Matte ${assets.length + 1}`,
                type: 'matte',
                src: '',
                matteColor,
                duration: 5.0,
                width: 1920,
                height: 1080,
                binId: 'bin_b_roll',
                label: 'amber',
              };
              setAssets((prev) => [matteAsset, ...prev]);
              setSelectedSourceId(matteAsset.id);
            }}
            onCreateAdjustmentLayer={handleCreateAdjustmentLayer}
            onCreateMulticamAsset={() => {
              const mc: MediaAsset = {
                id: generateId('mc'),
                name: `Multicam_Sync_4Cam`,
                type: 'image',
                src: studioDirectorImg,
                thumbnailUrl: studioDirectorImg,
                duration: 6.0,
                width: 1920,
                height: 1080,
                fps: sequence.fps,
                multicamGroup: 'sync_group_1',
                binId: 'bin_a_cam',
                label: 'rose',
              };
              setAssets((prev) => [mc, ...prev]);
              addAssetAsClip(mc, 'V1', playhead);
            }}
            onSetAssetLabel={(assetId, label) =>
              setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, label } : a)))
            }
            onInsertTitlePreset={(name, cfg) => handleInsertTitle(name, cfg)}
            onApplyColorPreset={handleApplyColorPreset}
            onApplyEffect={handleApplyEffect}
            onApplyTransition={(edge, type, dur) => {
              if (selectedClipId) handleApplyTransition(selectedClipId, edge, type, dur);
            }}
            onBatchColorGrade={handleBatchApplyColorGrade}
            onBatchResizeAssets={handleBatchResizeAssets}
          />
        </div>

        {/* Left Horizontal Window Resizer (ProjectBin <-> Monitor) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Project Bin width"
          title="Drag to resize Project Bin (double-click to reset)"
          onMouseDown={(e) => startStudioResize('bin', e)}
          onDoubleClick={() => setStudioLayout((prev) => ({ ...prev, binWidth: null }))}
          className={`hidden md:flex w-1.5 shrink-0 cursor-col-resize items-center justify-center group transition-colors ${
            activeStudioResize === 'bin' ? 'bg-[#3B82F6]/45' : 'bg-[#121215] hover:bg-[#3B82F6]/30'
          }`}
        >
          <div
            className={`w-[1.5px] h-10 rounded-full transition-colors ${
              activeStudioResize === 'bin' ? 'bg-[#60A5FA]' : 'bg-[#2C2C36] group-hover:bg-[#60A5FA]'
            }`}
          />
        </div>

        <main className="flex-1 min-w-0 h-full">
          <MonitorPanel
            monitorMode={monitorMode}
            onMonitorModeChange={setMonitorMode}
            sequence={sequence}
            sourceVideoFps={sourceVideoFps}
            onChangeAspectPreset={handleChangeAspectPreset}
            onChangeFps={(fps, fromMatch) => {
              manualFpsOverrideRef.current = !fromMatch;
              if (fromMatch) hasMatchedVideoFpsRef.current = true;
              setSequence((s) => ({ ...s, fps }));
            }}
            onToggleProxyMode={() => setSequence((s) => ({ ...s, proxyMode: !s.proxyMode }))}
            tracks={tracks}
            clips={clips}
            captions={captions}
            showCaptionsOverlay={showCaptionsOverlay}
            onToggleCaptionsOverlay={() => setShowCaptionsOverlay((v) => !v)}
            assetsMap={assetsMap}
            playhead={playhead}
            totalDuration={totalDuration}
            isPlaying={isPlaying}
            loopEnabled={loopEnabled}
            inPoint={inPoint}
            outPoint={outPoint}
            sourceAsset={sourceAsset}
            selectedClip={selectedClip}
            onSwitchMulticamAngle={(clipId, angleIdx) =>
              handleUpdateClip(clipId, (c) => ({ ...c, activeAngleIndex: angleIdx }))
            }
            onTogglePlay={handleTogglePlay}
            onSeek={handleSeek}
            onStepFrame={handleStepFrame}
            onToggleLoop={() => setLoopEnabled((l) => !l)}
            onSetInPoint={() => setInPoint(playhead)}
            onSetOutPoint={() => setOutPoint(playhead)}
            onClearInOut={() => {
              setInPoint(null);
              setOutPoint(null);
            }}
            onSplitAtPlayhead={handleSplitAtPlayhead}
            onAddMarkerAtPlayhead={() =>
              setMarkers((mk) => [
                ...mk,
                { id: generateId('mk'), time: playhead, label: `Marker ${mk.length + 1}`, color: 'amber' },
              ])
            }
            onInsertSourceClip={(asset, inPt, outPt) => addAssetAsClip(asset, undefined, playhead, inPt, outPt)}
            interactionMode={monitorInteractionMode}
            onChangeInteractionMode={handleChangeMonitorInteractionMode}
            checkerboardBg={checkerboardBg}
            onPickChromaColor={handlePickChromaColor}
            onSetChromaRegion={handleSetChromaRegion}
          />
        </main>

        {/* Right Horizontal Window Resizer (Monitor <-> Inspector) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Inspector panel width"
          title="Drag to resize Inspector (double-click to reset)"
          onMouseDown={(e) => startStudioResize('inspector', e)}
          onDoubleClick={() => setStudioLayout((prev) => ({ ...prev, inspectorWidth: null }))}
          className={`hidden lg:flex w-1.5 shrink-0 cursor-col-resize items-center justify-center group transition-colors ${
            activeStudioResize === 'inspector' ? 'bg-[#3B82F6]/45' : 'bg-[#121215] hover:bg-[#3B82F6]/30'
          }`}
        >
          <div
            className={`w-[1.5px] h-10 rounded-full transition-colors ${
              activeStudioResize === 'inspector' ? 'bg-[#60A5FA]' : 'bg-[#2C2C36] group-hover:bg-[#60A5FA]'
            }`}
          />
        </div>

        <div style={{ width: `${resolvedInspectorWidth}px` }} className="shrink-0 hidden lg:block h-full">
          <InspectorPanel
            activeTab={inspectorTab}
            onTabChange={setInspectorTab}
            selectedClip={selectedClip}
            playhead={playhead}
            sequence={sequence}
            tracks={tracks}
            clips={clips}
            assets={assets}
            captions={captions}
            comments={comments}
            versions={versions}
            masterVolume={masterVolume}
            onMasterVolumeChange={setMasterVolume}
            onUpdateClip={handleUpdateClip}
            onUpdateTrackMixer={(trackId, patch) =>
              setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...patch } : t)))
            }
            onApplyColorPreset={handleApplyColorPreset}
            onInsertTitleAtPlayhead={() =>
              handleInsertTitle('New Title', {
                text: 'NEW TITLE',
                subtitle: 'SUBTITLE LINE',
                fontFamily: 'Plus Jakarta Sans',
                fontSize: 64,
                fontWeight: '700',
                color: '#FFFFFF',
                bgColor: '#000000',
                bgOpacity: 0,
                align: 'center',
                letterSpacing: 8,
                layout: 'center-title',
                animation: 'fade-up',
              })
            }
            onUpdateCaptions={setCaptions}
            onExecuteAiActions={handleExecuteAiActions}
            onAddGeneratedVoiceover={handleAddGeneratedVoiceover}
            onSplitClipMultiple={handleSplitClipMultiple}
            onRemixMusicToSequence={handleRemixMusicToSequence}
            onAddReviewComment={(text) =>
              setComments((prev) => [
                {
                  id: generateId('rev'),
                  time: playhead,
                  author: 'Editor',
                  text,
                  resolved: false,
                  createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                },
                ...prev,
              ])
            }
            onToggleResolveComment={(id) =>
              setComments((prev) => prev.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c)))
            }
            onDeleteReviewComment={(id) => setComments((prev) => prev.filter((c) => c.id !== id))}
            onSaveVersion={(name) =>
              setVersions((prev) => [
                {
                  id: generateId('ver'),
                  name,
                  createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  tracks: JSON.parse(JSON.stringify(tracks)),
                  clips: JSON.parse(JSON.stringify(clips)),
                },
                ...prev,
              ])
            }
            onRestoreVersion={(id) => {
              const found = versions.find((v) => v.id === id);
              if (!found) return;
              commitSnapshot(tracks, clips);
              setTracks(found.tracks);
              setClips(found.clips);
            }}
            onSeek={handleSeek}
            monitorInteractionMode={monitorInteractionMode}
            onChangeMonitorInteractionMode={handleChangeMonitorInteractionMode}
            checkerboardBg={checkerboardBg}
            onToggleCheckerboardBg={() => setCheckerboardBg((v) => !v)}
          />
        </div>
      </div>

      {/* Vertical Window Resizer (Monitors <-> Timeline) */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize Timeline height"
        title="Drag to resize Timeline (double-click to reset)"
        onMouseDown={(e) => startStudioResize('timeline', e)}
        onDoubleClick={() => setStudioLayout((prev) => ({ ...prev, timelineHeight: 330 }))}
        className={`h-1.5 shrink-0 cursor-row-resize flex items-center justify-center group transition-colors ${
          activeStudioResize === 'timeline' ? 'bg-[#3B82F6]/45' : 'bg-[#121215] hover:bg-[#3B82F6]/30'
        }`}
      >
        <div
          className={`h-[1.5px] w-14 rounded-full transition-colors ${
            activeStudioResize === 'timeline' ? 'bg-[#60A5FA]' : 'bg-[#2C2C36] group-hover:bg-[#60A5FA]'
          }`}
        />
      </div>

      <div style={{ height: `${resolvedTimelineHeight}px` }} className="shrink-0">
        <TimelinePanel
          tracks={tracks}
          clips={clips}
          markers={markers}
          assetsMap={assetsMap}
          sequence={sequence}
          playhead={playhead}
          totalDuration={totalDuration}
          selectedClipId={selectedClipId}
          toolMode={toolMode}
          snapEnabled={snapEnabled}
          pixelsPerSecond={pixelsPerSecond}
          inPoint={inPoint}
          outPoint={outPoint}
          canUndo={past.length > 0}
          canRedo={future.length > 0}
          getMeterLevels={getMeterLevels}
          onToolChange={setToolMode}
          onToggleSnap={() => setSnapEnabled((s) => !s)}
          onZoomChange={setPixelsPerSecond}
          onSeek={handleSeek}
          onSelectClip={handleSelectClip}
          onMoveClip={handleMoveClip}
          onTrimClip={handleTrimClip}
          onSlipClip={handleSlipClip}
          onSplitClipAt={handleSplitClipAt}
          onSplitAtPlayhead={handleSplitAtPlayhead}
          onDeleteSelectedClip={handleDeleteSelectedClip}
          onDuplicateSelectedClip={handleDuplicateSelectedClip}
          onNestSelectedClip={handleNestSelectedClip}
          onToggleTrackProp={(trackId, prop) =>
            setTracks((prev) =>
              prev.map((t) => (t.id === trackId ? { ...t, [prop]: !t[prop] } : t))
            )
          }
          onAddTrack={(type) => {
            commitSnapshot(tracks, clips);
            const count = tracks.filter((t) => t.type === type).length + 1;
            const id = `${type === 'video' ? 'V' : 'A'}${count}`;
            const newTrack: Track = {
              id,
              name: id,
              type,
              visible: true,
              muted: false,
              solo: false,
              locked: false,
              height: 54,
              gain: 100,
              pan: 0,
            };
            setTracks((prev) => (type === 'video' ? [newTrack, ...prev] : [...prev, newTrack]));
          }}
          onDropAssetOnTrack={(assetId, trackId, startTime) => {
            const asset = assetsMap.get(assetId);
            if (!asset) return;
            const targetTrack = tracks.find((t) => t.id === trackId);
            if (!targetTrack) return;
            const compatibleTrackId =
              (asset.type === 'audio' && targetTrack.type === 'audio') ||
              (asset.type !== 'audio' && targetTrack.type === 'video')
                ? trackId
                : undefined;
            addAssetAsClip(asset, compatibleTrackId, startTime);
          }}
          onDropTransitionOnClip={(clipId, edge, type) => handleApplyTransition(clipId, edge, type, 0.65)}
          onInsertTitleAt={(trackId, startTime) =>
            handleInsertTitle(
              'New Title',
              {
                text: 'NEW TITLE',
                subtitle: 'CLICK GRAPHICS TO EDIT',
                fontFamily: 'Plus Jakarta Sans',
                fontSize: 64,
                fontWeight: '700',
                color: '#FFFFFF',
                bgColor: '#000000',
                bgOpacity: 0,
                align: 'center',
                letterSpacing: 8,
                layout: 'center-title',
                animation: 'fade-up',
              },
              trackId,
              startTime
            )
          }
          onRecordedVoiceover={handleRecordedVoiceover}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onResetProject={() => {
            commitSnapshot(tracks, clips);
            setTracks(INITIAL_TRACKS);
            setMarkers(INITIAL_MARKERS);
            setCaptions(INITIAL_CAPTIONS);
            setPlayhead(0);
            setIsPlaying(false);
            setClips([]);
            setSelectedClipId(null);
            hasMatchedVideoFpsRef.current = false;
            manualFpsOverrideRef.current = false;
          }}
            onOpenShortcuts={() => setIsShortcutsOpen(true)}
          />
        </div>
        </>
      )}

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        onNavigate={navigateTo}
        onAccountStatusChanged={refreshSavedAccounts}
        onOpenMetrics={(platform) => {
          setMetricsPlatform(platform);
          setIsExportOpen(false);
          setAppView('metrics');
        }}
        onTikTokPublished={(publishId) => setLastTikTokPublishId(publishId)}
        sequence={sequence}
        sourceVideoFps={sourceVideoFps}
        tracks={tracks}
        clips={clips}
        captions={captions}
        assetsMap={assetsMap}
        inPoint={inPoint}
        outPoint={outPoint}
        totalDuration={totalDuration}
      />

      <ShortcutsModal isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />
      <OfflineIndicator />
    </div>
  );
}
