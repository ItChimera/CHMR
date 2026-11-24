import { BarChart3, UserCheck } from 'lucide-react';
import { assetUrl } from '../utils/runtime';

export type AppViewMode = 'home' | 'studio' | 'metrics';

interface TopBarProps {
  activeView: AppViewMode;
  onSelectView: (view: AppViewMode) => void;
  onOpenExport: () => void;
  onNavigate?: (path: string) => void;
  savedYouTubeUser?: { name: string; avatarUrl?: string } | null;
}

const PRIMARY_VIEWS: Array<{ id: AppViewMode; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'studio', label: 'Edit & Upload' },
  { id: 'metrics', label: 'Metrics' },
];

export function TopBar({
  activeView,
  onSelectView,
  onOpenExport,
  onNavigate,
  savedYouTubeUser,
}: TopBarProps) {
  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (onNavigate) {
      e.preventDefault();
      onNavigate(path);
    }
  };

  return (
    <header className="h-12 px-5 bg-[#121215]/90 backdrop-blur-xl border-b border-white/[0.07] flex items-center justify-between gap-6 shrink-0 select-none">
      {/* Zone 1: Brand Logo & Title -> Home */}
      <button
        type="button"
        onClick={() => onSelectView('home')}
        className="flex items-center gap-2.5 whitespace-nowrap shrink-0 group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0A84FF] rounded-lg cursor-pointer"
        title="CHMR Home"
      >
        <img
          src={assetUrl('chmr-logo.png')}
          alt="CHMR Logo"
          className="w-7 h-7 rounded-lg object-cover shadow-sm"
        />
        <span className="text-[15px] font-semibold tracking-tight text-[#F5F5F7] group-hover:text-white">
          CHMR
        </span>
      </button>

      {/* Zone 2: Segmented Navigation (Home / Edit & Upload / Metrics) */}
      <nav
        className="flex items-center gap-1 p-1 bg-white/[0.04] border border-white/[0.06] rounded-xl overflow-x-auto"
        aria-label="Main navigation"
      >
        {PRIMARY_VIEWS.map((view) => {
          const isActive = activeView === view.id;
          return (
            <button
              key={view.id}
              type="button"
              onClick={() => onSelectView(view.id)}
              className={`px-3.5 py-1 text-xs font-medium rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0A84FF] flex items-center gap-1.5 ${
                isActive
                  ? 'bg-white/[0.12] text-white shadow-sm'
                  : 'text-[#9898A2] hover:text-[#F5F5F7]'
              }`}
            >
              {view.id === 'metrics' && <BarChart3 className="w-3.5 h-3.5 text-[#0A84FF]" />}
              <span>{view.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Legal Links, Saved Accounts, Primary CTA */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="hidden xl:flex items-center gap-2.5 pr-1 text-[11px] text-[#8E8E98]">
          <a
            href="#/terms"
            onClick={(e) => handleLinkClick(e, '/terms')}
            className="hover:text-white transition-colors whitespace-nowrap"
          >
            Terms
          </a>
          <span className="text-[#363642]">·</span>
          <a
            href="#/privacy"
            onClick={(e) => handleLinkClick(e, '/privacy')}
            className="hover:text-white transition-colors whitespace-nowrap"
          >
            Privacy
          </a>
        </div>
        {savedYouTubeUser && (
          <button
            type="button"
            onClick={() => onSelectView('metrics')}
            title={`YouTube connected: ${savedYouTubeUser.name}. Click to inspect metrics.`}
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.07] text-[11px] font-medium text-[#E5E5EA] max-w-[165px] cursor-pointer transition-colors"
          >
            {savedYouTubeUser.avatarUrl ? (
              <img
                src={savedYouTubeUser.avatarUrl}
                alt={savedYouTubeUser.name}
                className="w-4 h-4 rounded object-cover shrink-0"
              />
            ) : (
              <UserCheck className="w-3.5 h-3.5 text-[#FF453A] shrink-0" />
            )}
            <span className="truncate">YouTube · {savedYouTubeUser.name}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onOpenExport}
          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#0A84FF] hover:bg-[#2392FF] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]"
        >
          Upload / Export
        </button>
      </div>
    </header>
  );
}
