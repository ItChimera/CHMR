import { getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User,
  browserPopupRedirectResolver,
  getAuth,
  inMemoryPersistence,
  initializeAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { parseJsonResponse } from './runtime';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth: Auth = (() => {
  try {
    return initializeAuth(app, {
      persistence: inMemoryPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    const existing = getAuth(app);
    setPersistence(existing, inMemoryPersistence).catch(() => {});
    return existing;
  }
})();

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

export const YOUTUBE_TEST_USERS_URL = `https://console.cloud.google.com/auth/audience?project=${firebaseConfig.projectId}`;

const provider = new GoogleAuthProvider();
for (const scope of YOUTUBE_SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({ prompt: 'select_account' });

let isSigningIn = false;
// Keep OAuth access token strictly in memory (never in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let cachedLocalUser: YouTubeAuthUserSummary | null = null;

export interface YouTubeAuthUserSummary {
  displayName: string;
  email: string;
  photoURL?: string;
}

export interface YouTubeChannelInfo {
  id: string;
  title: string;
  handle?: string;
  avatarUrl?: string;
  subscriberCount?: string;
  viewCount?: string;
  videoCount?: string;
  uploadsPlaylistId?: string;
}

export interface YouTubeRecentVideo {
  id: string;
  title: string;
  publishedAt: string;
  thumbnailUrl?: string;
  url: string;
  viewCount?: string;
  likeCount?: string;
  commentCount?: string;
  durationSeconds?: number;
  privacyStatus?: string;
  isShort?: boolean;
}

export interface LocalYouTubeConfigStatus {
  isLocalServer: boolean;
  configured: boolean;
  connected: boolean;
  callbackUrl: string;
  user: { name: string; email: string; avatarUrl?: string } | null;
}

function parseIso8601Duration(iso?: string): number | undefined {
  if (!iso) return undefined;
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return undefined;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

export async function fetchLocalYouTubeStatus(): Promise<LocalYouTubeConfigStatus | null> {
  try {
    const res = await fetch('/api/auth/youtube/status', { credentials: 'include' });
    if (!res.ok) return null;
    const data = await parseJsonResponse<LocalYouTubeConfigStatus>(res);
    if (!data?.isLocalServer) return null;
    return data;
  } catch {
    return null;
  }
}

async function fetchLocalYouTubeAccessToken(): Promise<{
  user: YouTubeAuthUserSummary;
  accessToken: string;
} | null> {
  try {
    const res = await fetch('/api/auth/youtube/token', { credentials: 'include' });
    if (!res.ok) return null;
    const data = await parseJsonResponse<{
      accessToken?: string;
      user?: { name?: string; email?: string; avatarUrl?: string };
    }>(res);
    if (!data?.accessToken) return null;
    cachedAccessToken = data.accessToken;
    cachedLocalUser = {
      displayName: data.user?.name || 'YouTube Creator',
      email: data.user?.email || '',
      photoURL: data.user?.avatarUrl,
    };
    return { user: cachedLocalUser, accessToken: data.accessToken };
  } catch {
    return null;
  }
}

export const initYouTubeAuth = (
  onAuthState?: (user: User | YouTubeAuthUserSummary, token: string | null) => void,
  onAuthCleared?: () => void
) => {
  let active = true;

  // Check if local desktop server already holds an encrypted persistent YouTube session
  fetchLocalYouTubeStatus().then(async (localStatus) => {
    if (!active) return;
    if (localStatus?.configured && localStatus.connected) {
      const tokenRes = await fetchLocalYouTubeAccessToken();
      if (active && tokenRes) {
        onAuthState?.(tokenRes.user, tokenRes.accessToken);
      }
    }
  });

  const handleOAuthMsg = async (event: MessageEvent) => {
    if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'youtube') {
      const tokenRes = await fetchLocalYouTubeAccessToken();
      if (active && tokenRes) {
        onAuthState?.(tokenRes.user, tokenRes.accessToken);
      }
    }
  };

  let bc: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel('chmr_oauth');
      bc.onmessage = async (event) => {
        if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'youtube') {
          const tokenRes = await fetchLocalYouTubeAccessToken();
          if (active && tokenRes) {
            onAuthState?.(tokenRes.user, tokenRes.accessToken);
          }
        }
      };
    } catch {
      bc = null;
    }
  }
  window.addEventListener('message', handleOAuthMsg);

  const unsubFirebase = onAuthStateChanged(auth, (user: User | null) => {
    if (!active) return;
    if (user) {
      onAuthState?.(user, cachedAccessToken);
      return;
    }
    if (cachedLocalUser && cachedAccessToken) {
      onAuthState?.(cachedLocalUser, cachedAccessToken);
      return;
    }
    if (!isSigningIn) {
      cachedAccessToken = null;
      onAuthCleared?.();
    }
  });

  return () => {
    active = false;
    window.removeEventListener('message', handleOAuthMsg);
    bc?.close();
    unsubFirebase();
  };
};

async function signInYouTubeLocal(): Promise<{ user: YouTubeAuthUserSummary; accessToken: string }> {
  const urlRes = await fetch('/api/auth/youtube/url', { credentials: 'include' });
  const urlData = await parseJsonResponse<{ url?: string; error?: string }>(urlRes);
  if (!urlRes.ok || !urlData?.url) {
    throw new Error(urlData?.error || 'Unable to start local YouTube sign-in.');
  }

  return new Promise<{ user: YouTubeAuthUserSummary; accessToken: string }>((resolve, reject) => {
    const popup = window.open(urlData.url!, 'youtube_local_oauth', 'width=560,height=720');
    if (!popup) {
      reject(new Error('Popup was blocked. Allow popups once to authorize YouTube locally.'));
      return;
    }

    let settled = false;
    let bc: BroadcastChannel | null = null;

    const cleanup = () => {
      window.removeEventListener('message', onMsg);
      bc?.close();
      window.clearInterval(pollTimer);
    };

    const tryComplete = async () => {
      if (settled) return;
      const tokenRes = await fetchLocalYouTubeAccessToken();
      if (tokenRes) {
        settled = true;
        cleanup();
        resolve(tokenRes);
      }
    };

    const onMsg = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'youtube') {
        tryComplete();
      }
    };
    window.addEventListener('message', onMsg);

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel('chmr_oauth');
        bc.onmessage = (event) => {
          if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'youtube') {
            tryComplete();
          }
        };
      } catch {
        bc = null;
      }
    }

    const pollTimer = window.setInterval(async () => {
      if (popup.closed && !settled) {
        const tokenRes = await fetchLocalYouTubeAccessToken();
        settled = true;
        cleanup();
        if (tokenRes) {
          resolve(tokenRes);
        } else {
          reject(new Error('Local Google sign-in window closed before completing authorization.'));
        }
      }
    }, 450);
  });
}

