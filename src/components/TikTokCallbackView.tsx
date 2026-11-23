import { useEffect, useState } from 'react';
import { assetUrl } from '../utils/runtime';
import { broadcastTikTokAuthError, broadcastTikTokAuthSuccess, exchangeTikTokCode } from '../utils/tiktokAuth';

interface TikTokCallbackViewProps {
  onFallbackHome: () => void;
}

export function TikTokCallbackView({ onFallbackHome }: TikTokCallbackViewProps) {
  const [status, setStatus] = useState<'exchanging' | 'done' | 'error'>('exchanging');
  const [message, setMessage] = useState('Saving your TikTok account to CHMR...');

  useEffect(() => {
    let active = true;

    // Trigger SW update check in background so future OAuth callbacks bypass precache directly
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.update().catch(() => {})))
        .catch(() => {});
    }

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') || '';
    const state = params.get('state') || '';
    const errParam = params.get('error') || '';
    const errDesc = params.get('error_description') || '';

    if (errParam || !code) {
      const msg =
        errParam === 'scope_not_authorized' || errDesc.toLowerCase().includes('scope')
          ? `TikTok rejected stats scopes (${errDesc || errParam}). Enable Login Kit & Display API (user.info.stats, video.list) in TikTok Developer Portal -> Sandbox/App Products, then retry.`
          : errDesc || errParam
          ? `TikTok authorization canceled: ${errDesc || errParam}`
          : 'Missing TikTok authorization code.';
      broadcastTikTokAuthError(msg);
      if (active) {
        setStatus('error');
        setMessage(msg);
      }
      return;
    }

    exchangeTikTokCode(code, state)
      .then((res) => {
        if (!active) return;
        if (!res.ok) {
          const errMsg = res.error || 'Unable to complete TikTok sign-in.';
          broadcastTikTokAuthError(errMsg);
          setStatus('error');
          setMessage(errMsg);
          return;
        }
        setStatus('done');
        setMessage(
          res.user?.displayName
            ? `Saved ${res.user.displayName} in CHMR. Returning to editor...`
            : 'TikTok account saved in CHMR. Returning to editor...'
        );
        broadcastTikTokAuthSuccess(res.sessionToken);
        setTimeout(() => {
          if (window.opener && !window.opener.closed) {
            window.close();
          } else {
            onFallbackHome();
          }
        }, 250);
      })
      .catch((err) => {
        if (!active) return;
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'TikTok sign-in failed.');
      });

    return () => {
      active = false;
    };
  }, [onFallbackHome]);

  return (
    <div className="min-h-screen w-screen bg-[#121214] text-[#EAEAF0] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-[#2E2E37] bg-[#18181D] p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <img src={assetUrl('chmr-logo.png')} alt="CHMR" className="w-6 h-6 rounded object-cover" />
          <h1 className="text-sm font-semibold text-[#F4F4F7]">CHMR · TikTok Account Link</h1>
        </div>
        <p className={`text-xs leading-relaxed ${status === 'error' ? 'text-[#FCA5A5]' : 'text-[#C2C2CC]'}`}>
          {message}
        </p>
        <div className="flex items-center gap-2 pt-1">
          {status === 'done' && (
            <button
              type="button"
              onClick={() => {
                if (window.opener && !window.opener.closed) {
                  window.close();
                } else {
                  onFallbackHome();
                }
              }}
              className="px-3.5 py-1.5 rounded bg-[#2563EB] hover:bg-[#3B82F6] text-xs font-semibold text-white cursor-pointer"
            >
              Close Window
            </button>
          )}
          {status === 'error' && (
            <button
              type="button"
              onClick={() => {
                if (window.opener && !window.opener.closed) {
                  window.close();
                } else {
                  onFallbackHome();
                }
              }}
              className="px-3.5 py-1.5 rounded bg-[#222229] hover:bg-[#2C2C35] text-xs font-medium text-[#E4E4EC] cursor-pointer"
            >
              Return to CHMR
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
