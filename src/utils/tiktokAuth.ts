import { parseJsonResponse, STATIC_BACKEND_NOTICE } from './runtime';

export const TIKTOK_SEALED_SESSION_KEY = 'chmr_tiktok_sealed_session';
export const OAUTH_BROADCAST_CHANNEL = 'chmr_oauth';

export interface TikTokUserProfile {
  displayName: string;
  avatarUrl?: string;
}

export interface TikTokStatusResponse {
  configured: boolean;
  connected: boolean;
  callbackUrl: string;
  user: TikTokUserProfile | null;
}

export interface TikTokCreatorStats {
  followerCount?: number;
  followingCount?: number;
  likesCount?: number;
  videoCount?: number;
}

export interface TikTokVideoMetric {
  id: string;
  title: string;
  createTime?: number;
  coverImageUrl?: string;
  shareUrl?: string;
  duration?: number;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
}

export interface TikTokMetricsResponse {
  connected: boolean;
  hasStatsScope: boolean;
  hasVideoListScope: boolean;
  grantedScopes?: string[];
  profile: TikTokUserProfile | null;
  stats: TikTokCreatorStats | null;
  videos: TikTokVideoMetric[];
  apiError?: string;
  note?: string;
}

export interface TikTokPublishStatusResult {
  publishId: string;
  status: string;
  failReason?: string;
  uploadedBytes?: number;
  publicPostIds?: string[];
}

export function getStoredTikTokSealedSession(): string | null {
  try {
    return localStorage.getItem(TIKTOK_SEALED_SESSION_KEY);
  } catch {
    return null;
  }
}

export function setStoredTikTokSealedSession(token?: string | null): void {
  if (!token) return;
  try {
    localStorage.setItem(TIKTOK_SEALED_SESSION_KEY, token);
  } catch {
    // ignore storage quota errors
  }
}

export function clearStoredTikTokSealedSession(): void {
  try {
    localStorage.removeItem(TIKTOK_SEALED_SESSION_KEY);
  } catch {
    // ignore storage errors
  }
}

export function getTikTokAuthHeaders(): Record<string, string> {
  const token = getStoredTikTokSealedSession();
  return token ? { 'x-chmr-tiktok-session': token } : {};
}

export function broadcastTikTokAuthSuccess(sessionToken?: string): void {
  if (sessionToken) {
    setStoredTikTokSealedSession(sessionToken);
  }
  const payload = {
    type: 'OAUTH_AUTH_SUCCESS',
    provider: 'tiktok',
    sessionToken,
  };
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, '*');
    }
  } catch {
    // ignore cross-origin opener postMessage restrictions
  }
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {
    // ignore BroadcastChannel errors
  }
}

export function broadcastTikTokAuthError(errorMessage: string): void {
  const payload = {
    type: 'OAUTH_AUTH_ERROR',
    provider: 'tiktok',
    error: errorMessage,
  };
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, '*');
    }
  } catch {
    // ignore
  }
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {
    // ignore
  }
}

export async function fetchTikTokStatus(): Promise<TikTokStatusResponse | null> {
  try {
    const res = await fetch(
      `/api/auth/tiktok/status?origin=${encodeURIComponent(window.location.origin)}`,
      {
        credentials: 'include',
        headers: getTikTokAuthHeaders(),
      }
    );
    const refreshed = res.headers.get('x-chmr-tiktok-session-refresh');
    if (refreshed) {
      setStoredTikTokSealedSession(refreshed);
    }
    if (!res.ok) return null;
    const data = await parseJsonResponse<TikTokStatusResponse>(res);
    if (!data) return null;
    if (!data.connected) {
      clearStoredTikTokSealedSession();
    }
    return data;
  } catch {
    return null;
  }
}

export async function fetchTikTokMetrics(): Promise<TikTokMetricsResponse | null> {
  try {
    const res = await fetch('/api/metrics/tiktok', {
      credentials: 'include',
      headers: getTikTokAuthHeaders(),
    });
    const refreshed = res.headers.get('x-chmr-tiktok-session-refresh');
    if (refreshed) {
      setStoredTikTokSealedSession(refreshed);
    }
    if (!res.ok) return null;
    return await parseJsonResponse<TikTokMetricsResponse>(res);
  } catch {
    return null;
  }
}

export async function fetchTikTokPublishStatus(
  publishId: string
): Promise<TikTokPublishStatusResult | null> {
  try {
    const res = await fetch('/api/publish/tiktok/status', {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...getTikTokAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ publishId }),
    });
    if (!res.ok) return null;
    return await parseJsonResponse<TikTokPublishStatusResult>(res);
  } catch {
    return null;
  }
}

export async function exchangeTikTokCode(
  code: string,
  state: string
): Promise<{ ok: boolean; user?: TikTokUserProfile; sessionToken?: string; error?: string }> {
  const res = await fetch('/api/auth/tiktok/exchange', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      state,
      origin: window.location.origin,
    }),
  });
  const data = await parseJsonResponse<{
    ok?: boolean;
    user?: TikTokUserProfile;
    sessionToken?: string;
    error?: string;
  }>(res);
  if (!data) {
    return { ok: false, error: STATIC_BACKEND_NOTICE };
  }
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error || 'TikTok authorization failed.' };
  }
  if (data.sessionToken) {
    setStoredTikTokSealedSession(data.sessionToken);
  }
  return {
    ok: true,
    user: data.user,
    sessionToken: data.sessionToken,
  };
}

export async function disconnectTikTok(): Promise<void> {
  clearStoredTikTokSealedSession();
  try {
    await fetch('/api/auth/tiktok/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // ignore transient errors
  }
}