export const signInYouTube = async (): Promise<{
  user: User | YouTubeAuthUserSummary;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    const localStatus = await fetchLocalYouTubeStatus();
    if (localStatus?.isLocalServer && localStatus.configured) {
      return await signInYouTubeLocal();
    }

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain YouTube permission token from Google sign-in.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        `This domain (${window.location.hostname}) is not yet authorized for Google sign-in. Add "${window.location.hostname}" under Firebase Console → Authentication → Settings → Authorized domains, or download your exported MP4/WebM directly to upload manually.`
      );
    }
    if (code === 'auth/popup-closed-by-user') {
      throw new Error(
        `Google sign-in was closed before finishing. If Google showed "Access blocked (Error 403: access_denied)", add that Gmail address under Test users in Google Cloud (${firebaseConfig.projectId}) or configure your own Google Client ID in Desktop & Updates.`
      );
    }
    throw err;
  } finally {
    isSigningIn = false;
  }
};

export const ensureYouTubeAccessToken = async (): Promise<{
  user: User | YouTubeAuthUserSummary | null;
  accessToken: string;
}> => {
  if (cachedAccessToken) {
    return { user: auth.currentUser || cachedLocalUser, accessToken: cachedAccessToken };
  }
  const localToken = await fetchLocalYouTubeAccessToken();
  if (localToken) {
    return localToken;
  }
  const res = await signInYouTube();
  return { user: res.user, accessToken: res.accessToken };
};

