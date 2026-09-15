/**
 * Project file format for Invoice Designer (.mjc)
 *
 * Handles serialization, deserialization, version migration,
 * and browser file save/load operations.
 *
 * Optimizations:
 * - structuredClone replaces JSON.parse(JSON.stringify()) for deep cloning
 * - Single-pass recursive element traversal for image extraction & migration
 * - Async FileReader.readAsArrayBuffer for better file reading performance
 * - pako gzip compression for large project files
 * - Combined migration passes (single element iteration for all field additions)
 * - Memory-efficient validation (minimal temporary allocations)
 */

import {
  CanvasElement,
  ElementType,
  ElementProperties,
  TextProperties,
  TableProperties,
  ImageProperties,
  LineProperties,
  RectangleProperties,
  EllipseProperties,
  RectangleEffects,
  getDefaultProperties,
  DEFAULT_EFFECTS,
} from './element-types';
import {
  CanvasSettings,
  MarginGuidelineSettings,
  MarginPreset,
} from '@/store/designer-store';
import pako from 'pako';
import { sanitizeHtmlContent, sanitizeColor, sanitizeOpacity, sanitizePictureSrc } from './sanitize';

// ─── Version ────────────────────────────────────────────────────────────────
export const APP_VERSION = '1.0.0';

// ─── Compression Threshold ──────────────────────────────────────────────────
/** Files larger than this (in bytes) will be compressed with gzip */
const COMPRESSION_THRESHOLD = 100_000;
/** Magic bytes prepended to compressed .mjc files so we can detect them on load. */
const MJC_COMPRESSED_MAGIC = 'MJCGZ01';
/** Legacy magic used by older .isha files — still recognized on load so existing
 *  projects keep opening after the .isha -> .mjc rename. */
const LEGACY_ISHA_COMPRESSED_MAGIC = 'ISHAGZ01';

// ─── Project File Interfaces ────────────────────────────────────────────────

export interface ProjectAsset {
  id: string;
  name: string;
  data: string; // base64-encoded
}

export interface ProjectSettings {
  snapEnabled: boolean;
  snapToGrid: boolean;
  snapToElements: boolean;
  snapUnit: number;
  zoomStep: number;
}

export interface ProjectFile {
  appVersion: string;
  projectName: string;
  canvas: CanvasSettings;
  elements: CanvasElement[];
  elementCounter: Record<ElementType, number>;
  settings: ProjectSettings;
  assets: {
    images: ProjectAsset[];
  };
  /** Optional base64 thumbnail used by the recent-projects list. */
  previewThumbnail?: string;
}

// ─── Single-Pass Recursive Element Traversal ────────────────────────────────

/**
 * Callback invoked for each element in the tree (including children of groups).
 * Receives the element and its depth in the tree (0 for top-level).
 */
type ElementVisitor = (el: CanvasElement, depth: number) => void;

/**
 * Recursively walk all elements, visiting each element exactly once.
 * This is the single shared traversal used for both image extraction
 * and migration, avoiding duplicate recursive walks.
 */
function walkElements(elements: CanvasElement[], visitor: ElementVisitor, depth = 0): void {
  for (const el of elements) {
    visitor(el, depth);
    if (el.children && el.children.length > 0) {
      walkElements(el.children, visitor, depth + 1);
    }
  }
}

// ─── Serialization ──────────────────────────────────────────────────────────

/**
 * Serialize the full project state into a ProjectFile object.
 * Extracts image data from elements into the assets array for
 * clean separation and deduplication.
 */
