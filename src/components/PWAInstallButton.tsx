import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FolderCode,
  KeyRound,
  Laptop,
  MonitorDown,
  RefreshCw,
  RotateCw,
  Save,
  Share,
  WifiOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { assetUrl, parseJsonResponse } from '../utils/runtime';

type DesktopTab = 'desktop' | 'accounts' | 'updates';

interface LocalConfigResponse {
  isLocalServer: boolean;
  version?: string;
  buildTime?: string;
  origin?: string;
  appDir?: string;
  dataDir?: string;
  hasLocalSource?: boolean;
  updateOrigin?: string;
  googleClientId?: string;
  googleConfigured?: boolean;
  geminiConfigured?: boolean;
  youtubeCallbackUrl?: string;
}

declare global {
  interface Window {
    chmrDesktop?: {
      platform?: string;
      isElectron?: boolean;
      isLocalDesktop?: boolean;
      relaunch?: () => Promise<void>;
    };
  }
}

export function PWAInstallButton({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { isInstallable, isInstalled, isIOS, isWindows, isInIframe, install } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState<DesktopTab>('desktop');
  const [localConfig, setLocalConfig] = useState<LocalConfigResponse | null>(null);
  const [hasBackendApi, setHasBackendApi] = useState<boolean>(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Local accounts form fields
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [savingKeys, setSavingKeys] = useState(false);
  const [keysStatus, setKeysStatus] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Updater state
  const [updateSourceUrl, setUpdateSourceUrl] = useState('');
  const [updatingApp, setUpdatingApp] = useState(false);
  const [updateResult, setUpdateResult] = useState<{
    type: 'ok' | 'err';
    text: string;
    requiresRestart?: boolean;
  } | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/local/config');
      if (!res.ok) {
        setHasBackendApi(false);
        return;
      }
      const data = await parseJsonResponse<LocalConfigResponse>(res);
      if (!data) {
        setHasBackendApi(false);
        return;
      }
      setHasBackendApi(true);
      setLocalConfig(data);
      if (data.googleClientId) setGoogleClientId(data.googleClientId);
      if (data.updateOrigin) setUpdateSourceUrl(data.updateOrigin);
    } catch {
      setHasBackendApi(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const modalRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const backdropPressedRef = useRef(false);

  useEffect(() => {
    if (!showModal) return;
    fetchConfig();
    dragOffsetRef.current = { x: 0, y: 0 };
    if (modalRef.current) {
      modalRef.current.style.transform = '';
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal, fetchConfig]);

  const handleHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const modalEl = modalRef.current;
    if (!modalEl) return;

    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const originX = dragOffsetRef.current.x;
    const originY = dragOffsetRef.current.y;
    const rect = modalEl.getBoundingClientRect();
    const maxOffsetX = Math.max(0, (window.innerWidth - rect.width) / 2 - 12);
    const maxOffsetY = Math.max(0, (window.innerHeight - rect.height) / 2 - 12);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextX = Math.max(-maxOffsetX, Math.min(maxOffsetX, originX + (moveEvent.clientX - startX)));
      const nextY = Math.max(-maxOffsetY, Math.min(maxOffsetY, originY + (moveEvent.clientY - startY)));
      dragOffsetRef.current = { x: nextX, y: nextY };
      modalEl.style.transform = `translate3d(${nextX}px, ${nextY}px, 0)`;
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleHeaderDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragOffsetRef.current = { x: 0, y: 0 };
    if (modalRef.current) {
      modalRef.current.style.transform = '';
    }
  };

  const isElectron =
    typeof window !== 'undefined' && Boolean(window.chmrDesktop?.isElectron || window.chmrDesktop?.isLocalDesktop);
  const isLocalServer = Boolean(localConfig?.isLocalServer);
  const standaloneUrl = typeof window !== 'undefined' ? window.location.href : './';
  const youtubeCallbackUrl = localConfig?.youtubeCallbackUrl || 'http://localhost:3000/auth/youtube/callback';

  const handleCopy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(id);
      setTimeout(() => setCopiedField((prev) => (prev === id ? null : prev)), 2000);
    } catch {
      // Fallback ignored if clipboard restricted
    }
  };

  const handleBrowserShortcutInstall = async () => {
    if (!isInstallable) return;
    const accepted = await install();
    if (accepted) {
      setShowModal(false);
    }
  };

  const handleSaveLocalKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingKeys(true);
    setKeysStatus(null);
    try {
      const res = await fetch('/api/local/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googleClientId,
          googleClientSecret,
          geminiApiKey,
          updateOrigin: updateSourceUrl,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Failed to save local keys.');
      }
      setGoogleClientSecret('');
      setGeminiApiKey('');
      await fetchConfig();
      setKeysStatus({
        type: 'ok',
        text: 'Saved directly to your PC in chmr-local-config.json. Re-open Export Media or Metrics to sign in.',
      });
    } catch (err) {
      setKeysStatus({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save local configuration.',
      });
    } finally {
      setSavingKeys(false);
    }
  };

  const handleApplyUpdate = async () => {
    setUpdatingApp(true);
    setUpdateResult(null);
    try {
      const res = await fetch('/api/desktop/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl: updateSourceUrl }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        updatedCount?: number;
        requiresRestart?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Update failed.');
      }
      setUpdateResult({
        type: 'ok',
        text: `Updated ${json.updatedCount ?? 0} desktop files cleanly. Your saved accounts and keys were preserved.`,
        requiresRestart: json.requiresRestart,
      });
    } catch (err) {
      setUpdateResult({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to download update.',
      });
    } finally {
      setUpdatingApp(false);
    }
  };

  const handleLegalClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (onNavigate) {
      e.preventDefault();
      setShowModal(false);
      onNavigate(path);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setActiveTab(isLocalServer || isElectron ? 'accounts' : 'desktop');
          setShowModal(true);
        }}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#D4D4DC] hover:text-white bg-[#232329] hover:bg-[#2C2C34] border border-[#34343D] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#3B82F6]"
        title={
          !hasBackendApi
            ? 'Install CHMR as an offline browser app or run locally from GitHub'
            : isLocalServer || isElectron
              ? 'Configure local YouTube OAuth keys or update your CHMR Desktop app'
              : 'Download CHMR Windows Desktop app or full offline source project'
        }
      >
        <MonitorDown className="w-3.5 h-3.5 text-[#60A5FA]" />
        <span>
          {!hasBackendApi
            ? isInstalled
              ? 'Offline App'
              : 'Install App'
            : isLocalServer || isElectron || isInstalled
              ? 'Desktop & Updates'
              : 'Desktop App'}
        </span>
      </button>

      {showModal &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="windows-install-title"
            onMouseDown={(e) => {
              backdropPressedRef.current = e.target === e.currentTarget;
            }}
            onClick={(e) => {
              if (backdropPressedRef.current && e.target === e.currentTarget) {
                setShowModal(false);
              }
              backdropPressedRef.current = false;
            }}
          >
            <div
              ref={modalRef}
              className="w-full max-w-2xl rounded bg-[#18181D] border border-[#2E2E37] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              {/* Header (draggable) */}
              <div
                onMouseDown={handleHeaderMouseDown}
                onDoubleClick={handleHeaderDoubleClick}
                title="Drag to move window (double-click to re-center)"
                className="flex items-center justify-between px-5 py-3.5 border-b border-[#27272E] bg-[#141418] shrink-0 cursor-grab active:cursor-grabbing select-none"
              >
                <div className="flex items-center gap-2.5">
                  <img src={assetUrl('chmr-logo.png')} alt="CHMR" className="w-5 h-5 rounded-sm object-cover" />
                  <div>
                    <h2 id="windows-install-title" className="text-sm font-semibold text-[#F4F4F7] leading-tight">
                      {hasBackendApi ? 'CHMR Desktop Workstation & Local Sync' : 'CHMR Standalone Browser App'}
                    </h2>
                    <p className="text-[11px] text-[#8E8E9B]">
                      {hasBackendApi
                        ? 'Run 100% locally on your PC — no Chrome tabs, no Google Cloud publishing or billing required'
                        : 'Running 100% client-side with zero cloud backend — edit, chroma key, grade, and export locally'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="p-1 text-[#8E8E9B] hover:text-white rounded cursor-pointer"
                  aria-label="Close desktop dialog"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

            {/* Segmented Tab Bar */}
            <div className="flex items-center gap-1 px-5 pt-2.5 bg-[#141418] border-b border-[#27272E] shrink-0 overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveTab('desktop')}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'desktop'
                    ? 'border-[#3B82F6] text-white'
                    : 'border-transparent text-[#8E8E9B] hover:text-[#D4D4DC]'
                }`}
              >
                <Laptop className="w-3.5 h-3.5" />
                <span>Desktop App</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('accounts')}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'accounts'
                    ? 'border-[#3B82F6] text-white'
                    : 'border-transparent text-[#8E8E9B] hover:text-[#D4D4DC]'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Local Accounts</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('updates')}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'updates'
                    ? 'border-[#3B82F6] text-white'
                    : 'border-transparent text-[#8E8E9B] hover:text-[#D4D4DC]'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Updates</span>
              </button>
            </div>

            {/* Tab Content */}
            <div className="p-5 space-y-4 overflow-y-auto">
              {activeTab === 'desktop' && (
                <>
                  {!hasBackendApi ? (
                    <>
                      <div className="p-4 rounded border border-[#3B82F6]/40 bg-[#121216] space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-xs font-semibold text-[#F4F4F7]">
                              1. Install as Offline Desktop / Mobile App (Zero Cloud Server)
                            </h3>
                            <p className="text-[11px] text-[#9A9AA6] mt-1 leading-relaxed">
                              This static build runs completely inside your browser — video playback, multi-track editing,
                              chroma key, color grading, audio mixing, and MP4/WebM export all process directly on your
                              device with no server required.
                            </p>
                          </div>
                          <span className="px-2 py-0.5 text-[10px] font-mono tabular-nums bg-[#064E3B]/50 text-[#6EE7B7] border border-[#059669]/50 rounded-sm shrink-0">
                            Static Mode
                          </span>
                        </div>

                        {isInstallable ? (
                          <button
                            type="button"
                            onClick={handleBrowserShortcutInstall}
                            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded bg-[#2563EB] hover:bg-[#3B82F6] text-xs font-semibold text-white transition-colors cursor-pointer"
                          >
                            <MonitorDown className="w-3.5 h-3.5" />
                            Install CHMR App on {isWindows ? 'Windows' : 'This Device'}
                          </button>
                        ) : isIOS ? (
                          <div className="text-[11px] text-[#B8B8C4] flex items-center gap-2 bg-[#18181D] border border-[#27272E] rounded p-2.5">
                            <Share className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
                            <span>Tap Share in Safari and choose &quot;Add to Home Screen&quot; to install offline.</span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-[#B8B8C4] bg-[#18181D] border border-[#27272E] rounded p-2.5 leading-relaxed">
                            {isInstalled
                              ? 'CHMR is installed as an offline-capable app on this device.'
                              : 'Use your browser address bar Install icon (or Browser Menu → Install CHMR / Save and Share → Install page as app) to pin CHMR to your desktop.'}
                          </div>
                        )}
                      </div>

                      <div className="p-4 rounded border border-[#2E2E37] bg-[#121216] space-y-2.5">
                        <h3 className="text-xs font-semibold text-[#F4F4F7] flex items-center gap-1.5">
                          <FolderCode className="w-3.5 h-3.5 text-[#34D399]" />
                          <span>2. Download Native Desktop App from GitHub</span>
                        </h3>
                        <p className="text-[11px] text-[#9A9AA6] leading-relaxed">
                          Download <span className="font-mono text-[#D4D4DC]">CHMR-Setup.exe</span>,{' '}
                          <span className="font-mono text-[#D4D4DC]">CHMR-Portable.exe</span>,{' '}
                          <span className="font-mono text-[#D4D4DC]">.dmg</span>, or{' '}
                          <span className="font-mono text-[#D4D4DC]">.AppImage</span> from your GitHub{' '}
                          <span className="text-[#E4E4EC] font-medium">Releases</span> tab, or clone the repo and run{' '}
                          <span className="font-mono text-[#D4D4DC]">Launch-CHMR.bat</span> /{' '}
                          <span className="font-mono text-[#D4D4DC]">npm run desktop</span>.
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Option 1: Ready-to-Run Windows Desktop App */}
                      <div className="p-4 rounded border border-[#3B82F6]/40 bg-[#121216] space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-xs font-semibold text-[#F4F4F7]">
                              1. Standalone Windows Desktop App (Instant Shortcut &amp; .exe Builder)
                            </h3>
                            <p className="text-[11px] text-[#9A9AA6] mt-1 leading-relaxed">
                              Runs CHMR natively on your Windows desktop with its own local server on{' '}
                              <span className="font-mono text-[#D4D4DC]">localhost:3000</span>. Never opens Chrome and never
                              touches Google Cloud publishing servers.
                            </p>
                          </div>
                          <span className="px-2 py-0.5 text-[10px] font-mono tabular-nums bg-[#1E293B] text-[#93C5FD] border border-[#3B82F6]/40 rounded-sm shrink-0">
                            v{localConfig?.version || '1.1.0'}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-[#B8B8C4] bg-[#18181D] border border-[#27272E] rounded p-2.5">
                          <div>
                            <span className="text-[#60A5FA] font-semibold">Step 1:</span> Extract ZIP anywhere on your PC
                            (e.g. <span className="font-mono text-[#E4E4EC]">C:\CHMR</span>).
                          </div>
                          <div>
                            <span className="text-[#60A5FA] font-semibold">Step 2:</span> Run{' '}
                            <span className="font-mono text-[#E4E4EC]">Create-Desktop-Shortcut.bat</span> to put CHMR on
                            your Desktop.
                          </div>
                          <div>
                            <span className="text-[#60A5FA] font-semibold">Step 3:</span> Launch CHMR (or run{' '}
                            <span className="font-mono text-[#E4E4EC]">Build-CHMR-Exe.bat</span> for Setup.exe).
                          </div>
                        </div>

                        <a
                          href="/api/desktop/windows-bundle.zip"
                          download="CHMR-Windows-Desktop.zip"
                          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded bg-[#2563EB] hover:bg-[#3B82F6] text-xs font-semibold text-white transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download CHMR-Windows-Desktop.zip
                        </a>
                      </div>

                      {/* Option 2: Full Editable Source Project (100% Offline Updates) */}
                      <div className="p-4 rounded border border-[#2E2E37] bg-[#121216] space-y-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-xs font-semibold text-[#F4F4F7] flex items-center gap-1.5">
                              <FolderCode className="w-3.5 h-3.5 text-[#34D399]" />
                              <span>2. Full Local Source Project (Edit &amp; Rebuild Offline Anytime)</span>
                            </h3>
                            <p className="text-[11px] text-[#9A9AA6] mt-1 leading-relaxed">
                              Includes all React/TypeScript files (<span className="font-mono text-[#D4D4DC]">src/</span>),
                              Electron wrapper, and <span className="font-mono text-[#D4D4DC]">Rebuild-Local-App.bat</span>{' '}
                              so you can customize and update CHMR straight on your PC without AI Studio or Google Cloud.
                            </p>
                          </div>
                        </div>

                        <a
                          href="/api/desktop/source-bundle.zip"
                          download="CHMR-Full-Source-Desktop.zip"
                          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded bg-[#1E1E25] hover:bg-[#272730] border border-[#34343D] text-xs font-semibold text-[#F4F4F7] transition-colors"
                        >
                          <Download className="w-3.5 h-3.5 text-[#34D399]" />
                          Download CHMR-Full-Source-Desktop.zip
                        </a>
                      </div>

                      {/* Option 3: Browser Fallback Shortcut */}
                      {!isElectron && !isLocalServer && (isInstallable || isIOS || isInIframe) && (
                        <div className="p-3.5 rounded border border-[#27272E] bg-[#121216] space-y-2">
                          <h3 className="text-xs font-semibold text-[#F4F4F7]">
                            3. Quick Browser Shortcut (Optional)
                          </h3>
                          {isInstallable ? (
                            <button
                              type="button"
                              onClick={handleBrowserShortcutInstall}
                              className="w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded bg-[#232329] hover:bg-[#2E2E36] border border-[#383844] text-xs font-medium text-[#F4F4F7] transition-colors cursor-pointer"
                            >
                              <MonitorDown className="w-3.5 h-3.5 text-[#60A5FA]" />
                              Install Shortcut on {isWindows ? 'Windows' : 'Desktop'}
                            </button>
                          ) : isIOS ? (
                            <div className="text-[11px] text-[#B8B8C4] flex items-center gap-2">
                              <Share className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
                              <span>Tap Share in Safari and choose &quot;Add to Home Screen&quot;.</span>
                            </div>
                          ) : (
                            <a
                              href={standaloneUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded bg-[#232329] hover:bg-[#2E2E36] border border-[#383844] text-xs font-medium text-[#F4F4F7] transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-[#60A5FA]" />
                              Open Standalone Window
                            </a>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {activeTab === 'accounts' && (
                <div className="space-y-4">
                  {/* Local Redirect URIs Reference */}
                  <div className="p-3.5 rounded border border-[#2E2E37] bg-[#121216] space-y-2.5">
                    <div>
                      <h3 className="text-xs font-semibold text-[#F4F4F7]">
                        Local Desktop OAuth Callback URLs (No Cloud Hosting Required)
                      </h3>
                      <p className="text-[11px] text-[#9A9AA6] mt-0.5 leading-relaxed">
                        Register this <span className="font-mono text-[#D4D4DC]">localhost:3000</span> URL in your own
                        free Google Cloud OAuth Client so each user can sign in to YouTube directly for their session
                        without any cloud hosting required.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#18181D] border border-[#27272E]">
                        <div className="min-w-0">
                          <span className="text-[10px] uppercase tracking-wider text-[#8E8E9B] block">
                            YouTube / Google Authorized Redirect URI
                          </span>
                          <span className="text-[11px] font-mono text-[#E4E4EC] truncate block">
                            {youtubeCallbackUrl}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy('yt-cb', youtubeCallbackUrl)}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-[#232329] hover:bg-[#2E2E36] text-[#D4D4DC] border border-[#34343D] rounded shrink-0 cursor-pointer"
                        >
                          {copiedField === 'yt-cb' ? (
                            <Check className="w-3 h-3 text-[#34D399]" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedField === 'yt-cb' ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {isLocalServer ? (
                    <form onSubmit={handleSaveLocalKeys} className="p-4 rounded border border-[#2E2E37] bg-[#121216] space-y-3.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-[#F4F4F7]">
                          Saved Desktop Credentials (Stored Locally on This PC)
                        </h3>
                        {localConfig?.dataDir && (
                          <span className="text-[10px] font-mono text-[#8E8E9B] truncate max-w-[230px]" title={localConfig.dataDir}>
                            {localConfig.dataDir}
                          </span>
                        )}
                      </div>

                      {/* YouTube / Google Credentials */}
                      <div className="space-y-2 pt-1 border-t border-[#23232A]">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-[#E4E4EC]">Google / YouTube OAuth</span>
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-mono rounded-sm border ${
                              localConfig?.googleConfigured
                                ? 'bg-[#064E3B]/50 text-[#6EE7B7] border-[#059669]/50'
                                : 'bg-[#232329] text-[#9A9AA6] border-[#34343D]'
                            }`}
                          >
                            {localConfig?.googleConfigured ? 'CONFIGURED' : 'NOT SET'}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={googleClientId}
                            onChange={(e) => setGoogleClientId(e.target.value)}
                            placeholder="Google Client ID"
                            className="w-full px-2.5 py-1.5 text-xs bg-[#18181D] border border-[#2E2E37] rounded text-[#F4F4F7] placeholder-[#6C6C78] focus:outline-none focus:border-[#3B82F6]"
                          />
                          <input
                            type="password"
                            value={googleClientSecret}
                            onChange={(e) => setGoogleClientSecret(e.target.value)}
                            placeholder={localConfig?.googleConfigured ? '•••••••• (leave blank to keep)' : 'Google Client Secret'}
                            className="w-full px-2.5 py-1.5 text-xs bg-[#18181D] border border-[#2E2E37] rounded text-[#F4F4F7] placeholder-[#6C6C78] focus:outline-none focus:border-[#3B82F6]"
                          />
                        </div>
                      </div>

                      {/* Optional Gemini Key */}
                      <div className="space-y-2 pt-2 border-t border-[#23232A]">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-[#E4E4EC]">Optional Gemini API Key (AI Tools)</span>
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-mono rounded-sm border ${
                              localConfig?.geminiConfigured
                                ? 'bg-[#064E3B]/50 text-[#6EE7B7] border-[#059669]/50'
                                : 'bg-[#232329] text-[#9A9AA6] border-[#34343D]'
                            }`}
                          >
                            {localConfig?.geminiConfigured ? 'CONFIGURED' : 'OPTIONAL'}
                          </span>
                        </div>
                        <input
                          type="password"
                          value={geminiApiKey}
                          onChange={(e) => setGeminiApiKey(e.target.value)}
                          placeholder={localConfig?.geminiConfigured ? '•••••••• (leave blank to keep)' : 'Gemini API Key (optional for timeline editing)'}
                          className="w-full px-2.5 py-1.5 text-xs bg-[#18181D] border border-[#2E2E37] rounded text-[#F4F4F7] placeholder-[#6C6C78] focus:outline-none focus:border-[#3B82F6]"
                        />
                      </div>

                      {keysStatus && (
                        <div
                          className={`p-2.5 rounded text-[11px] border ${
                            keysStatus.type === 'ok'
                              ? 'bg-[#064E3B]/35 border-[#059669]/50 text-[#A7F3D0]'
                              : 'bg-[#7F1D1D]/35 border-[#DC2626]/50 text-[#FCA5A5]'
                          }`}
                        >
                          {keysStatus.text}
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={savingKeys}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded bg-[#2563EB] hover:bg-[#3B82F6] disabled:opacity-50 text-xs font-semibold text-white transition-colors cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{savingKeys ? 'Saving...' : 'Save Local Keys on This PC'}</span>
                      </button>
                    </form>
                  ) : (
                    <div className="p-4 rounded border border-[#2E2E37] bg-[#121216] space-y-2.5">
                      <h3 className="text-xs font-semibold text-[#F4F4F7]">
                        How Local Desktop Logins Work
                      </h3>
                      <p className="text-[11px] text-[#9A9AA6] leading-relaxed">
                        You are currently viewing the preview server. Download and launch{' '}
                        <span className="text-[#E4E4EC] font-medium">CHMR-Windows-Desktop.zip</span> from the{' '}
                        <span className="text-[#E4E4EC] font-medium">Desktop App</span> tab, then reopen{' '}
                        <span className="text-[#E4E4EC] font-medium">Desktop &amp; Updates → Local Accounts</span> inside
                        the native app to enter your YouTube OAuth Client ID privately on your PC.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab('desktop')}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-[#2563EB] hover:bg-[#3B82F6] rounded cursor-pointer"
                      >
                        Go to Desktop App Download
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'updates' && (
                <div className="space-y-4">
                  {/* Runtime Status */}
                  <div className="p-3.5 rounded border border-[#2E2E37] bg-[#121216] grid grid-cols-2 gap-3 text-[11px]">
                    <div>
                      <span className="text-[#8E8E9B] block">Installed Build</span>
                      <span className="font-mono tabular-nums text-[#F4F4F7] font-semibold">
                        CHMR v{localConfig?.version || '1.1.0'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8E8E9B] block">Environment</span>
                      <span className="font-medium text-[#60A5FA]">
                        {isLocalServer ? 'Local Desktop Server (127.0.0.1)' : 'Workspace Preview'}
                      </span>
                    </div>
                    {isLocalServer && localConfig?.appDir && (
                      <div className="col-span-2">
                        <span className="text-[#8E8E9B] block">Desktop App Folder</span>
                        <span className="font-mono text-[#D4D4DC] break-all">{localConfig.appDir}</span>
                      </div>
                    )}
                  </div>

                  {isLocalServer ? (
                    <div className="p-4 rounded border border-[#3B82F6]/40 bg-[#121216] space-y-3">
                      <div>
                        <h3 className="text-xs font-semibold text-[#F4F4F7]">
                          1-Click Update (Without Google Cloud Publishing Servers)
                        </h3>
                        <p className="text-[11px] text-[#9A9AA6] mt-0.5 leading-relaxed">
                          Pulls the latest web bundle &amp; desktop runtime straight into your local CHMR folder while
                          keeping your saved <span className="font-mono text-[#D4D4DC]">.env</span> and desktop
                          account credentials intact.
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[11px] text-[#8E8E9B] block">
                          Update Source URL (workspace origin or direct .zip URL)
                        </label>
                        <input
                          type="url"
                          value={updateSourceUrl}
                          onChange={(e) => setUpdateSourceUrl(e.target.value)}
                          placeholder="https://your-chmr-workspace-url"
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#18181D] border border-[#2E2E37] rounded text-[#F4F4F7] placeholder-[#6C6C78] focus:outline-none focus:border-[#3B82F6]"
                        />
                      </div>

                      {updateResult && (
                        <div
                          className={`p-2.5 rounded text-[11px] border ${
                            updateResult.type === 'ok'
                              ? 'bg-[#064E3B]/35 border-[#059669]/50 text-[#A7F3D0]'
                              : 'bg-[#7F1D1D]/35 border-[#DC2626]/50 text-[#FCA5A5]'
                          }`}
                        >
                          {updateResult.text}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleApplyUpdate}
                          disabled={updatingApp || !updateSourceUrl.trim()}
                          className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded bg-[#2563EB] hover:bg-[#3B82F6] disabled:opacity-50 text-xs font-semibold text-white transition-colors cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${updatingApp ? 'animate-spin' : ''}`} />
                          <span>{updatingApp ? 'Downloading & Applying...' : 'Check & Apply Update'}</span>
                        </button>

                        {window.chmrDesktop?.relaunch && (
                          <button
                            type="button"
                            onClick={() => window.chmrDesktop?.relaunch?.()}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded bg-[#1E1E25] hover:bg-[#272730] border border-[#34343D] text-xs font-semibold text-[#F4F4F7] transition-colors cursor-pointer"
                          >
                            <RotateCw className="w-3.5 h-3.5 text-[#34D399]" />
                            <span>Relaunch CHMR</span>
                          </button>
                        )}
                      </div>

                      <p className="text-[11px] text-[#8E8E9B] pt-1 border-t border-[#23232A]">
                        Offline scripts in your CHMR folder:{' '}
                        <span className="font-mono text-[#D4D4DC]">Update-CHMR-Desktop.bat</span> (pulls latest bundle)
                        {localConfig?.hasLocalSource && (
                          <>
                            {' '}
                            and <span className="font-mono text-[#D4D4DC]">Rebuild-Local-App.bat</span> (recompiles local
                            changes in <span className="font-mono text-[#D4D4DC]">src/</span>).
                          </>
                        )}
                      </p>
                    </div>
                  ) : (
                    <div className="p-4 rounded border border-[#2E2E37] bg-[#121216] space-y-3">
                      <div>
                        <h3 className="text-xs font-semibold text-[#F4F4F7]">
                          How to Update Your Desktop CHMR Without Google Cloud Billing
                        </h3>
                        <p className="text-[11px] text-[#9A9AA6] mt-1 leading-relaxed">
                          You do not need AI Studio&apos;s Publish/Billing servers. Keep this workspace URL to update
                          your desktop install anytime via <span className="text-[#E4E4EC]">Desktop &amp; Updates → Updates</span>{' '}
                          or <span className="font-mono text-[#D4D4DC]">Update-CHMR-Desktop.bat</span>, or download{' '}
                          <span className="font-mono text-[#D4D4DC]">CHMR-Full-Source-Desktop.zip</span> to edit and
                          rebuild completely offline on your PC.
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded bg-[#18181D] border border-[#27272E]">
                        <div className="min-w-0">
                          <span className="text-[10px] uppercase tracking-wider text-[#8E8E9B] block">
                            Your Update Source URL
                          </span>
                          <span className="text-[11px] font-mono text-[#E4E4EC] truncate block">{standaloneUrl}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy('upd-url', standaloneUrl)}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-[#232329] hover:bg-[#2E2E36] text-[#D4D4DC] border border-[#34343D] rounded shrink-0 cursor-pointer"
                        >
                          {copiedField === 'upd-url' ? (
                            <Check className="w-3 h-3 text-[#34D399]" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedField === 'upd-url' ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Footer Links */}
              <div className="pt-1 flex items-center justify-between text-[11px] text-[#8E8E9B]">
                <span>CHMR Video Workstation</span>
                <div className="flex items-center gap-3">
                  <a
                    href="#/terms"
                    onClick={(e) => handleLegalClick(e, '/terms')}
                    className="hover:text-white underline-offset-2 hover:underline"
                  >
                    Terms of Service
                  </a>
                  <a
                    href="#/privacy"
                    onClick={(e) => handleLegalClick(e, '/privacy')}
                    className="hover:text-white underline-offset-2 hover:underline"
                  >
                    Privacy Policy
                  </a>
                </div>
              </div>
            </div>
          </div>
          </div>,
          document.body
        )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded bg-[#92400E] border border-[#D97706] px-3 py-1.5 text-xs font-medium text-[#FEF3C7] shadow-lg">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Offline Mode — Timeline editing &amp; export active; AI tools require connection.</span>
    </div>
  );
}
