/**
 * localStorage-based auto-save & crash recovery for the designer.
 *
 * Periodically persists a serialized snapshot of the current project so that a
 * browser crash, accidental tab close, or power loss doesn't lose the user's
 * work. On the next app load, `loadAutosave()` returns the most recent
 * snapshot (if any) so the app can offer to restore it.
 *
 * Storage strategy:
 *  - localStorage (simple, synchronous, universally supported). We wrap every
 *    access in try/catch because localStorage can throw (private mode, quota
 *    exceeded, disabled). On any failure we degrade gracefully — auto-save is
 *    best-effort and never blocks the user.
 *  - Image data is already extracted into the project's `assets` array by
 *    serializeProject(), so large base64 blobs are deduplicated — but a project
 *    with many images can still exceed the ~5MB localStorage budget. When that
 *    happens we silently skip the save (the user still has manual Save).
 *
 * The snapshot includes the timestamp so the recovery prompt can show "from
 * 2 minutes ago" and so we can expire stale drafts.
 */

import { serializeProject, deserializeProject, ProjectFile } from './project-file';
import type { CanvasElement, ElementType } from './element-types';
import type { CanvasSettings } from '@/store/designer-store';

const STORAGE_KEY = 'open-invoice:autosave';
// Expire drafts older than 7 days — beyond that they're probably stale.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface AutosaveSnapshot {
  project: ProjectFile;
  savedAt: number; // epoch ms
}

/** Build a ProjectFile from raw store state (mirrors saveProject's serialization). */
export function buildProjectSnapshot(params: {
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
  return serializeProject(params);
}

/** Persist the given project as the auto-save draft. Best-effort: swallows
 *  storage errors (quota / private mode) so the editor is never blocked. */
export function saveAutosave(project: ProjectFile): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const snapshot: AutosaveSnapshot = { project, savedAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    // Most likely QuotaExceededError (project too big for ~5MB localStorage,
    // e.g. many large embedded images). Auto-save is best-effort — the user
    // can still use manual Save (File System Access / download).
    return false;
  }
}

/** Load and validate the most recent auto-save draft. Returns null if there is
 *  none, if it's expired (> 7 days), or if it fails to parse. */
export function loadAutosave(): AutosaveSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as AutosaveSnapshot;
    if (!parsed || typeof parsed.savedAt !== 'number' || !parsed.project) {
      return null;
    }

    // Expire stale drafts.
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    // Corrupt JSON or storage error — clear it so it doesn't keep failing.
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

/** Remove the auto-save draft (called after the user explicitly saves, starts
 *  a new project, or dismisses the recovery prompt). */
export function clearAutosave(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Deserialize an auto-saved ProjectFile back into store-ready state. */
export function deserializeAutosave(snapshot: AutosaveSnapshot) {
  return deserializeProject(snapshot.project);
}

/** Format the snapshot's age as a human-readable relative time for the
 *  recovery prompt (e.g. "2 minutes ago", "just now"). */
export function formatAutosaveAge(savedAt: number): string {
  const seconds = Math.floor((Date.now() - savedAt) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