export function serializeProject(params: {
  elements: CanvasElement[];
  elementCounter: Record<ElementType, number>;
  canvasSettings: CanvasSettings;
  snapEnabled: boolean;
  snapToGrid: boolean;
  snapToElements: boolean;
  snapUnit: number;
  zoomStep: number;
  projectName?: string;
}): ProjectFile {
  const {
    elements,
    elementCounter,
    canvasSettings,
    snapEnabled,
    snapToGrid,
    snapToElements,
    snapUnit,
    zoomStep,
    projectName = 'Untitled Project',
  } = params;

  // Deep clone elements using structuredClone (faster & more correct than JSON round-trip)
  const clonedElements: CanvasElement[] = structuredClone(elements);

  // Collect image assets and replace inline base64 with asset references
  const imageAssets: ProjectAsset[] = [];
  const assetMap = new Map<string, string>(); // src -> assetId

  // Single-pass traversal for image extraction (no separate recursive function)
  walkElements(clonedElements, (el) => {
    if (el.type === 'image') {
      const props = (el.properties as { type: 'image'; data: ImageProperties }).data;
      if (props.src && props.src.startsWith('data:')) {
        if (assetMap.has(props.src)) {
          props.src = `asset://${assetMap.get(props.src)}`;
        } else {
          const assetId = `img_${imageAssets.length.toString().padStart(3, '0')}`;
          assetMap.set(props.src, assetId);
          imageAssets.push({
            id: assetId,
            name: el.name || assetId,
            data: props.src,
          });
          props.src = `asset://${assetId}`;
        }
      }
    }
  });

  return {
    appVersion: APP_VERSION,
    projectName,
    canvas: structuredClone(canvasSettings),
    elements: clonedElements,
    elementCounter: { ...elementCounter },
    settings: {
      snapEnabled,
      snapToGrid,
      snapToElements,
      snapUnit,
      zoomStep,
    },
    assets: {
      images: imageAssets,
    },
  };
}

// ─── Deserialization ────────────────────────────────────────────────────────

/**
 * Deserialize a ProjectFile object back into store-compatible state.
 * Restores image data from assets and runs version migrations.
 */
export function deserializeProject(file: ProjectFile): {
  elements: CanvasElement[];
  elementCounter: Record<ElementType, number>;
  canvasSettings: CanvasSettings;
  snapEnabled: boolean;
  snapToGrid: boolean;
  snapToElements: boolean;
  snapUnit: number;
  zoomStep: number;
  projectName: string;
} {
  // Run version migration first
  const migrated = migrateProject(file);

  // Build asset lookup map
  const assetLookup = new Map<string, string>();
  for (const asset of migrated.assets.images) {
    assetLookup.set(asset.id, asset.data);
  }

  // Deep clone using structuredClone
  const elements: CanvasElement[] = structuredClone(migrated.elements);

  // Single-pass traversal to restore image assets
  walkElements(elements, (el) => {
    if (el.type === 'image') {
      const props = (el.properties as { type: 'image'; data: ImageProperties }).data;
      if (props.src && props.src.startsWith('asset://')) {
        const assetId = props.src.replace('asset://', '');
        const assetData = assetLookup.get(assetId);
        props.src = assetData ?? '';
      }
    }
  });

  // Validate and provide defaults for canvas settings
  const canvasSettings: CanvasSettings = {
    pageWidth: migrated.canvas.pageWidth ?? 794,
    pageHeight: migrated.canvas.pageHeight ?? 1123,
    pageBackgroundColor: migrated.canvas.pageBackgroundColor ?? '#ffffff',
    marginPreset: migrated.canvas.marginPreset ?? 'normal',
    marginTop: migrated.canvas.marginTop ?? 50,
    marginBottom: migrated.canvas.marginBottom ?? 50,
    marginLeft: migrated.canvas.marginLeft ?? 50,
    marginRight: migrated.canvas.marginRight ?? 50,
    marginGuideline: {
      show: migrated.canvas.marginGuideline?.show ?? true,
      color: migrated.canvas.marginGuideline?.color ?? '#ec4899',
      thickness: migrated.canvas.marginGuideline?.thickness ?? 1,
      style: migrated.canvas.marginGuideline?.style ?? 'dashed',
      opacity: migrated.canvas.marginGuideline?.opacity ?? 40,
    },
  };

  // Validate and provide defaults for settings
  const settings = migrated.settings ?? {};

  return {
    elements,
    elementCounter: migrated.elementCounter ?? { text: 0, table: 0, image: 0, line: 0, rectangle: 0, ellipse: 0 },
    canvasSettings,
    snapEnabled: settings.snapEnabled ?? true,
    snapToGrid: settings.snapToGrid ?? false,
    snapToElements: settings.snapToElements ?? true,
    snapUnit: settings.snapUnit ?? 10,
    zoomStep: settings.zoomStep ?? 5,
    projectName: migrated.projectName ?? 'Untitled Project',
  };
}

// ─── Version Migration ──────────────────────────────────────────────────────

