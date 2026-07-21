/**
 * Custom TipTap extensions for the rich text editor.
 *
 * - ListStyleType: Adds list-style-type attribute to ordered and bullet lists
 *   (decimal, lower-alpha, upper-alpha, lower-roman, upper-roman, disc, circle, square)
 * - LetterSpacing: Adds per-selection letter-spacing via the TextStyle mark
 *
 * Note: FontSize is now provided by @tiptap/extension-text-style (v3+),
 * so we no longer need a custom FontSize extension.
 */

import { Extension } from '@tiptap/core';

// ─── ListStyleType Extension ──────────────────────────────────────────
// Adds a `listStyleType` attribute to ordered and bullet list nodes so
// the user can choose different numbering / bullet styles.

export type ListStyleOption =
  | 'decimal'
  | 'lower-alpha'
  | 'upper-alpha'
  | 'lower-roman'
  | 'upper-roman'
  | 'disc'
  | 'circle'
  | 'square';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    listStyleType: {
      setListStyleType: (style: ListStyleOption) => ReturnType;
    };
  }
}

export const ListStyleType = Extension.create({
  name: 'listStyleType',

  addOptions() {
    return {
      types: ['orderedList', 'bulletList'],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          listStyleType: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.style.listStyleType || null,
            renderHTML: (attributes: Record<string, string>) => {
              if (!attributes.listStyleType) return {};
              return { style: `list-style-type: ${attributes.listStyleType}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setListStyleType:
        (style: ListStyleOption) =>
        ({ chain }) => {
          return chain()
            .updateAttributes('orderedList', { listStyleType: style })
            .updateAttributes('bulletList', { listStyleType: style })
            .run();
        },
    };
  },
});

// ─── LetterSpacing Extension ──────────────────────────────────────────
// Adds per-selection letter-spacing as a TextStyle mark attribute.
// This allows users to apply different letter spacing to specific text
// selections, similar to how font size or font family works.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    letterSpacing: {
      setLetterSpacing: (spacing: string) => ReturnType;
      unsetLetterSpacing: () => ReturnType;
    };
  }
}

export const LetterSpacing = Extension.create({
  name: 'letterSpacing',

  addOptions() {
    return {
      types: ['textStyle'],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          letterSpacing: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.style.letterSpacing || null,
            renderHTML: (attributes: Record<string, string>) => {
              if (!attributes.letterSpacing) return {};
              return { style: `letter-spacing: ${attributes.letterSpacing}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLetterSpacing:
        (spacing: string) =>
        ({ chain }) => {
          return chain()
            .setMark('textStyle', { letterSpacing: spacing })
            .run();
        },
      unsetLetterSpacing:
        () =>
        ({ chain }) => {
          return chain()
            .setMark('textStyle', { letterSpacing: null })
            .removeEmptyTextStyle()
            .run();
        },
    };
  },
});
