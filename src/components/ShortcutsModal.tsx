import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Play, Scissors, Search, Wrench, X } from 'lucide-react';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ShortcutCategory = 'Editing' | 'Tools' | 'Playback';

interface ShortcutEntry {
  action: string;
  detail: string;
  keyCombos: string[][];
}

interface ShortcutGroup {
  category: ShortcutCategory;
  description: string;
  accentColor: string;
  items: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    category: 'Editing',
    description: 'Clip clipboard, history, markers, and deletes',
    accentColor: '#3B82F6',
    items: [
      {
        action: 'Undo',
        detail: 'Step back one timeline action',
        keyCombos: [['Ctrl / Cmd', 'Z']],
      },
      {
        action: 'Redo',
        detail: 'Restore undone timeline action',
        keyCombos: [['Ctrl / Cmd', 'Shift', 'Z'], ['Ctrl / Cmd', 'Y']],
      },
      {
        action: 'Copy Clip',
        detail: 'Copy selected clip to clipboard',
        keyCombos: [['Ctrl / Cmd', 'C']],
      },
      {
        action: 'Cut Clip',
        detail: 'Copy selected clip and lift from track',
        keyCombos: [['Ctrl / Cmd', 'X']],
      },
      {
        action: 'Paste Clip',
        detail: 'Insert clipboard clip at playhead',
        keyCombos: [['Ctrl / Cmd', 'V']],
      },
      {
        action: 'Duplicate Clip',
        detail: 'Clone selected clip immediately after',
        keyCombos: [['Ctrl / Cmd', 'D']],
      },
      {
        action: 'Lift Delete',
        detail: 'Remove clip leaving gap in track',
        keyCombos: [['Delete'], ['Backspace']],
      },
      {
        action: 'Ripple Delete',
        detail: 'Extract clip and close downstream gap',
        keyCombos: [['Shift', 'Delete'], ['Shift', 'Backspace']],
      },
      {
        action: 'Add Marker',
        detail: 'Drop marker at current playhead',
        keyCombos: [['M']],
      },
    ],
  },
  {
    category: 'Tools',
    description: 'Timeline edit modes and snapping',
    accentColor: '#10B981',
    items: [
      {
        action: 'Selection Tool',
        detail: 'Select, move, and trim clips',
        keyCombos: [['V']],
      },
      {
        action: 'Ripple Edit Tool',
        detail: 'Trim clip and shift downstream clips',
        keyCombos: [['B']],
      },
      {
        action: 'Rolling Edit Tool',
        detail: 'Adjust adjacent edit point together',
        keyCombos: [['N']],
      },
      {
        action: 'Slip Tool',
        detail: 'Shift media in-point without moving clip',
        keyCombos: [['Y']],
      },
      {
        action: 'Slide Tool',
        detail: 'Slide clip between neighboring edits',
        keyCombos: [['U']],
      },
      {
        action: 'Razor Split Tool',
        detail: 'Click any clip to cut at cursor',
        keyCombos: [['C']],
      },
      {
        action: 'Type / Title Tool',
        detail: 'Insert graphic title onto video track',
        keyCombos: [['T']],
      },
      {
        action: 'Hand Pan Tool',
        detail: 'Scroll and navigate timeline canvas',
        keyCombos: [['H']],
      },
      {
        action: 'Toggle Snapping',
        detail: 'Enable or disable magnetic edge snap',
        keyCombos: [['S']],
      },
    ],
  },
  {
    category: 'Playback',
    description: 'Transport control, stepping, and In/Out range',
    accentColor: '#F59E0B',
    items: [
      {
        action: 'Play / Pause',
        detail: 'Toggle real-time program playback',
        keyCombos: [['Space']],
      },
      {
        action: 'Step Back 1 Frame',
        detail: 'Nudge playhead one frame earlier',
        keyCombos: [['←']],
      },
      {
        action: 'Step Forward 1 Frame',
        detail: 'Nudge playhead one frame later',
        keyCombos: [['→']],
      },
      {
        action: 'Jump to Start',
        detail: 'Move playhead to 00:00:00:00',
        keyCombos: [['Home']],
      },
      {
        action: 'Jump to End',
        detail: 'Move playhead to end of sequence',
        keyCombos: [['End']],
      },
      {
        action: 'Mark In Point',
        detail: 'Set range start at playhead',
        keyCombos: [['I']],
      },
      {
        action: 'Mark Out Point',
        detail: 'Set range end at playhead',
        keyCombos: [['O']],
      },
    ],
  },
];

