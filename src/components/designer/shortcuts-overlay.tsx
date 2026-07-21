'use client';

import { useDesignerStore } from '@/store/designer-store';
import { motion, AnimatePresence } from 'framer-motion';

// ─────────────────────────────────────────────────────────────────────────────
// On-canvas shortcuts — plain instruction text written directly on the
// workspace, to the right of the canvas page.
//
// This component is rendered INSIDE the canvas's pan/zoom transform
// (`.canvas-inner`), so it lives in canvas-world coordinates: it pans and
// zooms WITH the page, behaving exactly like canvas content. Position is
// computed from pageWidth/pageHeight so it always sits just to the right of
// the page (x = VIEWPORT_PADDING + pageWidth + gap) and aligned with the
// page top (y = VIEWPORT_PADDING). Font sizes are in canvas-world px, so at
// 100% zoom they read at the given size and scale up/down naturally with zoom.
//
// It is plain text — no card, border, background, or shadow. `pointer-events-
// none` so it never intercepts canvas interaction (drag/pan/zoom/click).
//
// Only KEYBOARD shortcuts are listed here — no mouse/trackpad actions, since
// those assume a mouse.
//
// Visibility is toggled from the footer's "Hide/Show Hints" button, via the
// `shortcutsOverlayVisible` store flag.
// ─────────────────────────────────────────────────────────────────────────────

// Must match VIEWPORT_PADDING in canvas.tsx / designer-store.ts. The page is
// positioned at margin: VIEWPORT_PADDING inside canvas-inner.
const VIEWPORT_PADDING = 40;
// Gap between the page's right edge and the shortcuts text (in canvas px).
const GAP = 44;

interface ShortcutEntry {
  keys: string;
  label: string;
}

interface ShortcutGroup {
  title: string;
  entries: ShortcutEntry[];
}

// Keyboard-only shortcuts. "Ctrl" matches the rest of the app's shorthand.
// No mouse actions (no Scroll, no Drag).
const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Zoom',
    entries: [
      { keys: 'Ctrl++', label: 'Zoom in' },
      { keys: 'Ctrl+-', label: 'Zoom out' },
      { keys: 'Ctrl+0', label: 'Reset zoom' },
    ],
  },
  {
    title: 'Edit',
    entries: [
      { keys: 'Ctrl+Z', label: 'Undo' },
      { keys: 'Shift+Ctrl+Z', label: 'Redo' },
      { keys: 'Ctrl+C / V', label: 'Copy / Paste' },
      { keys: 'Ctrl+D', label: 'Duplicate' },
      { keys: 'Ctrl+A', label: 'Select all' },
      { keys: 'Del', label: 'Delete' },
      { keys: '← → ↑ ↓', label: 'Nudge' },
      { keys: 'Shift+Arrow', label: 'Nudge 10px' },
    ],
  },
  {
    title: 'File',
    entries: [
      { keys: 'Ctrl+N', label: 'New project' },
      { keys: 'Ctrl+O', label: 'Open' },
      { keys: 'Ctrl+S', label: 'Save' },
      { keys: 'Shift+Ctrl+S', label: 'Save as' },
      { keys: 'Shift+Ctrl+E', label: 'Export PDF' },
    ],
  },
  {
    title: 'View',
    entries: [
      { keys: 'Shift+S', label: 'Properties' },
      { keys: 'Shift+Q', label: 'Blocks' },
      { keys: 'Esc', label: 'Deselect' },
    ],
  },
];

interface ShortcutsOverlayProps {
  pageWidth: number;
  pageHeight: number;
}

export function ShortcutsOverlay({ pageWidth, pageHeight }: ShortcutsOverlayProps) {
  const visible = useDesignerStore((s) => s.shortcutsOverlayVisible);

  // Canvas-world coordinates: just to the right of the page, aligned with the
  // page top. Width is fixed in canvas px; font sizes are in canvas px so they
  // scale with zoom (behaves like canvas content).
  const left = VIEWPORT_PADDING + pageWidth + GAP;
  const top = VIEWPORT_PADDING;
  // Width is in canvas px. Widened from 300 → 360 so the longest key combos
  // (e.g. "Shift + Ctrl + E") fit without being clipped by the overlay's
  // overflow-hidden, even at low zoom.
  const width = 360;
  // Font sizes in canvas px. At 100% zoom these are the on-screen px sizes.
  const TITLE_FS = 22;
  const LABEL_FS = 24;
  const KEYS_FS = 24;
  // Black Ops One — bold military/stencil display font, loaded via next/font
  // in layout.tsx and exposed as the --font-black-ops-one CSS variable.
  const HINTS_FONT = "var(--font-black-ops-one)";

  // Format shortcut keys with spaces around the "+" separator so combos read
  // naturally (e.g. "Ctrl+S" → "Ctrl + S", "Ctrl++" → "Ctrl + +").
  const formatKeys = (keys: string) => keys.replace(/\+/g, ' + ');

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="shortcuts-overlay"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 12 }}
          transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
          // Positioned in canvas-world coordinates. NO background/border/
          // shadow — plain text on the workspace. pointer-events-none so it
          // never blocks canvas interaction.
          className="absolute pointer-events-none select-none"
          style={{
            left,
            top,
            width,
            // Clamp so it never overflows below the page bottom (canvas px).
            maxHeight: pageHeight,
            overflow: 'hidden',
          }}
          aria-hidden="true"
        >
          <div className="flex flex-col" style={{ gap: 16 }}>
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.title} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span
                  style={{
                    fontSize: TITLE_FS,
                    fontWeight: 400,
                    fontFamily: HINTS_FONT,
                    textTransform: 'uppercase',
                    letterSpacing: '0.12em',
                    // Light grey — brighter than the labels so the group
                    // title reads as a header but stays soft/instructional.
                    color: 'color-mix(in oklab, var(--muted-foreground) 70%, transparent)',
                    marginBottom: 6,
                  }}
                >
                  {group.title}
                </span>
                {group.entries.map((entry) => (
                  <div
                    key={entry.keys + entry.label}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      // Generous gap so the label and its key combo have clear
                      // breathing room between them (was 10 — too cramped).
                      gap: 24,
                      lineHeight: 1.4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: LABEL_FS,
                        fontWeight: 400,
                        fontFamily: HINTS_FONT,
                        letterSpacing: '0.08em',
                        color: 'color-mix(in oklab, var(--muted-foreground) 55%, transparent)',
                      }}
                    >
                      {entry.label}
                    </span>
                    <span
                      style={{
                        fontSize: KEYS_FS,
                        fontWeight: 400,
                        fontFamily: HINTS_FONT,
                        letterSpacing: '0.08em',
                        color: 'color-mix(in oklab, var(--muted-foreground) 70%, transparent)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatKeys(entry.keys)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
