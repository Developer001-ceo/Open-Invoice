/**
 * Shared Font Family Catalog
 * ────────────────────────────────────────────────────────────────────────────
 * Single source of truth for every font-family <select>/<option> in the app:
 *   • Text tool — inline editor toolbar (rich-text-editor.tsx)
 *   • Text tool — Static Formatting toolbar (floating-card.tsx)
 *   • Text tool — Typography section, card & panel
 *   • Table tool — Cell Defaults (table-level default font), card & panel
 *   • Table tool — Cell Properties (per-cell override), card & panel
 *
 * Each entry's `value` is a full CSS font-family stack (with generic fallback)
 * so it works in canvas rendering, PDF/html2canvas export, and <select> UI alike.
 *
 * Fonts marked `google: true` are loaded via Google Fonts `@import` in
 * globals.css. Web-safe fonts (Arial, Times New Roman, etc.) need no loading.
 */

export interface FontFamilyOption {
  /** Full CSS font-family value, e.g. "'Roboto', sans-serif". */
  value: string;
  /** Human-readable name shown in the dropdown. */
  label: string;
  /** CSS category — used to render each option in its own font (WYSIWYG). */
  category: 'sans-serif' | 'serif' | 'monospace' | 'display' | 'handwriting' | 'system';
  /** True when the font must be loaded from Google Fonts. */
  google?: boolean;
  /** Optional grouping label for a <optgroup> (MS Word–style categories). */
  group: string;
}

// ─── Catalog (MS Word–style, grouped by category) ────────────────────────────