export const signOutYouTube = async (): Promise<void> => {
  cachedAccessToken = null;
  cachedLocalUser = null;
  try {
    await fetch('/api/auth/youtube/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // ignore if running on cloud preview
  }
  await auth.signOut();
};

export const getYouTubeAccessToken = (): string | null => cachedAccessToken;

export function extractYouTubeActivationUrl(message?: string | null): string | null {
  if (!message) return null;
  const match = message.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/youtube\.googleapis\.com[^\s"')}]*/);
  return match ? match[0] : null;
}

export async function fetchMyYouTubeChannel(
  tokenOverride?: string | null
): Promise<YouTubeChannelInfo | null> {
  const token = tokenOverride || cachedAccessToken;
  if (!token) return null;

  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true',
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('YouTube session expired. Please sign in with Google again.');
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    try {
      const parsed = JSON.parse(errText) as {
        error?: { message?: string; status?: string };
      };
      if (parsed.error?.message) {
        throw new Error(parsed.error.message);
      }
    } catch (e) {
      if (e instanceof Error && !e.message.startsWith('Unexpected token') && !e.message.includes('JSON')) {
        throw e;
      }
    }
    throw new Error(`Unable to fetch YouTube channel (${res.status}): ${errText || res.statusText}`);
  }
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        customUrl?: string;
        thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
      };
      statistics?: {
        subscriberCount?: string;
        viewCount?: string;
        videoCount?: string;
        hiddenSubscriberCount?: boolean;
      };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }>;
  };
  const ch = data.items?.[0];
  if (!ch) return null;
  return {
    id: ch.id,
    title: ch.snippet?.title || 'YouTube Channel',
    handle: ch.snippet?.customUrl,
    avatarUrl: ch.snippet?.thumbnails?.medium?.url || ch.snippet?.thumbnails?.default?.url,
    subscriberCount: ch.statistics?.hiddenSubscriberCount ? undefined : ch.statistics?.subscriberCount,
    viewCount: ch.statistics?.viewCount,
    videoCount: ch.statistics?.videoCount,
    uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads,
  };
}

export async function fetchRecentYouTubeUploads(
  uploadsPlaylistId: string,
  tokenOverride?: string | null,
  maxResults = 8
): Promise<YouTubeRecentVideo[]> {
  const token = tokenOverride || cachedAccessToken;
  if (!token || !uploadsPlaylistId) return [];

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${encodeURIComponent(
      uploadsPlaylistId
    )}&maxResults=${maxResults}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    items?: Array<{
      snippet?: {
        title?: string;
        publishedAt?: string;
        resourceId?: { videoId?: string };
        thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
      };
    }>;
  };

  const baseVideos: YouTubeRecentVideo[] = [];
  for (const item of data.items || []) {
    const videoId = item.snippet?.resourceId?.videoId;
    if (!videoId) continue;
    baseVideos.push({
      id: videoId,
      title: item.snippet?.title || 'Untitled Video',
      publishedAt: item.snippet?.publishedAt || '',
      thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url,
      url: `https://youtu.be/${videoId}`,
    });
  }

  if (baseVideos.length === 0) return [];

  // Enrich with real view/like/comment statistics & duration
  try {
    const ids = baseVideos.map((v) => v.id).join(',');
    const statsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,status&id=${encodeURIComponent(ids)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!statsRes.ok) return baseVideos;
    const statsJson = (await statsRes.json()) as {
      items?: Array<{
        id: string;
        snippet?: { title?: string; description?: string };
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
        contentDetails?: { duration?: string };
        status?: { privacyStatus?: string };
      }>;
    };
    const byId = new Map((statsJson.items || []).map((v) => [v.id, v]));
    return baseVideos.map((v) => {
      const detail = byId.get(v.id);
      if (!detail) return v;
      const durationSeconds = parseIso8601Duration(detail.contentDetails?.duration);
      const titleAndDesc = `${detail.snippet?.title || v.title} ${detail.snippet?.description || ''}`;
      const isShort =
        /#shorts\b/i.test(titleAndDesc) || (durationSeconds !== undefined && durationSeconds > 0 && durationSeconds <= 60);
      return {
        ...v,
        viewCount: detail.statistics?.viewCount,
        likeCount: detail.statistics?.likeCount,
        commentCount: detail.statistics?.commentCount,
        durationSeconds,
        privacyStatus: detail.status?.privacyStatus,
        isShort,
        url: isShort ? `https://www.youtube.com/shorts/${v.id}` : `https://youtu.be/${v.id}`,
      };
    });
  } catch {
    return baseVideos;
  }
}