function CategoryIcon({ category }: { category: ShortcutCategory }) {
  if (category === 'Editing') return <Scissors className="w-3.5 h-3.5 text-[#60A5FA]" />;
  if (category === 'Tools') return <Wrench className="w-3.5 h-3.5 text-[#34D399]" />;
  return <Play className="w-3.5 h-3.5 text-[#FBBF24]" />;
}

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHORTCUT_GROUPS;
    return SHORTCUT_GROUPS.map((grp) => ({
      ...grp,
      items: grp.items.filter(
        (item) =>
          grp.category.toLowerCase().includes(q) ||
          item.action.toLowerCase().includes(q) ||
          item.detail.toLowerCase().includes(q) ||
          item.keyCombos.some((combo) => combo.some((k) => k.toLowerCase().includes(q)))
      ),
    }));
  }, [query]);

  const totalCount = useMemo(
    () => filteredGroups.reduce((acc, g) => acc + g.items.length, 0),
    [filteredGroups]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl bg-[#141418] border border-[#2A2A34] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[86vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-[#111115] border-b border-[#25252E] flex items-center justify-between gap-4 flex-wrap shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#2563EB]/15 border border-[#3B82F6]/30 flex items-center justify-center shrink-0">
              <Keyboard className="w-4 h-4 text-[#60A5FA]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#F4F4F7] leading-tight">
                Studio Keyboard Shortcuts
              </h2>
              <p className="text-[11px] text-[#8E8E9B] font-mono-tabular">
                {totalCount} active workflow bindings · Press Esc to close
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="relative w-56">
              <Search className="w-3.5 h-3.5 text-[#6F6F7D] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter action or key..."
                className="w-full bg-[#18181F] border border-[#2C2C38] focus:border-[#3B82F6] rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-[#F4F4F7] placeholder-[#6F6F7D] outline-none"
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Keyboard Shortcuts"
              className="p-1.5 rounded-lg text-[#8E8E9B] hover:text-white hover:bg-[#23232C] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 3-Column Visual Grid: Editing · Tools · Playback */}
        <div className="p-5 overflow-y-auto grid grid-cols-1 lg:grid-cols-3 gap-5">
          {filteredGroups.map((group) => (
            <section
              key={group.category}
              className="rounded-xl bg-[#18181E] border border-[#262631] flex flex-col overflow-hidden"
            >
              <header className="px-4 py-3 bg-[#15151B] border-b border-[#252530] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CategoryIcon category={group.category} />
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-[#F4F4F7] tracking-tight">
                      {group.category}
                    </h3>
                    <p className="text-[10px] text-[#7D7D8C] truncate">{group.description}</p>
                  </div>
                </div>
                <span className="text-[10px] font-mono-tabular text-[#8E8E9B] shrink-0">
                  {group.items.length}
                </span>
              </header>

              <div className="p-3 grid grid-cols-1 gap-2">
                {group.items.length === 0 ? (
                  <div className="py-6 text-center text-[11px] text-[#6F6F7D]">
                    No matching {group.category.toLowerCase()} shortcuts
                  </div>
                ) : (
                  group.items.map((item) => (
                    <div
                      key={item.action}
                      className="px-3 py-2 rounded-lg bg-[#121217] border border-[#22222C] hover:border-[#343444] transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[#ECECF2] truncate">
                          {item.action}
                        </div>
                        <div className="text-[10px] text-[#7D7D8A] truncate mt-0.5">
                          {item.detail}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {item.keyCombos.map((combo, cIdx) => (
                          <div key={cIdx} className="flex items-center gap-1">
                            {combo.map((keyCap, kIdx) => (
                              <span key={kIdx} className="inline-flex items-center gap-1">
                                {kIdx > 0 && (
                                  <span className="text-[10px] text-[#5C5C6B] font-mono-tabular">+</span>
                                )}
                                <kbd className="min-w-[22px] text-center px-1.5 py-0.5 rounded bg-[#1E1E26] border border-[#323240] shadow-[inset_0_-1px_0_rgba(0,0,0,0.5)] font-mono-tabular text-[10px] font-semibold text-[#F4F4F7] whitespace-nowrap">
                                  {keyCap}
                                </kbd>
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
