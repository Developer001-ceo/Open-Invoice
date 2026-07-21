/**
 * Recent Projects management using localStorage.
 *
 * Stores a list of recently opened/saved projects with their
 * thumbnails and metadata. Used by the Open Project dialog
 * to display recent projects.
 */

import type { ProjectFile } from './project-file';
import type { PreviewThumbnail } from './thumbnail';

const STORAGE_KEY = 'openinvoice-recent-projects';
const MAX_RECENT = 20;

export interface RecentProjectEntry {
  projectName: string;
  filename: string;
  lastOpened: number; // epoch timestamp
  thumbnail?: PreviewThumbnail;
  pageCount: number; // number of elements
}

/**
 * Get the list of recent projects from localStorage.
 */
export function getRecentProjects(): RecentProjectEntry[] {
  // SSR guard.
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validate each entry's shape so a corrupt/null entry can't crash the
    // Open Project dialog when it accesses .filename / .projectName etc.
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

/** Type guard: ensures a parsed entry has the required string/number fields. */
function isValidEntry(entry: unknown): entry is RecentProjectEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.projectName === 'string' &&
    typeof e.filename === 'string' &&
    typeof e.lastOpened === 'number' &&
    (typeof e.pageCount === 'number' || e.pageCount === undefined)
  );
}

/**
 * Add or update a project in the recent projects list.
 * Moves it to the top if it already exists (by filename).
 */
export function addRecentProject(project: ProjectFile, filename: string): void {
  try {
    const projects = getRecentProjects();

    // Remove existing entry with same filename
    const filtered = projects.filter((p) => p.filename !== filename);

    // Add new entry at the top
    const entry: RecentProjectEntry = {
      projectName: project.projectName || 'Untitled Project',
      filename,
      lastOpened: Date.now(),
      // Thumbnail is generated separately via generateThumbnail() — not
      // stored in the ProjectFile itself.
      pageCount: project.elements?.length ?? 0,
    };

    filtered.unshift(entry);

    // Limit to MAX_RECENT
    const trimmed = filtered.slice(0, MAX_RECENT);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.warn('Failed to update recent projects:', err);
  }
}

/**
 * Remove a project from the recent projects list.
 */
export function removeRecentProject(filename: string): void {
  try {
    const projects = getRecentProjects();
    const filtered = projects.filter((p) => p.filename !== filename);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.warn('Failed to remove recent project:', err);
  }
}

/**
 * Clear all recent projects.
 */
export function clearRecentProjects(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to clear recent projects:', err);
  }
}

/**
 * Format a timestamp to a relative or short date string.
 */
export function formatLastOpened(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 30) {
    return new Date(timestamp).toLocaleDateString();
  } else if (days > 0) {
    return `${days}d ago`;
  } else if (hours > 0) {
    return `${hours}h ago`;
  } else if (minutes > 0) {
    return `${minutes}m ago`;
  } else {
    return 'Just now';
  }
}