export const FONT_FAMILIES: FontFamilyOption[] = [
  // ── Sans-serif ───────────────────────────────────────────────────────────
  { value: "Inter, sans-serif", label: 'Inter', category: 'sans-serif', google: true, group: 'Sans-serif' },
  { value: "Arial, sans-serif", label: 'Arial', category: 'sans-serif', group: 'Sans-serif' },
  { value: "'Arial Black', sans-serif", label: 'Arial Black', category: 'sans-serif', group: 'Sans-serif' },
  { value: 'Helvetica, sans-serif', label: 'Helvetica', category: 'sans-serif', group: 'Sans-serif' },
  { value: "'Helvetica Neue', Helvetica, Arial, sans-serif", label: 'Helvetica Neue', category: 'sans-serif', group: 'Sans-serif' },
  { value: 'Verdana, sans-serif', label: 'Verdana', category: 'sans-serif', group: 'Sans-serif' },
  { value: "'Tahoma', sans-serif", label: 'Tahoma', category: 'sans-serif', group: 'Sans-serif' },
  { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet MS', category: 'sans-serif', group: 'Sans-serif' },
  { value: "'Calibri', sans-serif", label: 'Calibri', category: 'sans-serif', group: 'Sans-serif' },
  { value: "'Segoe UI', sans-serif", label: 'Segoe UI', category: 'sans-serif', group: 'Sans-serif' },
  { value: "'Century Gothic', sans-serif", label: 'Century Gothic', category: 'sans-serif', group: 'Sans-serif' },
  { value: "'Gill Sans', sans-serif", label: 'Gill Sans', category: 'sans-serif', group: 'Sans-serif' },
  { value: "'Roboto', sans-serif", label: 'Roboto', category: 'sans-serif', google: true, group: 'Sans-serif' },
  { value: "'Open Sans', sans-serif", label: 'Open Sans', category: 'sans-serif', google: true, group: 'Sans-serif' },
  { value: "'Lato', sans-serif", label: 'Lato', category: 'sans-serif', google: true, group: 'Sans-serif' },
  { value: "'Montserrat', sans-serif", label: 'Montserrat', category: 'sans-serif', google: true, group: 'Sans-serif' },
  { value: "'Poppins', sans-serif", label: 'Poppins', category: 'sans-serif', google: true, group: 'Sans-serif' },
  { value: "'Nunito', sans-serif", label: 'Nunito', category: 'sans-serif', google: true, group: 'Sans-serif' },
  { value: "'Raleway', sans-serif", label: 'Raleway', category: 'sans-serif', google: true, group: 'Sans-serif' },
  { value: "'Source Sans 3', sans-serif", label: 'Source Sans 3', category: 'sans-serif', google: true, group: 'Sans-serif' },
  { value: "'Work Sans', sans-serif", label: 'Work Sans', category: 'sans-serif', google: true, group: 'Sans-serif' },
  { value: "'Oswald', sans-serif", label: 'Oswald', category: 'sans-serif', google: true, group: 'Sans-serif' },
  { value: "'Barlow', sans-serif", label: 'Barlow', category: 'sans-serif', google: true, group: 'Sans-serif' },
  { value: "'PT Sans', sans-serif", label: 'PT Sans', category: 'sans-serif', google: true, group: 'Sans-serif' },
  { value: "'Rubik', sans-serif", label: 'Rubik', category: 'sans-serif', google: true, group: 'Sans-serif' },
  { value: "'Quicksand', sans-serif", label: 'Quicksand', category: 'sans-serif', google: true, group: 'Sans-serif' },

  // ── Serif ────────────────────────────────────────────────────────────────
  { value: "'Times New Roman', serif", label: 'Times New Roman', category: 'serif', group: 'Serif' },
  { value: "Georgia, serif", label: 'Georgia', category: 'serif', group: 'Serif' },
  { value: "'Garamond', serif", label: 'Garamond', category: 'serif', group: 'Serif' },
  { value: "'Palatino Linotype', 'Palatino', serif", label: 'Palatino Linotype', category: 'serif', group: 'Serif' },
  { value: "'Book Antiqua', 'Palatino', serif", label: 'Book Antiqua', category: 'serif', group: 'Serif' },
  { value: "'Baskerville', serif", label: 'Baskerville', category: 'serif', group: 'Serif' },
  { value: "'Cambria', serif", label: 'Cambria', category: 'serif', group: 'Serif' },
  { value: "'Constantia', serif", label: 'Constantia', category: 'serif', group: 'Serif' },
  { value: "'Hoefler Text', serif", label: 'Hoefler Text', category: 'serif', group: 'Serif' },
  { value: "'Cormorant Garamond', serif", label: 'Cormorant Garamond', category: 'serif', google: true, group: 'Serif' },
  { value: "'Playfair Display', serif", label: 'Playfair Display', category: 'serif', google: true, group: 'Serif' },
  { value: "'Merriweather', serif", label: 'Merriweather', category: 'serif', google: true, group: 'Serif' },
  { value: "'Lora', serif", label: 'Lora', category: 'serif', google: true, group: 'Serif' },
  { value: "'PT Serif', serif", label: 'PT Serif', category: 'serif', google: true, group: 'Serif' },
  { value: "'Source Serif 4', serif", label: 'Source Serif 4', category: 'serif', google: true, group: 'Serif' },
  { value: "'EB Garamond', serif", label: 'EB Garamond', category: 'serif', google: true, group: 'Serif' },
  { value: "'Crimson Text', serif", label: 'Crimson Text', category: 'serif', google: true, group: 'Serif' },
  { value: "'Libre Baskerville', serif", label: 'Libre Baskerville', category: 'serif', google: true, group: 'Serif' },

  // ── Monospace ────────────────────────────────────────────────────────────
  { value: "'Courier New', monospace", label: 'Courier New', category: 'monospace', group: 'Monospace' },
  { value: "'Consolas', monospace", label: 'Consolas', category: 'monospace', group: 'Monospace' },
  { value: "'Monaco', monospace", label: 'Monaco', category: 'monospace', group: 'Monospace' },
  { value: "'Lucida Console', monospace", label: 'Lucida Console', category: 'monospace', group: 'Monospace' },
  { value: "'Roboto Mono', monospace", label: 'Roboto Mono', category: 'monospace', google: true, group: 'Monospace' },
  { value: "'Source Code Pro', monospace", label: 'Source Code Pro', category: 'monospace', google: true, group: 'Monospace' },
  { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono', category: 'monospace', google: true, group: 'Monospace' },
  { value: "'Fira Code', monospace", label: 'Fira Code', category: 'monospace', google: true, group: 'Monospace' },
  { value: "'IBM Plex Mono', monospace", label: 'IBM Plex Mono', category: 'monospace', google: true, group: 'Monospace' },

  // ── Display / Decorative ─────────────────────────────────────────────────
  { value: "'Impact', sans-serif", label: 'Impact', category: 'display', group: 'Display' },
  { value: "'Bebas Neue', sans-serif", label: 'Bebas Neue', category: 'display', google: true, group: 'Display' },
  { value: "'Anton', sans-serif", label: 'Anton', category: 'display', google: true, group: 'Display' },
  { value: "'Archivo Black', sans-serif", label: 'Archivo Black', category: 'display', google: true, group: 'Display' },
  { value: "'Righteous', sans-serif", label: 'Righteous', category: 'display', google: true, group: 'Display' },
  { value: "'Cinzel', serif", label: 'Cinzel', category: 'display', google: true, group: 'Display' },
  { value: "'Abril Fatface', serif", label: 'Abril Fatface', category: 'display', google: true, group: 'Display' },
  { value: "'Lobster', cursive", label: 'Lobster', category: 'display', google: true, group: 'Display' },
  { value: "'Pacifico', cursive", label: 'Pacifico', category: 'display', google: true, group: 'Display' },

  // ── Handwriting ──────────────────────────────────────────────────────────
  { value: "'Caveat', cursive", label: 'Caveat', category: 'handwriting', google: true, group: 'Handwriting' },
  { value: "'Dancing Script', cursive", label: 'Dancing Script', category: 'handwriting', google: true, group: 'Handwriting' },
  { value: "'Sacramento', cursive", label: 'Sacramento', category: 'handwriting', google: true, group: 'Handwriting' },
  { value: "'Shadows Into Light', cursive", label: 'Shadows Into Light', category: 'handwriting', google: true, group: 'Handwriting' },
  { value: "'Kalam', cursive", label: 'Kalam', category: 'handwriting', google: true, group: 'Handwriting' },
  { value: "'Satisfy', cursive", label: 'Satisfy', category: 'handwriting', google: true, group: 'Handwriting' },
  { value: "'Cookie', cursive", label: 'Cookie', category: 'handwriting', google: true, group: 'Handwriting' },
  { value: "'Great Vibes', cursive", label: 'Great Vibes', category: 'handwriting', google: true, group: 'Handwriting' },
];

// ─── Convenience: grouped <optgroup> structure for <select> ──────────────────

export interface FontOptGroup {
  label: string;
  options: FontFamilyOption[];
}

export const FONT_FAMILIES_GROUPED: FontOptGroup[] = (() => {
  const groups: FontOptGroup[] = [];
  const groupMap = new Map<string, FontFamilyOption[]>();
  for (const f of FONT_FAMILIES) {
    if (!groupMap.has(f.group)) groupMap.set(f.group, []);
    groupMap.get(f.group)!.push(f);
  }
  const order = ['Sans-serif', 'Serif', 'Monospace', 'Display', 'Handwriting'];
  for (const g of order) {
    const opts = groupMap.get(g);
    if (opts) groups.push({ label: g, options: opts });
  }
  return groups;
})();

// ─── Default font (used as the fallback when a value isn't in the catalog) ───

export const DEFAULT_FONT_FAMILY = 'Inter, sans-serif';

/**
 * Returns the CSS font-family stack to apply when rendering a <select> option's
 * OWN text in its own font (WYSIWYG dropdown). Google/web-safe fonts resolve to
 * their real family; unknown values fall back to the default sans.
 */
export function fontFamilyCss(value: string): string {
  return value || DEFAULT_FONT_FAMILY;
}