export function parseHashtags(raw: string, ensureShortsTag: boolean): string[] {
  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`));

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const tag of tokens) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(tag);
    }
  }
  if (ensureShortsTag && !seen.has('#shorts')) {
    deduped.unshift('#Shorts');
  }
  return deduped;
}

export function formatSocialCaption(
  description: string,
  hashtags: string,
  ensureShortsTag: boolean
): { fullText: string; tagsList: string[] } {
  const tagsList = parseHashtags(hashtags, ensureShortsTag);
  const tagLine = tagsList.join(' ');
  const trimmedDesc = description.trim();
  const fullText = [trimmedDesc, tagLine].filter(Boolean).join('\n\n');
  return { fullText, tagsList };
}

export async function uploadVideoToYouTube(params: {
  blob: Blob;
  title: string;
  description: string;
  hashtags: string;
  privacyStatus: 'public' | 'unlisted' | 'private';
  isShorts: boolean;
  onProgress?: (pct: number) => void;
}): Promise<{ videoId: string; url: string }> {
  const token = cachedAccessToken;
  if (!token) {
    throw new Error('Please authorize YouTube access with Google sign-in before uploading.');
  }

  const { fullText, tagsList } = formatSocialCaption(
    params.description,
    params.hashtags,
    params.isShorts
  );
  const cleanTitle = (params.title || 'Untitled Video').trim();
  const finalTitle =
    params.isShorts && !/#shorts\b/i.test(cleanTitle) && !/#shorts\b/i.test(fullText)
      ? `${cleanTitle} #Shorts`
      : cleanTitle;

  const mimeType = params.blob.type || 'video/webm';

  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(params.blob.size),
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify({
        snippet: {
          title: finalTitle.slice(0, 100),
          description: fullText.slice(0, 5000),
          tags: tagsList.map((t) => t.replace(/^#/, '')).slice(0, 30),
          categoryId: '22',
        },
        status: {
          privacyStatus: params.privacyStatus,
          selfDeclaredMadeForKids: false,
        },
      }),
    }
  );

  if (!initRes.ok) {
    if (initRes.status === 401) {
      cachedAccessToken = null;
    }
    const errText = await initRes.text().catch(() => '');
    let parsedMsg = `YouTube upload failed (${initRes.status})`;
    try {
      const errJson = JSON.parse(errText);
      if (errJson?.error?.message) parsedMsg = errJson.error.message;
    } catch {
      if (errText) parsedMsg = errText;
    }
    throw new Error(parsedMsg);
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    throw new Error('YouTube did not return a resumable upload location URL.');
  }

  return new Promise<{ videoId: string; url: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', mimeType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        params.onProgress?.((e.loaded / e.total) * 100);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { id?: string };
          const videoId = data.id || '';
          resolve({
            videoId,
            url: params.isShorts
              ? `https://www.youtube.com/shorts/${videoId}`
              : `https://youtu.be/${videoId}`,
          });
        } catch {
          reject(new Error('Unexpected response from YouTube upload endpoint.'));
        }
      } else {
        reject(new Error(`YouTube video transfer failed (${xhr.status}): ${xhr.responseText || xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error while uploading video to YouTube.'));
    xhr.send(params.blob);
  });
}
