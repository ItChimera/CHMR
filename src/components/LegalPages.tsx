import { ArrowLeft, Check, Copy, ExternalLink, FileText, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { assetUrl, getAppBaseDir } from '../utils/runtime';

export type LegalDocType = 'terms' | 'privacy';

interface LegalPagesProps {
  doc: LegalDocType;
  onNavigate: (path: string) => void;
}

const EFFECTIVE_DATE = 'November 16, 2026';

export function LegalPages({ doc, onNavigate }: LegalPagesProps) {
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const baseDir = getAppBaseDir();
  const useHash = baseDir !== '/';
  const termsUrl = useHash ? `${origin}${baseDir}#/terms` : `${origin}/terms`;
  const privacyUrl = useHash ? `${origin}${baseDir}#/privacy` : `${origin}/privacy`;
  const canonicalUrl = doc === 'terms' ? termsUrl : privacyUrl;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(canonicalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard restrictions
    }
  };

  return (
    <div className="h-screen w-screen bg-[#121214] text-[#EAEAF0] flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-12 px-5 bg-[#16161A] border-b border-[#27272E] flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <a
            href="#/"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/');
            }}
            className="flex items-center gap-2.5 group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#3B82F6] rounded"
          >
            <img
              src={assetUrl('chmr-logo.png')}
              alt="CHMR logo"
              className="w-7 h-7 rounded-md object-cover shadow-sm"
            />
            <span className="text-[15px] font-bold tracking-tight text-[#F4F4F7] group-hover:text-white">
              CHMR
            </span>
          </a>
          <span className="text-[#3A3A46] text-xs">/</span>
          <span className="text-xs font-medium text-[#A1A1AF]">
            {doc === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
          </span>
        </div>

        <nav className="flex items-center gap-2" aria-label="Legal navigation">
          <a
            href="#/terms"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/terms');
            }}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              doc === 'terms'
                ? 'bg-[#2563EB]/20 text-[#93C5FD] border border-[#3B82F6]/40'
                : 'text-[#A1A1AF] hover:text-white hover:bg-[#222229]'
            }`}
          >
            Terms of Service
          </a>
          <a
            href="#/privacy"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/privacy');
            }}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              doc === 'privacy'
                ? 'bg-[#2563EB]/20 text-[#93C5FD] border border-[#3B82F6]/40'
                : 'text-[#A1A1AF] hover:text-white hover:bg-[#222229]'
            }`}
          >
            Privacy Policy
          </a>
          <a
            href="#/"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/');
            }}
            className="ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#232329] hover:bg-[#2E2E36] border border-[#34343D] text-xs font-medium text-[#F4F4F7] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Studio
          </a>
        </nav>
      </header>

      {/* Main Scrollable Document */}
      <main className="flex-1 overflow-y-auto px-5 py-8">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Brand & Live URL Card */}
          <div className="p-5 rounded-lg bg-[#16161B] border border-[#282832] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <img
                src={assetUrl('chmr-logo.png')}
                alt="CHMR"
                className="w-12 h-12 rounded-lg object-cover border border-[#2F2F3B] shrink-0"
              />
              <div>
                <div className="flex items-center gap-2">
                  {doc === 'terms' ? (
                    <FileText className="w-4 h-4 text-[#3B82F6]" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 text-[#3B82F6]" />
                  )}
                  <h1 className="text-lg font-bold text-[#F4F4F7]">
                    CHMR {doc === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
                  </h1>
                </div>
                <p className="text-xs text-[#8E8E9B] mt-0.5">
                  Effective Date: {EFFECTIVE_DATE} · CHMR Non-Linear Video Editor
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-[#111115] border border-[#2A2A34] rounded px-3 py-1.5 max-w-full">
              <span className="text-[11px] font-mono-tabular text-[#93C5FD] truncate max-w-[240px] sm:max-w-[260px]">
                {canonicalUrl}
              </span>
              <button
                type="button"
                onClick={handleCopyUrl}
                className="p-1 text-[#A1A1AF] hover:text-white rounded cursor-pointer shrink-0"
                title="Copy direct URL"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <a
                href={canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 text-[#A1A1AF] hover:text-white rounded shrink-0"
                title="Open direct URL in new tab"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Document Body */}
          {doc === 'terms' ? (
            <article className="p-6 sm:p-8 rounded-lg bg-[#16161B] border border-[#282832] space-y-6 text-sm leading-relaxed text-[#C9C9D4]">
              <section className="space-y-2">
                <h2 className="text-base font-semibold text-[#F4F4F7]">1. Acceptance of Terms</h2>
                <p>
                  By accessing or using <strong className="text-white">CHMR</strong> (the web workstation, Progressive Web App, or Windows desktop launcher), you agree to be bound by these Terms of Service and our{' '}
                  <a
                    href={privacyUrl}
                    onClick={(e) => {
                      e.preventDefault();
                      onNavigate('/privacy');
                    }}
                    className="text-[#60A5FA] hover:underline"
                  >
                    Privacy Policy
                  </a>
                  . If you do not agree to these terms, do not use CHMR.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-base font-semibold text-[#F4F4F7]">2. Description of the CHMR Service</h2>
                <p>
                  CHMR provides browser-based non-linear video editing, multi-track compositing, color grading, audio mixing, real-time timeline export (WebM, WAV, PNG, SRT, EDL, XML), optional AI editing tools (editing assistant, speech-to-text transcription, caption translation, voiceover narration, and semantic media search), and optional direct publishing integrations to YouTube and TikTok.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-base font-semibold text-[#F4F4F7]">3. Ownership of Content &amp; Media</h2>
                <p>
                  You retain all right, title, and ownership in and to every video, image, audio track, caption, project file, and exported master you import, edit, or create with CHMR. You represent and warrant that you hold all necessary licenses, copyrights, and permissions for any media you process or publish through the application.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-base font-semibold text-[#F4F4F7]">4. Third-Party Services &amp; Social Publishing</h2>
                <p>
                  When you choose to connect external accounts or publish exports directly, your use of those integrations is also governed by the respective third-party terms:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-[#B4B4C2]">
                  <li>
                    <strong className="text-[#E4E4EC]">YouTube &amp; Google OAuth:</strong> Direct YouTube uploads use Google OAuth 2.0 and the YouTube Data API. By connecting your Google account, you agree to be bound by the YouTube Terms of Service and Google Privacy Policy.
                  </li>
                  <li>
                    <strong className="text-[#E4E4EC]">TikTok Integration:</strong> Direct TikTok uploads use the TikTok Content Posting API via OAuth 2.0 and remain subject to TikTok&apos;s Terms of Service and Community Guidelines.
                  </li>
                </ul>
              </section>

              <section className="space-y-2">
                <h2 className="text-base font-semibold text-[#F4F4F7]">5. Acceptable Use</h2>
                <p>
                  You agree not to use CHMR to process, generate, or distribute unlawful, infringing, harmful, or abusive content, or to attempt unauthorized access to CHMR&apos;s backend endpoints, OAuth credentials, or rate-limited AI services.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-base font-semibold text-[#F4F4F7]">6. AI Features &amp; Output Review</h2>
                <p>
                  AI-assisted edits, transcriptions, translations, and synthesized voiceovers are provided as creative aids. You are solely responsible for reviewing accuracy, captions, rights clearance, and timeline changes before exporting or publishing final media.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-base font-semibold text-[#F4F4F7]">7. Disclaimers &amp; Limitation of Liability</h2>
                <p>
                  CHMR is provided on an &quot;as is&quot; and &quot;as available&quot; basis without warranties of uninterrupted availability or fitness for a particular purpose. Always keep local backups of your original source footage and exported masters. To the fullest extent permitted by law, CHMR and its operators shall not be liable for indirect, incidental, or consequential damages, including loss of project data or media.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-base font-semibold text-[#F4F4F7]">8. Updates &amp; Contact</h2>
                <p>
                  We may update these Terms of Service from time to time. The latest version is always published at{' '}
                  <a href={termsUrl} className="text-[#60A5FA] hover:underline font-mono-tabular text-xs">
                    {termsUrl}
                  </a>
                  . Questions regarding these terms may be directed to the CHMR administrator at{' '}
                  <span className="text-[#E4E4EC]">legal@chmr.app</span>.
                </p>
              </section>
            </article>
          ) : (
            <article className="p-6 sm:p-8 rounded-lg bg-[#16161B] border border-[#282832] space-y-6 text-sm leading-relaxed text-[#C9C9D4]">
              <section className="space-y-2">
                <h2 className="text-base font-semibold text-[#F4F4F7]">1. Local-First Media Processing</h2>
                <p>
                  <strong className="text-white">CHMR</strong> is designed with a local-first architecture. Video clips, images, and audio stems imported into your project bin are decoded, composited, color-graded, mixed, and rendered directly inside your browser using local Web Audio and Canvas APIs. Imported source media is not uploaded to CHMR servers for standard timeline editing or local WebM/WAV export.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-base font-semibold text-[#F4F4F7]">2. Information Processed When Using Optional Features</h2>
                <ul className="list-disc pl-5 space-y-1.5 text-[#B4B4C2]">
                  <li>
                    <strong className="text-[#E4E4EC]">AI Editing &amp; Transcription Tools:</strong> When you explicitly invoke the AI Editing Assistant, Speech-to-Text Transcription, Caption Translation, Voiceover TTS, or Media Intelligence Search, only the relevant prompt text, asset metadata, caption text, or selected audio sample is transmitted to our server-side Gemini API proxy to fulfill your request.
                  </li>
                  <li>
                    <strong className="text-[#E4E4EC]">YouTube Direct Publishing:</strong> Signing in with Google uses client-side Firebase Authentication / Google OAuth 2.0 (`youtube.upload` scope) solely to upload the video you choose to render, along with the title, description, hashtags, and privacy setting you enter.
                  </li>
                  <li>
                    <strong className="text-[#E4E4EC]">TikTok Direct Publishing:</strong> Connecting TikTok uses OAuth 2.0 (`user.info.basic`, `video.upload`, `video.publish`). Access tokens are stored in temporary server-side memory keyed to an HTTP-only session cookie (`chmr_tiktok_sid`) solely to display your connected display name and upload the rendered video you initiate.
                  </li>
                </ul>
              </section>

              <section className="space-y-2">
                <h2 className="text-base font-semibold text-[#F4F4F7]">3. Cookies, Offline Storage &amp; PWA Caching</h2>
                <p>
                  CHMR uses Service Worker caching (Workbox) so the editor interface and static application assets remain functional offline. Strictly necessary session cookies are used only when you initiate a TikTok OAuth flow (`chmr_tiktok_state` and `chmr_tiktok_sid`). We do not use third-party advertising trackers or sell personal information.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-base font-semibold text-[#F4F4F7]">4. Data Sharing &amp; Retention</h2>
                <p>
                  CHMR does not sell, rent, or trade your personal data or media. Transient API payloads (AI requests or direct social video uploads) are forwarded only to the specific service provider you selected (Google Gemini, YouTube, or TikTok) and are not permanently archived by CHMR.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-base font-semibold text-[#F4F4F7]">5. Managing &amp; Revoking Access</h2>
                <p>
                  You can sign out of YouTube or disconnect TikTok at any time directly inside the CHMR Export &amp; Publish dialog. You may also revoke CHMR&apos;s access at any time from your Google Account Security Settings or TikTok App Permissions settings.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-base font-semibold text-[#F4F4F7]">6. Policy URL &amp; Contact</h2>
                <p>
                  The canonical URL for this Privacy Policy is{' '}
                  <a href={privacyUrl} className="text-[#60A5FA] hover:underline font-mono-tabular text-xs">
                    {privacyUrl}
                  </a>
                  . For privacy inquiries or data deletion requests, contact{' '}
                  <span className="text-[#E4E4EC]">privacy@chmr.app</span>.
                </p>
              </section>
            </article>
          )}

          {/* Footer Links */}
          <footer className="pb-6 flex flex-wrap items-center justify-between gap-3 text-xs text-[#7D7D8A]">
            <span>© {new Date().getFullYear()} CHMR · Non-Linear Video Workstation</span>
            <div className="flex items-center gap-4">
              <a
                href={termsUrl}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('/terms');
                }}
                className="hover:text-[#D4D4DC] transition-colors"
              >
                Terms of Service ({termsUrl})
              </a>
              <a
                href={privacyUrl}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('/privacy');
                }}
                className="hover:text-[#D4D4DC] transition-colors"
              >
                Privacy Policy ({privacyUrl})
              </a>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
