/**
 * Runtime helpers for static hosting (GitHub Pages, local Vite, subpath deploys)
 * vs server-backed deployments (local Express server or preview server).
 */

const INITIAL_BASE_DIR: string = (() => {
  const viteBase = (import.meta.env.BASE_URL || './').trim();
  if (viteBase && viteBase !== './' && viteBase !== '.') {
    return viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
  }
  if (typeof window !== 'undefined') {
    const pathname = window.location.pathname || '/';
    // Strip known virtual SPA leaf routes if loaded directly
    const cleaned = pathname.replace(/\/(terms|terms-of-service|privacy|privacy-policy)\/?$/i, '/');
    if (cleaned.endsWith('/')) return cleaned;
    const lastSlash = cleaned.lastIndexOf('/');
    return lastSlash >= 0 ? cleaned.slice(0, lastSlash + 1) : '/';
  }
  return '/';
})();

/**
 * Resolves a static asset in `public/` relative to the app's base directory,
 * working both at root (`/`) and on GitHub Pages subpaths (`/repo-name/`).
 */
export function assetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  return `${INITIAL_BASE_DIR}${clean}`;
}

/**
 * Returns the app's base directory path (always starts and ends with `/`).
 */
export function getAppBaseDir(): string {
  return INITIAL_BASE_DIR;
}

/**
 * Safely parses a JSON response, returning `null` if a static host (like GitHub Pages)
 * responded with an HTML 404 page instead of JSON.
 */
export async function parseJsonResponse<T = Record<string, unknown>>(res: Response): Promise<T | null> {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json') && !ct.includes('+json')) {
    return null;
  }
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const STATIC_BACKEND_NOTICE =
  'This site is running in static browser mode (no backend server). Timeline editing, chroma key, color grading, keyframes, audio mixing, and MP4/WebM export all run 100% locally in your browser. Run the optional local server (npm run dev) to enable server-proxied AI features.';
