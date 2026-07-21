/**
 * Thumbnail generation for .mjc project files.
 *
 * Reuses the existing `renderCanvasPreview` from pdf-export.ts
 * which already renders all elements to an off-screen canvas
 * with no UI overlays (no selection handles, guides, etc).
 *
 * Optimizations:
 * - Thumbnail cache with element hash comparison (avoids regenerating unless elements changed)
 * - Canvas buffer cleanup (width/height set to 0 after use)
 * - requestIdleCallback wrapper for non-urgent generation
 */

import type { CanvasElement } from '@/lib/element-types';
import type { CanvasSettings } from '@/store/designer-store';

export interface PreviewThumbnail {
  width: number;
  height: number;
  data: string; // base64-encoded PNG
}

const THUMBNAIL_MAX_SIZE = 200;

// ─── Thumbnail Cache ─────────────────────────────────────────────────────────

interface CachedThumbnail {
  hash: string;
  thumbnail: PreviewThumbnail;
}

let cachedThumbnail: CachedThumbnail | null = null;

/**
 * Compute a lightweight hash of element IDs, positions, and sizes.
 * This is used to determine if the thumbnail needs to be regenerated.
 * Only includes identity and geometry fields — property changes that
 * don't affect layout won't invalidate the cache, which is acceptable
 * for a preview thumbnail.
 */
function computeElementHash(elements: CanvasElement[], canvasSettings: CanvasSettings): string {
  const parts: string[] = [
    `${canvasSettings.pageWidth}:${canvasSettings.pageHeight}:${canvasSettings.pageBackgroundColor}`,
  ];

  function appendElement(el: CanvasElement): void {
    parts.push(
      `${el.id}:${el.type}:${el.x}:${el.y}:${el.width}:${el.height}` +
      `:${el.lineStartX ?? ''}:${el.lineStartY ?? ''}:${el.lineEndX ?? ''}:${el.lineEndY ?? ''}` +
      `:${el.rotation ?? ''}`,
    );
    if (el.children) {
      for (const child of el.children) {
        appendElement(child);
      }
    }
  }

  for (const el of elements) {
    appendElement(el);
  }

  return parts.join('|');
}

/**
 * Release canvas GPU buffers by zeroing dimensions.
 * This allows the browser to reclaim the underlying pixel buffer.
 */
function releaseCanvas(canvas: HTMLCanvasElement | null): void {
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

// ─── Core Generation ─────────────────────────────────────────────────────────

/**
 * Generate a preview thumbnail of the current canvas design.
 * Renders all visible elements to an off-screen canvas at a
 * scaled-down resolution, then converts to a base64 PNG string.
 *
 * Uses a cache: if the element hash hasn't changed since the last
 * call, the previously generated thumbnail is returned immediately.
 *
 * @param elements - The canvas elements to render
 * @param canvasSettings - The canvas/page settings
 * @returns A PreviewThumbnail object, or null if generation fails
 */
export async function generateThumbnail(
  elements: CanvasElement[],
  canvasSettings: CanvasSettings,
): Promise<PreviewThumbnail | null> {
  try {
    const hash = computeElementHash(elements, canvasSettings);

    // Return cached thumbnail if nothing changed
    if (cachedThumbnail && cachedThumbnail.hash === hash) {
      return cachedThumbnail.thumbnail;
    }

    const { pageWidth, pageHeight } = canvasSettings;

    // Calculate scale to fit within THUMBNAIL_MAX_SIZE x THUMBNAIL_MAX_SIZE
    const scale = Math.min(THUMBNAIL_MAX_SIZE / pageWidth, THUMBNAIL_MAX_SIZE / pageHeight);

    // Render using the existing pipeline (no UI overlays).
    // Dynamic import keeps jspdf + html2canvas-pro out of any bundle that
    // only imports thumbnail.ts for its helper functions (e.g. open-project
    // dialog imports thumbnailToDataUrl / getPlaceholderThumbnail). The pdf
    // chunk is only fetched when a thumbnail is actually generated.
    const { renderCanvasPreview } = await import('@/lib/pdf-export');
    const canvas = await renderCanvasPreview(elements, canvasSettings, scale);

    // Crop to the actual page area (renderCanvasPreview may return full size)
    const thumbWidth = Math.round(pageWidth * scale);
    const thumbHeight = Math.round(pageHeight * scale);

    // Create a final canvas at exact thumbnail size
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = thumbWidth;
    thumbCanvas.height = thumbHeight;
    const ctx = thumbCanvas.getContext('2d');
    if (!ctx) {
      releaseCanvas(canvas);
      releaseCanvas(thumbCanvas);
      return null;
    }

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, thumbWidth, thumbHeight);

    // Draw the rendered preview
    ctx.drawImage(canvas, 0, 0, thumbWidth, thumbHeight);

    // Convert to base64 PNG (use moderate quality for small file size)
    const dataUrl = thumbCanvas.toDataURL('image/png');

    // Strip the data URL prefix to get pure base64
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

    // Release canvas buffers — allows GPU memory to be reclaimed
    releaseCanvas(canvas);
    releaseCanvas(thumbCanvas);

    const result: PreviewThumbnail = {
      width: thumbWidth,
      height: thumbHeight,
      data: base64Data,
    };

    // Store in cache
    cachedThumbnail = { hash, thumbnail: result };

    return result;
  } catch (err) {
    console.warn('Thumbnail generation failed:', err);
    return null;
  }
}