function parseVersion(v: string): [number, number, number] {
  const parts = v.split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareVersions(a: string, b: string): number {
  const [aMaj, aMin, aPatch] = parseVersion(a);
  const [bMaj, bMin, bPatch] = parseVersion(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPatch - bPatch;
}

/**
 * Ensure an effects object has all required sub-objects.
 * Shared by both rectangle and ellipse migration.
 */
function ensureEffects(props: { effects?: typeof DEFAULT_EFFECTS }): void {
  if (!props.effects) {
    props.effects = { ...DEFAULT_EFFECTS };
  } else {
    if (!props.effects.gradient) props.effects.gradient = { ...DEFAULT_EFFECTS.gradient };
    if (!props.effects.shadow) props.effects.shadow = { ...DEFAULT_EFFECTS.shadow };
    if (!props.effects.reflection) props.effects.reflection = { ...DEFAULT_EFFECTS.reflection };
    if (!props.effects.glow) props.effects.glow = { ...DEFAULT_EFFECTS.glow };
  }
}

/**
 * Migrate a project file from its saved version to the current app version.
 * Returns a deep-cloned, migrated project file.
 *
 * Uses a single-pass element traversal for all per-element migrations,
 * combining what was previously multiple separate iterations.
 */

/**
 * Sanitize untrusted element data from a loaded project file. This is the
 * trust boundary — it runs during migration (before any element reaches the
 * store or a renderer) and strips XSS payloads from:
 *  - text element `content` (rendered via dangerouslySetInnerHTML / innerHTML)
 *  - gradient `stops[].color` / `pictureSrc` (interpolated into SVG markup)
 *  - shadow / glow `color` (used in CSS, defense-in-depth)
 *  - table cell text content (rendered as cell innerHTML)
 *
 * See src/lib/sanitize.ts for the per-field sanitizers.
 */
function sanitizeElement(el: CanvasElement): void {
  if (!el.properties) return;

  if (el.type === 'text') {
    const props = (el.properties as { type: 'text'; data: TextProperties }).data;
    if (props) {
      props.content = sanitizeHtmlContent(props.content);
      props.color = sanitizeColor(props.color, '#1a1a1a');
    }
  } else if (el.type === 'table') {
    const props = (el.properties as { type: 'table'; data: TableProperties }).data;
    if (props) {
      // Sanitize cell text content — table cells are rendered as innerHTML.
      if (Array.isArray(props.cellData)) {
        props.cellData = props.cellData.map((row: unknown): string[] => {
          if (!Array.isArray(row)) return [];
          return row.map((cell: unknown) => sanitizeHtmlContent(String(cell ?? '')));
        });
      }
      // Sanitize cell override colors.
      if (props.cellOverrides && typeof props.cellOverrides === 'object') {
        for (const key of Object.keys(props.cellOverrides)) {
          const ov = (props.cellOverrides as Record<string, Record<string, unknown>>)[key];
          if (ov && typeof ov === 'object') {
            if ('bgColor' in ov) ov.bgColor = sanitizeColor(ov.bgColor, '#ffffff');
            if ('color' in ov) ov.color = sanitizeColor(ov.color, '#1a1a1a');
          }
        }
      }
      if (props.rowBgColors && typeof props.rowBgColors === 'object') {
        for (const key of Object.keys(props.rowBgColors)) {
          (props.rowBgColors as Record<string, string>)[key] = sanitizeColor(
            (props.rowBgColors as Record<string, string>)[key], '#ffffff'
          );
        }
      }
      if (props.colBgColors && typeof props.colBgColors === 'object') {
        for (const key of Object.keys(props.colBgColors)) {
          (props.colBgColors as Record<string, string>)[key] = sanitizeColor(
            (props.colBgColors as Record<string, string>)[key], '#ffffff'
          );
        }
      }
    }
  } else if (el.type === 'image') {
    const props = (el.properties as { type: 'image'; data: ImageProperties }).data;
    if (props) {
      // Image src must be a safe data/blob/http URL — sanitize to reject
      // javascript: / vbscript: and anything that could break out of an attr.
      props.src = sanitizePictureSrc(props.src);
      props.borderColor = sanitizeColor(props.borderColor, '#d1d5db');
      sanitizeEffects(props.effects);
    }
  } else if (el.type === 'rectangle') {
    const props = (el.properties as { type: 'rectangle'; data: RectangleProperties }).data;
    if (props) {
      props.fill = sanitizeColor(props.fill, 'transparent');
      props.borderColor = sanitizeColor(props.borderColor, '#1a1a1a');
      sanitizeEffects(props.effects);
    }
  } else if (el.type === 'ellipse') {
    const props = (el.properties as { type: 'ellipse'; data: EllipseProperties }).data;
    if (props) {
      props.fill = sanitizeColor(props.fill, 'transparent');
      props.borderColor = sanitizeColor(props.borderColor, '#1a1a1a');
      sanitizeEffects(props.effects);
    }
  } else if (el.type === 'line') {
    const props = (el.properties as { type: 'line'; data: LineProperties }).data;
    if (props) {
      props.strokeColor = sanitizeColor(props.strokeColor, '#1a1a1a');
    }
  }
}

/** Sanitize the color/pictureSrc fields inside a RectangleEffects object. */
function sanitizeEffects(effects: RectangleEffects | undefined): void {
  if (!effects) return;
  if (effects.gradient) {
    const g = effects.gradient;
    if (g.type === 'picture') {
      g.pictureSrc = sanitizePictureSrc(g.pictureSrc);
    }
    if (Array.isArray(g.stops)) {
      g.stops = g.stops.map((s) => ({
        color: sanitizeColor(s.color, '#3b82f6'),
        position: typeof s.position === 'number' ? Math.max(0, Math.min(100, s.position)) : 0,
        opacity: sanitizeOpacity(s.opacity, 1),
      }));
    }
  }
  if (effects.shadow) {
    effects.shadow.color = sanitizeColor(effects.shadow.color, '#000000');
    effects.shadow.opacity = sanitizeOpacity(effects.shadow.opacity, 0.3);
  }
  if (effects.glow) {
    effects.glow.color = sanitizeColor(effects.glow.color, '#3b82f6');
    effects.glow.opacity = sanitizeOpacity(effects.glow.opacity, 0.5);
  }
}

export function migrateProject(file: ProjectFile): ProjectFile {
  // Deep clone using structuredClone
  const result: ProjectFile = structuredClone(file);

  const fileVersion = result.appVersion || '0.0.0';

  // If file version is newer than current, we still try to load it
  // but no migrations are needed (forward compat best-effort)
  if (compareVersions(fileVersion, APP_VERSION) > 0) {
    console.warn(
      `Project file version ${fileVersion} is newer than app version ${APP_VERSION}. Loading with best-effort compatibility.`
    );
    // Security: version-specific migrations are skipped, but sanitization is
    // NOT a migration — it's the trust boundary for every innerHTML sink
    // downstream (canvas, preview, PDF export). A file claiming a newer
    // appVersion is still untrusted input and must never bypass it.
    if (result.elements) {
      walkElements(result.elements, (el) => sanitizeElement(el));
    }
    return result;
  }

  // --- Top-level structure migrations ---

  // Migration: ensure elementCounter has all required keys
  if (!result.elementCounter) {
    result.elementCounter = { text: 0, table: 0, image: 0, line: 0, rectangle: 0, ellipse: 0, group: 0 };
  }
  const counter = result.elementCounter;
  if (counter.text === undefined) counter.text = 0;
  if (counter.table === undefined) counter.table = 0;
  if (counter.image === undefined) counter.image = 0;
  if (counter.line === undefined) counter.line = 0;
  if (counter.rectangle === undefined) counter.rectangle = 0;
  if (counter.ellipse === undefined) counter.ellipse = 0;
  if (counter.group === undefined) counter.group = 0;

  // Migration: ensure settings object exists
  if (!result.settings) {
    result.settings = {
      snapEnabled: true,
      snapToGrid: false,
      snapToElements: true,
      snapUnit: 10,
      zoomStep: 5,
    };
  }

  // Migration: ensure assets object exists
  if (!result.assets) {
    result.assets = { images: [] };
  }
  if (!result.assets.images) {
    result.assets.images = [];
  }

  // Migration: ensure canvas settings has all fields
  if (!result.canvas) {
    result.canvas = {
      pageWidth: 794,
      pageHeight: 1123,
      pageBackgroundColor: '#ffffff',
      marginPreset: 'normal',
      marginTop: 50,
      marginBottom: 50,
      marginLeft: 50,
      marginRight: 50,
      marginGuideline: {
        show: true,
        color: '#ec4899',
        thickness: 1,
        style: 'dashed',
        opacity: 40,
      },
    };
  }
  if (!result.canvas.marginGuideline) {
    result.canvas.marginGuideline = {
      show: true,
      color: '#ec4899',
      thickness: 1,
      style: 'dashed',
      opacity: 40,
    };
  }

  // --- Combined single-pass element migration ---
  // Previously this was done with a top-level loop + a separate recursive
  // migrateChildren function. Now we use walkElements for a single traversal.

  if (result.elements) {
    walkElements(result.elements, (el) => {
      // Ensure visible and locked fields
      if (el.visible === undefined) el.visible = true;
      if (el.locked === undefined) el.locked = false;
      if (!el.name) el.name = `${el.type} element`;

      // Ensure group elements have children array
      if (el.type === 'group' && !el.children) {
        el.children = [];
      }

      // Migrate table properties: old showOuterBorder -> new per-side borders + all defaults
      if (el.type === 'table') {
        const props = (el.properties as { type: 'table'; data: TableProperties }).data;
        if (props) {
          const legacyOuter = (props as unknown as Record<string, unknown>).showOuterBorder;
          const legacyInner = (props as unknown as Record<string, unknown>).showInnerBorder;

          if (props.showBorderTop === undefined && legacyOuter !== undefined) {
            props.showBorderTop = !!legacyOuter;
          }
          if (props.showBorderRight === undefined && legacyOuter !== undefined) {
            props.showBorderRight = !!legacyOuter;
          }
          if (props.showBorderBottom === undefined && legacyOuter !== undefined) {
            props.showBorderBottom = !!legacyOuter;
          }
          if (props.showBorderLeft === undefined && legacyOuter !== undefined) {
            props.showBorderLeft = !!legacyOuter;
          }
          if (props.showInnerBorders === undefined && legacyInner !== undefined) {
            props.showInnerBorders = !!legacyInner;
          }

          // Ensure defaults for new per-side fields
          if (props.showBorderTop === undefined) props.showBorderTop = true;
          if (props.showBorderRight === undefined) props.showBorderRight = true;
          if (props.showBorderBottom === undefined) props.showBorderBottom = true;
          if (props.showBorderLeft === undefined) props.showBorderLeft = true;
          if (props.showInnerBorders === undefined) props.showInnerBorders = true;

          // Ensure cornerRadius exists
          if (!props.cornerRadius) {
            props.cornerRadius = { mode: 'linked', all: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
          }

          // Ensure cellOverrides exists
          if (!props.cellOverrides) props.cellOverrides = {};
          if (!props.rowBgColors) props.rowBgColors = {};
          if (!props.colBgColors) props.colBgColors = {};
          // Ensure default table-level font family (added after initial release)
          if (!props.fontFamily) props.fontFamily = 'Inter, sans-serif';
          if (!props.cellData) {
            props.cellData = [];
            for (let r = 0; r < (props.rows || 4); r++) {
              props.cellData.push(Array(props.cols || 3).fill(''));
            }
          }
        }
      }

      // Ensure image properties have all fields
      if (el.type === 'image') {
        const props = (el.properties as { type: 'image'; data: ImageProperties }).data;
        if (props) {
          if (props.src === undefined) props.src = '';
          if (!props.objectFit) props.objectFit = 'contain';
          if (props.borderRadius === undefined) props.borderRadius = 0;
          if (props.opacity === undefined) props.opacity = 1;
          if (props.borderWidth === undefined) props.borderWidth = 0;
          if (!props.borderColor) props.borderColor = '#d1d5db';
        }
      }

      // Ensure text properties have all fields
      if (el.type === 'text') {
        const props = (el.properties as { type: 'text'; data: TextProperties }).data;
        if (props) {
          if (props.content === undefined) props.content = '';
          if (props.contentJson === undefined) props.contentJson = null;
          if (props.fontSize === undefined) props.fontSize = 16;
          if (!props.fontFamily) props.fontFamily = 'Inter, sans-serif';
          if (!props.fontWeight) props.fontWeight = 'normal';
          if (!props.fontStyle) props.fontStyle = 'normal';
          if (!props.textDecoration) props.textDecoration = 'none';
          if (!props.color) props.color = '#1a1a1a';
          if (!props.textAlign) props.textAlign = 'left';
          if (props.lineHeight === undefined) props.lineHeight = 1.5;
          if (props.letterSpacing === undefined) props.letterSpacing = 0;
          if (props.opacity === undefined) props.opacity = 1;
        }
      }

      // Ensure line properties have all fields
      if (el.type === 'line') {
        const props = (el.properties as { type: 'line'; data: LineProperties }).data;
        if (props) {
          if (props.strokeWidth === undefined) props.strokeWidth = 2;
          if (!props.strokeColor) props.strokeColor = '#1a1a1a';
          if (!props.strokeStyle) props.strokeStyle = 'solid';
          if (props.opacity === undefined) props.opacity = 1;
          if (!props.lineCap) props.lineCap = 'butt';
        }
      }

      // Ensure rectangle properties have all fields
      if (el.type === 'rectangle') {
        const props = (el.properties as { type: 'rectangle'; data: RectangleProperties }).data;
        if (props) {
          if (props.fill === undefined) props.fill = 'transparent';
          if (props.borderWidth === undefined) props.borderWidth = 2;
          if (!props.borderColor) props.borderColor = '#1a1a1a';
          if (!props.borderStyle) props.borderStyle = 'solid';
          if (props.borderRadius === undefined) props.borderRadius = 0;
          if (props.opacity === undefined) props.opacity = 1;
          ensureEffects(props);
        }
      }

      // Ensure ellipse properties have all fields
      if (el.type === 'ellipse') {
        const props = (el.properties as { type: 'ellipse'; data: EllipseProperties }).data;
        if (props) {
          if (props.fill === undefined) props.fill = 'transparent';
          if (props.borderWidth === undefined) props.borderWidth = 2;
          if (!props.borderColor) props.borderColor = '#1a1a1a';
          if (!props.borderStyle) props.borderStyle = 'solid';
          if (props.opacity === undefined) props.opacity = 1;
          ensureEffects(props);
        }
      }

      // ── Security: sanitize untrusted content from the file ───────────────
      // Runs AFTER all migrations so it operates on the final, defaulted
      // property values. This is the trust boundary — everything downstream
      // (store, renderers, dangerouslySetInnerHTML) receives safe data.
      sanitizeElement(el);
    });
  }

  // Update to current version after all migrations
  result.appVersion = APP_VERSION;

  return result;
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a parsed project file structure.
 * Optimized to minimize temporary allocations — errors/warnings are
 * pushed directly to pre-allocated arrays with no intermediate objects.
 */
export function validateProjectFile(data: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['File does not contain valid JSON object'], warnings: [] };
  }

  const file = data as Record<string, unknown>;

  // Check required top-level fields — use direct typeof checks, no temp vars
  if (!file.appVersion || typeof file.appVersion !== 'string') {
    errors.push('Missing or invalid appVersion field');
  }

  if (!file.projectName || typeof file.projectName !== 'string') {
    warnings.push('Missing projectName, will use default');
  }

  if (!Array.isArray(file.elements)) {
    errors.push('Missing or invalid elements array');
  }

  if (!file.canvas || typeof file.canvas !== 'object') {
    errors.push('Missing or invalid canvas settings');
  }

  // Check element structure — inline validation, no intermediate element objects
  if (Array.isArray(file.elements)) {
    const len = file.elements.length;
    for (let i = 0; i < len; i++) {
      const el = file.elements[i] as Record<string, unknown> | undefined;
      if (!el) {
        errors.push(`Element ${i}: null or undefined`);
        continue;
      }
      if (!el.id) errors.push(`Element ${i}: missing id`);
      if (!el.type) errors.push(`Element ${i}: missing type`);
      if (!el.properties) errors.push(`Element ${i}: missing properties`);
      if (typeof el.x !== 'number') errors.push(`Element ${i}: missing or invalid x`);
      if (typeof el.y !== 'number') errors.push(`Element ${i}: missing or invalid y`);
    }
  }

  // Version compatibility warning
  if (file.appVersion && typeof file.appVersion === 'string') {
    if (compareVersions(file.appVersion, APP_VERSION) > 0) {
      warnings.push(
        `File version ${file.appVersion} is newer than app version ${APP_VERSION}. Some features may not work correctly.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Compression Helpers ─────────────────────────────────────────────────────

/**
 * Compress a string with gzip (pako) and wrap with a magic header
 * so we can detect compressed files on load.
 */
function compressProject(json: string): Uint8Array {
  const encoded = new TextEncoder().encode(json);
  const compressed = pako.gzip(encoded);
  const magic = new TextEncoder().encode(MJC_COMPRESSED_MAGIC);
  const result = new Uint8Array(magic.length + compressed.length);
  result.set(magic, 0);
  result.set(compressed, magic.length);
  return result;
}

/**
 * Decompress a project file. Detects the magic header; if present,
 * decompresses with pako. Otherwise returns the raw string as-is
 * (backwards compatible with uncompressed .mjc files).
 *
 * Recognizes both the current MJCGZ01 magic and the legacy ISHAGZ01 magic
 * from older .isha files, so existing projects keep opening after the rename.
 */
function decompressProject(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Try each known magic header (current + legacy).
  for (const magicStr of [MJC_COMPRESSED_MAGIC, LEGACY_ISHA_COMPRESSED_MAGIC]) {
    const magicLen = magicStr.length;
    if (bytes.length <= magicLen) continue;
    let matches = true;
    for (let i = 0; i < magicLen; i++) {
      if (bytes[i] !== magicStr.charCodeAt(i)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      const payload = bytes.slice(magicLen);
      const decompressed = pako.ungzip(payload);
      return new TextDecoder().decode(decompressed);
    }
  }

  // Not compressed — treat as plain UTF-8 JSON
  return new TextDecoder().decode(bytes);
}

// ─── Browser File Operations ────────────────────────────────────────────────

/**
 * Save a project file by triggering a browser download.
 * Uses gzip compression for large projects to reduce file size.
 */
export function saveProjectToFile(project: ProjectFile, filename?: string): void {
  const json = JSON.stringify(project, null, 2);
  const rawBytes = new TextEncoder().encode(json);
  const fname = filename || `${project.projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}.mjc`;

  let blob: Blob;
  if (rawBytes.length > COMPRESSION_THRESHOLD) {
    // Compress large files
    const compressed = compressProject(json);
    blob = new Blob([compressed as unknown as BlobPart], { type: 'application/octet-stream' });
  } else {
    // Small files — no compression
    blob = new Blob([json], { type: 'application/json' });
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fname;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Open a file picker to load a .mjc project file.
 * Returns a Promise that resolves with the parsed ProjectFile.
 *
 * Uses async FileReader.readAsArrayBuffer for better performance
 * with large files, and auto-detects compressed files.
 */
export function loadProjectFromFile(): Promise<{
  project: ProjectFile;
  validation: ValidationResult;
  rawFilename: string;
}> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mjc';

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }

      // Use async FileReader.readAsArrayBuffer for better performance
      const reader = new FileReader();

      reader.onload = () => {
        try {
          const buffer = reader.result as ArrayBuffer;
          const text = decompressProject(buffer);
          const parsed = JSON.parse(text);

          // Validate the structure
          const validation = validateProjectFile(parsed);

          if (!validation.valid) {
            reject(new Error(`Invalid project file:\n${validation.errors.join('\n')}`));
            return;
          }

          // Ensure it has the right shape for a ProjectFile
          const project = parsed as ProjectFile;

          resolve({
            project,
            validation,
            rawFilename: file.name,
          });
        } catch (err) {
          reject(new Error(`Failed to read project file: ${err instanceof Error ? err.message : String(err)}`));
        }
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };

      reader.readAsArrayBuffer(file);
    };

    input.oncancel = () => {
      reject(new Error('File selection cancelled'));
    };

    // Trigger the file picker
    input.click();
  });
}

// ─── File System Access API (Save As dialog) ────────────────────────────────

/**
 * Check if the File System Access API is supported.
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

/**
 * Serialize and optionally compress a project for saving.
 * Shared by both File System Access and fallback save paths.
 */
function serializeForSave(project: ProjectFile): { data: string | Uint8Array; type: string } {
  const json = JSON.stringify(project, null, 2);
  const rawBytes = new TextEncoder().encode(json);

  if (rawBytes.length > COMPRESSION_THRESHOLD) {
    return { data: compressProject(json), type: 'application/octet-stream' };
  }
  return { data: json, type: 'application/json' };
}

/**
 * Save a project file using the native OS Save As dialog (File System Access API).
 * Returns the FileSystemFileHandle for future Save operations.
 * Falls back to blob download if the API is not supported.
 * Uses gzip compression for large projects.
 */
export async function saveProjectAsWithDialog(
  project: ProjectFile,
  suggestedName?: string
): Promise<{ fileHandle: FileSystemFileHandle | null; filename: string; savedToHandle: boolean } | null> {
  const defaultName = suggestedName || `${project.projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}.mjc`;

  if (isFileSystemAccessSupported()) {
    try {
      const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
        suggestedName: defaultName,
        types: [
          {
            description: 'MJC Invoice Project',
            accept: {
              'application/json': ['.mjc'],
            },
          },
        ],
      });

      const { data } = serializeForSave(project);
      const writable = await handle.createWritable();
      await writable.write(data as unknown as FileSystemWriteChunkType);
      await writable.close();

      return { fileHandle: handle, filename: handle.name, savedToHandle: true };
    } catch (err: unknown) {
      // User cancelled the dialog
      if (err instanceof Error && err.name === 'AbortError') {
        return null;
      }
      // Other errors — fall through to fallback
      console.warn('File System Access API failed, falling back to download:', err);
    }
  }

  // Fallback: prompt for filename then use blob download. For Save As this is
  // a legitimate new-file save (the user chose the name), just without a
  // persistent handle for future Ctrl+S.
  const name = prompt('Enter file name:', defaultName.replace('.mjc', ''));
  if (!name) return null;

  const filename = name.endsWith('.mjc') ? name : `${name}.mjc`;
  saveProjectToFile(project, filename);

  return { fileHandle: null, filename, savedToHandle: false };
}

/**
 * Save to an existing file handle (for Ctrl+S after Save As).
 * Falls back to blob download if no handle is available.
 * Uses gzip compression for large projects.
 *
 * Returns `savedToHandle: true` only when the file on disk was actually
 * written. When it falls back to a download (write failed or no handle),
 * `savedToHandle` is false so the caller can avoid clearing isDirty /
 * fileHandle and warn the user that their disk file is unchanged.
 */
export async function saveProjectToHandle(
  project: ProjectFile,
  fileHandle: FileSystemFileHandle | null,
  fallbackFilename?: string
): Promise<{ fileHandle: FileSystemFileHandle | null; filename: string; savedToHandle: boolean }> {
  // If we have a file handle, write directly to it
  if (fileHandle) {
    try {
      const { data } = serializeForSave(project);
      const writable = await fileHandle.createWritable();
      await writable.write(data as unknown as FileSystemWriteChunkType);
      await writable.close();
      return { fileHandle, filename: fileHandle.name, savedToHandle: true };
    } catch (err) {
      console.warn('Failed to write to file handle, falling back to download:', err);
    }
  }

  // Fallback: blob download. The file on disk was NOT updated.
  const filename = fallbackFilename || `${project.projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}.mjc`;
  saveProjectToFile(project, filename);
  return { fileHandle: null, filename, savedToHandle: false };
}

/**
 * Open a file using the File System Access API (Open dialog).
 * Falls back to input element if not supported.
 * Auto-detects and decompresses gzip-compressed files.
 */
export async function openProjectWithDialog(): Promise<{
  project: ProjectFile;
  validation: ValidationResult;
  rawFilename: string;
  fileHandle: FileSystemFileHandle | null;
}> {
  if (isFileSystemAccessSupported()) {
    try {
      const [handle] = await (window as unknown as { showOpenFilePicker: (opts: unknown) => Promise<[FileSystemFileHandle]> }).showOpenFilePicker({
        types: [
          {
            description: 'MJC Invoice Project',
            accept: {
              'application/json': ['.mjc'],
            },
          },
        ],
        multiple: false,
      });

      const file = await handle.getFile();
      // Use arrayBuffer for consistent handling of compressed files
      const buffer = await file.arrayBuffer();
      const text = decompressProject(buffer);
      const parsed = JSON.parse(text);
      const validation = validateProjectFile(parsed);

      if (!validation.valid) {
        throw new Error(`Invalid project file:\n${validation.errors.join('\n')}`);
      }

      return {
        project: parsed as ProjectFile,
        validation,
        rawFilename: handle.name,
        fileHandle: handle,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('File selection cancelled');
      }
      // Fall through to fallback
      console.warn('File System Access API open failed, falling back to input:', err);
    }
  }

  // Fallback: use the legacy input element approach
  const result = await loadProjectFromFile();
  return {
    ...result,
    fileHandle: null,
  };
}
