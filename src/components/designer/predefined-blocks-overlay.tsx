'use client';

import { useDesignerStore } from '@/store/designer-store';
import { PREDEFINED_BLOCKS } from '@/lib/predefined-blocks';
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Heading, Building2, MapPin, User, Calendar, Hash,
  PenLine, FileText, Heart, Search, X,
} from 'lucide-react';

// Map icon names to components
const ICON_MAP: Record<string, React.ReactNode> = {
  'Heading': <Heading className="h-4 w-4" />,
  'Building2': <Building2 className="h-4 w-4" />,
  'MapPin': <MapPin className="h-4 w-4" />,
  'User': <User className="h-4 w-4" />,
  'Calendar': <Calendar className="h-4 w-4" />,
  'Hash': <Hash className="h-4 w-4" />,
  'PenLine': <PenLine className="h-4 w-4" />,
  'FileText': <FileText className="h-4 w-4" />,
  'Heart': <Heart className="h-4 w-4" />,
};

export function PredefinedBlocksOverlay() {
  const predefinedBlocksOpen = useDesignerStore((s) => s.predefinedBlocksOpen);
  const closePredefinedBlocks = useDesignerStore((s) => s.closePredefinedBlocks);
  const addPredefinedBlock = useDesignerStore((s) => s.addPredefinedBlock);

  // Animation states
  const [isVisible, setIsVisible] = useState(false);
  const [cardsVisible, setCardsVisible] = useState(false);
  const [hoveredBlock, setHoveredBlock] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDismissing, setIsDismissing] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const cardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter blocks by search
  const filteredBlocks = PREDEFINED_BLOCKS.filter((block) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      block.label.toLowerCase().includes(q) ||
      block.description.toLowerCase().includes(q) ||
      block.id.toLowerCase().includes(q)
    );
  });

  // ── Open / Close lifecycle ──────────────────────────────────────────────

  useEffect(() => {
    // Cancel any pending rAF from a previous run so we don't double-schedule.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (predefinedBlocksOpen) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setIsDismissing(false);
        setSelectedBlockId(null);
        setSearchQuery('');
        setIsVisible(true);
        cardTimerRef.current = setTimeout(() => {
          setCardsVisible(true);
          // Focus the search input after cards appear
          focusTimerRef.current = setTimeout(() => searchInputRef.current?.focus(), 100);
        }, 150);
      });
    } else {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setIsVisible(false);
        setCardsVisible(false);
        setSelectedBlockId(null);
        setIsDismissing(false);
      });
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (cardTimerRef.current) {
        clearTimeout(cardTimerRef.current);
        cardTimerRef.current = null;
      }
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    };
  }, [predefinedBlocksOpen]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
      if (cardTimerRef.current) clearTimeout(cardTimerRef.current);
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── Dismiss with exit animation ────────────────────────────────────────

  const dismissOverlay = useCallback(() => {
    if (isDismissing) return;
    setIsDismissing(true);
    setCardsVisible(false);

    dismissTimerRef.current = setTimeout(() => {
      closePredefinedBlocks();
    }, 180);
  }, [isDismissing, closePredefinedBlocks]);

  // ── Escape key ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!predefinedBlocksOpen || isDismissing) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        dismissOverlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [predefinedBlocksOpen, isDismissing, dismissOverlay]);

  // ── Block click handler ─────────────────────────────────────────────────

  const handleBlockClick = useCallback((blockId: string) => {
    if (isDismissing || selectedBlockId) return;

    setSelectedBlockId(blockId);

    selectTimerRef.current = setTimeout(() => {
      addPredefinedBlock(blockId);
    }, 200);
  }, [isDismissing, selectedBlockId, addPredefinedBlock]);

  // ── Early return if not open ───────────────────────────────────────────

  if (!predefinedBlocksOpen) return null;

  // Effective opacity for the dim overlay
  const dimOpacity = isVisible && !isDismissing ? 1 : 0;
  const dimTransition = isDismissing ? 'opacity 150ms ease-in' : 'opacity 200ms ease-out';

  return (
    <div
      className="fixed inset-0 z-[99999]"
      style={{ pointerEvents: isVisible ? 'auto' : 'none' }}
    >
      {/* ── Dim overlay ── */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        style={{
          opacity: dimOpacity,
          transition: dimTransition,
        }}
        onClick={dismissOverlay}
      />

      {/* ── Center panel ── */}
      <div
        className="absolute top-1/2 left-1/2"
        style={{
          transform: cardsVisible && !isDismissing && !selectedBlockId
            ? 'translate(-50%, -50%) scale(1)'
            : 'translate(-50%, -50%) scale(0.95)',
          opacity: cardsVisible && !isDismissing && !selectedBlockId ? 1 : 0,
          transition: 'all 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <div className="w-[680px] max-h-[80vh] bg-card rounded-xl border border-border shadow-2xl overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-5 py-4 border-b border-border flex items-center gap-3 shrink-0">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-foreground">Predefined Blocks</h2>
              <p className="text-[11px] text-muted-foreground">Quick-insert common invoice text blocks</p>
            </div>
            <button
              onClick={dismissOverlay}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Search bar */}
          <div className="px-5 py-3 border-b border-border/50 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search blocks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm bg-muted/50 border border-border/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Blocks grid */}
          <div className="p-5 overflow-y-auto flex-1" style={{ scrollbarGutter: 'stable' }}>
            {filteredBlocks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No blocks matching &ldquo;{searchQuery}&rdquo;
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {filteredBlocks.map((block) => {
                  const isHovered = hoveredBlock === block.id;
                  const isSelected = selectedBlockId === block.id;
                  const iconNode = ICON_MAP[block.icon] || <FileText className="h-4 w-4" />;

                  return (
                    <button
                      key={block.id}
                      className={`group relative text-left p-3 rounded-lg border transition-all duration-200 ${
                        isSelected
                          ? 'bg-primary/10 border-primary/50 ring-2 ring-primary/30 scale-[0.98]'
                          : isHovered
                          ? 'bg-accent/50 border-primary/30 shadow-md -translate-y-0.5'
                          : 'bg-card border-border/50 hover:border-border shadow-sm'
                      }`}
                      onMouseEnter={() => !isDismissing && setHoveredBlock(block.id)}
                      onMouseLeave={() => setHoveredBlock(null)}
                      onClick={() => handleBlockClick(block.id)}
                    >
                      {/* Preview text only */}
                      <div className={`text-[11px] leading-relaxed p-2 rounded-md border border-border/30 ${
                        isSelected ? 'bg-primary/5' : 'bg-muted/30'
                      }`}>
                        <div
                          className="overflow-hidden"
                          style={{
                            maxHeight: '80px',
                            lineHeight: 1.4,
                          }}
                          dangerouslySetInnerHTML={{ __html: block.content }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer hint */}
          <div className="px-5 py-3 border-t border-border/50 shrink-0">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Click a block to insert it at the center of the page</span>
              <div className="flex items-center gap-2">
                <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">Esc</kbd>
                <span>to close</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
