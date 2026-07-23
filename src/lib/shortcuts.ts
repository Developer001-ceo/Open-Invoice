export interface ShortcutDefinition {
  id: string;
  label: string;
  category: string;
  defaultKeys: string;
  currentKeys: string;
}

const STORAGE_KEY = 'designer-shortcuts';

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // Edit
  { id: 'delete', label: 'Delete', category: 'Edit', defaultKeys: 'Delete', currentKeys: 'Delete' },
  { id: 'copy', label: 'Copy', category: 'Edit', defaultKeys: 'Ctrl+C', currentKeys: 'Ctrl+C' },
  { id: 'cut', label: 'Cut', category: 'Edit', defaultKeys: 'Ctrl+X', currentKeys: 'Ctrl+X' },
  { id: 'paste', label: 'Paste', category: 'Edit', defaultKeys: 'Ctrl+V', currentKeys: 'Ctrl+V' },
  { id: 'pasteInPlace', label: 'Paste in Place', category: 'Edit', defaultKeys: 'Ctrl+Shift+V', currentKeys: 'Ctrl+Shift+V' },
  { id: 'duplicate', label: 'Duplicate', category: 'Edit', defaultKeys: 'Ctrl+D', currentKeys: 'Ctrl+D' },
  { id: 'undo', label: 'Undo', category: 'Edit', defaultKeys: 'Ctrl+Z', currentKeys: 'Ctrl+Z' },
  { id: 'redo', label: 'Redo', category: 'Edit', defaultKeys: 'Ctrl+Shift+Z', currentKeys: 'Ctrl+Shift+Z' },
  { id: 'redoAlt', label: 'Redo (Alt)', category: 'Edit', defaultKeys: 'Ctrl+Y', currentKeys: 'Ctrl+Y' },
  { id: 'selectAll', label: 'Select All', category: 'Edit', defaultKeys: 'Ctrl+A', currentKeys: 'Ctrl+A' },
  { id: 'group', label: 'Group', category: 'Edit', defaultKeys: 'Ctrl+G', currentKeys: 'Ctrl+G' },
  { id: 'ungroup', label: 'Ungroup', category: 'Edit', defaultKeys: 'Ctrl+Shift+G', currentKeys: 'Ctrl+Shift+G' },
  // File
  { id: 'save', label: 'Save', category: 'File', defaultKeys: 'Ctrl+S', currentKeys: 'Ctrl+S' },
  { id: 'saveAs', label: 'Save As', category: 'File', defaultKeys: 'Ctrl+Shift+S', currentKeys: 'Ctrl+Shift+S' },
  { id: 'open', label: 'Open', category: 'File', defaultKeys: 'Ctrl+O', currentKeys: 'Ctrl+O' },
  { id: 'new', label: 'New Project', category: 'File', defaultKeys: 'Ctrl+N', currentKeys: 'Ctrl+N' },
  { id: 'exportPdf', label: 'Export PDF', category: 'File', defaultKeys: 'Ctrl+Shift+E', currentKeys: 'Ctrl+Shift+E' },
  // View
  { id: 'zoomIn', label: 'Zoom In', category: 'View', defaultKeys: 'Ctrl+=', currentKeys: 'Ctrl+=' },
  { id: 'zoomOut', label: 'Zoom Out', category: 'View', defaultKeys: 'Ctrl+-', currentKeys: 'Ctrl+-' },
  { id: 'resetZoom', label: 'Reset Zoom', category: 'View', defaultKeys: 'Ctrl+0', currentKeys: 'Ctrl+0' },
  { id: 'escape', label: 'Exit Group / Deselect', category: 'View', defaultKeys: 'Escape', currentKeys: 'Escape' },
];

/** Load shortcuts from localStorage, merging with defaults */
export function loadShortcuts(): ShortcutDefinition[] {
  // SSR guard — this function reads localStorage. Currently only called from
  // client-only contexts (Radix Dialog useState initializer), but guard so a
  // future refactor that renders during SSR won't crash.
  if (typeof window === 'undefined') return DEFAULT_SHORTCUTS.map(s => ({ ...s }));
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_SHORTCUTS.map(s => ({ ...s }));

    const customMap: Record<string, string> = JSON.parse(stored);
    return DEFAULT_SHORTCUTS.map(s => ({
      ...s,
      currentKeys: customMap[s.id] ?? s.defaultKeys,
    }));
  } catch {
    return DEFAULT_SHORTCUTS.map(s => ({ ...s }));
  }
}

/** Save a custom shortcut mapping */
export function saveShortcut(id: string, keys: string): ShortcutDefinition[] {
  const shortcuts = loadShortcuts();
  const idx = shortcuts.findIndex(s => s.id === id);
  if (idx >= 0) {
    shortcuts[idx].currentKeys = keys;
  }

  // Build custom map (only store overrides)
  const customMap: Record<string, string> = {};
  for (const s of shortcuts) {
    if (s.currentKeys !== s.defaultKeys) {
      customMap[s.id] = s.currentKeys;
    }
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customMap));
  } catch {
    // Ignore storage errors
  }

  return shortcuts;
}

/** Reset all shortcuts to defaults */
export function resetShortcuts(): ShortcutDefinition[] {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
  return DEFAULT_SHORTCUTS.map(s => ({ ...s }));
}

/** Get a shortcut's current keys by ID */
export function getShortcutKeys(id: string): string {
  const shortcuts = loadShortcuts();
  return shortcuts.find(s => s.id === id)?.currentKeys ?? '';
}

/** Parse a keyboard event into a shortcut string like "Ctrl+Shift+A" */
export function keyEventToString(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  let key = e.key;
  // Normalize special keys
  if (key === ' ') key = 'Space';
  else if (key === 'Escape') key = 'Escape';
  else if (key === 'Delete') key = 'Delete';
  else if (key === 'Backspace') key = 'Backspace';
  else if (key === 'Enter') key = 'Enter';
  else if (key === 'Tab') key = 'Tab';
  else if (key.startsWith('Arrow')) {
    key = key.replace('Arrow', '');
  }
  // Only add key if it's not a modifier
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key);
  }

  return parts.join('+');
}

/** Check if a keyboard event matches a shortcut by ID */
export function matchesShortcut(id: string, e: KeyboardEvent): boolean {
  const shortcutKeys = getShortcutKeys(id);
  if (!shortcutKeys) return false;

  const eventStr = keyEventToString(e);
  return eventStr === shortcutKeys;
}
