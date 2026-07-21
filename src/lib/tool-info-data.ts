import { ElementType } from '@/lib/element-types';

// ─────────────────────────────────────────────────────────────────────────────
// Per-tool shortcut reference data, shown in the ToolInfoDialog when the user
// clicks the "ⓘ" info icon above a dropped element.
//
// These are the tool-specific interactions (corner-drag modifiers for
// rectangles, cell-selection for tables, angle-snap for lines, etc.) that
// don't belong in the general on-canvas shortcuts overlay. Each tool type can
// have a title, a short description, and one or more groups of shortcuts.
// Tools without specific interactions fall back to DEFAULT_TOOL_INFO.
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolShortcutEntry {
  keys: string;
  label: string;
}

export interface ToolShortcutGroup {
  title: string;
  entries: ToolShortcutEntry[];
}

export interface ToolInfo {
  title: string;
  description: string;
  groups: ToolShortcutGroup[];
}

export const TOOL_INFO: Partial<Record<ElementType, ToolInfo>> = {
  rectangle: {
    title: 'Rectangle',
    description:
      'Rectangles support independent corner points — drag a corner handle to deform the shape. Hold modifier keys while dragging a corner to constrain how the points align.',
    groups: [
      {
        title: 'Corner Points',
        entries: [
          { keys: 'Alt', label: 'Move a single corner point freely' },
          { keys: 'Alt + Ctrl', label: 'Align points vertically' },
          { keys: 'Alt + Shift', label: 'Align points horizontally' },
          { keys: 'Alt + Shift + Ctrl', label: 'Align points both vertically & horizontally' },
        ],
      },
    ],
  },
  table: {
    title: 'Table',
    description:
      'Tables are made of cells. Hold Alt to enter cell-selection mode, then click or drag to select individual cells.',
    groups: [
      {
        title: 'Cells',
        entries: [
          { keys: 'Alt', label: 'Click to toggle a cell' },
          { keys: 'Alt + Drag', label: 'Drag to multi-select cells' },
          { keys: 'Del', label: 'Remove selected cells' },
        ],
      },
    ],
  },
  line: {
    title: 'Line',
    description:
      'Lines have two endpoints you can drag. Hold Shift while dragging an endpoint to snap the line to a clean angle.',
    groups: [
      {
        title: 'Endpoint Snapping',
        entries: [
          { keys: 'Shift', label: 'Snap horizontal, vertical, or 45°' },
        ],
      },
    ],
  },
};

const DEFAULT_TOOL_INFO: ToolInfo = {
  title: 'Element',
  description:
    'General element interactions. Click to select, drag to move, and use the handles to resize.',
  groups: [
    {
      title: 'General',
      entries: [
        { keys: 'Click', label: 'Select' },
        { keys: 'Drag', label: 'Move' },
        { keys: 'Del', label: 'Delete' },
        { keys: 'Ctrl + C / V', label: 'Copy / Paste' },
        { keys: 'Ctrl + D', label: 'Duplicate' },
        { keys: '← → ↑ ↓', label: 'Nudge' },
        { keys: 'Shift + Arrow', label: 'Nudge 10px' },
      ],
    },
  ],
};

export function getToolInfo(type: ElementType): ToolInfo {
  return TOOL_INFO[type] ?? DEFAULT_TOOL_INFO;
}