// ─── Idle Callback Wrapper ───────────────────────────────────────────────────

/**
 * Generate a thumbnail during an idle period using requestIdleCallback.
 * This is ideal for non-urgent thumbnail generation (e.g., auto-save)
 * where blocking the UI thread should be avoided.
 *
 * Falls back to a microtask if requestIdleCallback is not available.
 */
export function generateThumbnailIdle(
  elements: CanvasElement[],
  canvasSettings: CanvasSettings,
): Promise<PreviewThumbnail | null> {
  return new Promise((resolve) => {
    const doGenerate = async () => {
      const result = await generateThumbnail(elements, canvasSettings);
      resolve(result);
    };

    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => { void doGenerate(); }, { timeout: 2000 });
    } else {
      // Fallback: schedule as a microtask
      Promise.resolve().then(() => { void doGenerate(); });
    }
  });
}

/**
 * Invalidate the thumbnail cache. Call this when elements are
 * explicitly modified (e.g., property changes that affect appearance
 * but not position/size, which the hash doesn't capture).
 */
export function invalidateThumbnailCache(): void {
  cachedThumbnail = null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a PreviewThumbnail's base64 data back to a data URL
 * suitable for use as an <img> src attribute.
 */
export function thumbnailToDataUrl(thumbnail: PreviewThumbnail): string {
  return `data:image/png;base64,${thumbnail.data}`;
}

/**
 * Create a placeholder thumbnail SVG as a data URL.
 * Used when a project has no thumbnail.
 */
export function getPlaceholderThumbnail(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <rect width="200" height="200" fill="#f4f4f5"/>
    <rect x="50" y="30" width="100" height="4" rx="2" fill="#d4d4d8"/>
    <rect x="40" y="50" width="120" height="3" rx="1.5" fill="#e4e4e7"/>
    <rect x="40" y="62" width="100" height="3" rx="1.5" fill="#e4e4e7"/>
    <rect x="30" y="85" width="140" height="70" rx="4" fill="#e4e4e7" stroke="#d4d4d8" stroke-width="1"/>
    <rect x="30" y="85" width="140" height="16" rx="4" fill="#d4d4d8"/>
    <line x1="30" y1="101" x2="170" y2="101" stroke="#d4d4d8" stroke-width="0.5"/>
    <line x1="77" y1="85" x2="77" y2="155" stroke="#d4d4d8" stroke-width="0.5"/>
    <line x1="123" y1="85" x2="123" y2="155" stroke="#d4d4d8" stroke-width="0.5"/>
    <text x="100" y="175" text-anchor="middle" fill="#a1a1aa" font-family="sans-serif" font-size="11">No preview</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
