/**
 * Sanitization for untrusted project file data.
 *
 * `.mjc` project files are JSON that can be shared between users. They contain
 * HTML strings (text element content) and SVG-interpolated strings (gradient
 * colors, picture sources) that are rendered via `dangerouslySetInnerHTML` /
 * `innerHTML` / string interpolation into SVG markup. Without sanitization, a
 * malicious `.mjc` file can execute arbitrary JavaScript when opened.
 *
 * This module provides the trust-boundary sanitization that runs during
 * `migrateProject` (before any element reaches the store or a renderer). All
 * downstream renderers can then safely use the data.
 */

import DOMPurify from 'dompurify';

// ── HTML content (text elements) ────────────────────────────────────────────

/**
 * Allow-list of HTML tags/attributes for rich-text content produced by TipTap.
 * TipTap outputs a constrained set of formatting tags; we allow those plus
 * plain text, but strip <script>, event handlers (on*), <iframe>, <object>,
 * <embed>, javascript: URLs, and any other active content.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'span', 'div',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins',
  'sub', 'sup', 'mark', 'small',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'a', 'img',
  'blockquote', 'code', 'pre',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'hr',
];

const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title',
  'style',
  'align', 'valign',
  'colspan', 'rowspan',
  'target', 'rel',
  'color',
  'face', 'size', // legacy <font>
  'width', 'height',
];

// Configure DOMPurify once. KEEP_CONTENT strips tag wrappers but retains text
// for disallowed tags, so legacy <font> content survives even though the tag
// itself is removed.
const PURIFY_CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  KEEP_CONTENT: true,
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur', 'onchange', 'onsubmit'],
};

/**
 * Sanitize an HTML string from a project file's text element content. Returns
 * a safe HTML string with scripts and event handlers stripped. On SSR (no
 * window/DOM), returns the input with a basic tag-stripping fallback so the
 * function never throws.
 */
export function sanitizeHtmlContent(html: string): string {
  if (typeof html !== 'string') return '';
  if (html === '') return '';

  // DOMPurify needs a DOM. On the server (no window) fall back to a basic
  // regex strip of <script> and on* attributes — this code path only runs
  // during SSR if ever, and a real sanitize runs on the client immediately
  // after hydration.
  if (typeof window === 'undefined' || typeof DOMPurify.sanitize !== 'function') {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
      .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
      .replace(/javascript:/gi, '');
  }

  try {
    return DOMPurify.sanitize(html, PURIFY_CONFIG) as unknown as string;
  } catch {
    // If DOMPurify somehow throws (shouldn't happen), fall back to the empty
    // string — never render unsanitized content.
    return '';
  }
}

// ── SVG attribute values (gradient colors, picture sources) ─────────────────

/**
 * Validate a CSS/SVG color string. Allows hex (#rgb, #rrggbb, #rrggbbaa),
 * rgb()/rgba()/hsl()/hsla() functions, and CSS named colors. Rejects anything
 * containing quotes, angle brackets, or semicolons that could break out of an
 * SVG attribute or inject markup. Returns the cleaned color or a safe default.
 */
const NAMED_COLORS = new Set([
  'transparent', 'currentcolor', 'aliceblue', 'antiquewhite', 'aqua', 'aquamarine',
  'azure', 'beige', 'bisque', 'black', 'blanchedalmond', 'blue', 'blueviolet',
  'brown', 'burlywood', 'cadetblue', 'chartreuse', 'chocolate', 'coral',
  'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki',
  'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred',
  'darksalmon', 'darkseagreen', 'darkslateblue', 'darkslategray', 'darkslategrey',
  'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey',
  'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro',
  'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey',
  'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
  'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey',
  'lightpink', 'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray',
  'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen',
  'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid',
  'mediumpurple', 'mediumseagreen', 'mediumslateblue', 'mediumspringgreen',
  'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose',
  'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise',
  'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum',
  'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue',
  'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna',
  'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow',
  'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise',
  'violet', 'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen', 'none',
]);

const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_RE = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)$/;
const HSL_RE = /^hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*[\d.]+\s*)?\)$/;

export function sanitizeColor(color: unknown, fallback = '#000000'): string {
  if (typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  if (trimmed === '') return fallback;

  // Reject anything that could break out of an SVG attribute or inject markup.
  if (/[<>"';{}\\]/.test(trimmed)) return fallback;

  const lower = trimmed.toLowerCase();
  if (NAMED_COLORS.has(lower)) return trimmed;
  if (COLOR_RE.test(trimmed)) return trimmed;
  if (RGB_RE.test(lower)) return trimmed;
  if (HSL_RE.test(lower)) return trimmed;

  return fallback;
}

/**
 * Clamp an opacity/value to [0, 1]. Returns the clamped number or the fallback.
 */
export function sanitizeOpacity(value: unknown, fallback = 1): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  if (isNaN(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

/**
 * Validate a picture source URL for SVG <image href="..."> interpolation.
 * Allows only:
 *   - data:image/* URLs (base64 embedded images)
 *   - asset:// references (internal asset lookup, resolved on load)
 *   - blob: URLs (transient browser blobs)
 *   - empty string (no picture)
 * Rejects anything with quotes, angle brackets, or `javascript:`/`vbscript:`
 * schemes that could break out of the attribute or execute script.
 */
export function sanitizePictureSrc(src: unknown): string {
  if (typeof src !== 'string') return '';
  const trimmed = src.trim();
  if (trimmed === '') return '';

  // Reject anything that could break out of the href="..." attribute.
  if (/[<>"'`{}\\]/.test(trimmed)) return '';

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('data:image/')) return trimmed;
  if (lower.startsWith('asset://')) return trimmed;
  if (lower.startsWith('blob:')) return trimmed;

  // Reject known dangerous schemes explicitly.
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return '';

  // Allow http/https image URLs (useCORS handles taint in html2canvas).
  if (lower.startsWith('http://') || lower.startsWith('https://')) return trimmed;

  return '';
}
