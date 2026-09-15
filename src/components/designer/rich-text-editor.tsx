'use client';

import React, { useCallback, useEffect, useRef, memo, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Strike from '@tiptap/extension-strike';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import Placeholder from '@tiptap/extension-placeholder';
import { properCapitalizeHTML } from '@/lib/utils';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  ChevronDown,
  Type,
  X,
} from 'lucide-react';
import { ListStyleType, LetterSpacing, type ListStyleOption } from '@/lib/tiptap-extensions';
import { EdgeSelection } from '@/lib/edge-selection';
import { TextProperties } from '@/lib/element-types';
import { useDesignerStore } from '@/store/designer-store';

// ─── Font family options ────────────────────────────────────────────────
// Imported from the shared catalog (src/lib/fonts.ts) so the Text tool,
// Table Cell Properties, and all card/panel dropdowns share one list.
import { FONT_FAMILIES, FONT_FAMILIES_GROUPED, DEFAULT_FONT_FAMILY } from '@/lib/fonts';

// ─── Font size options ──────────────────────────────────────────────────
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72];

// ─── List style type options ────────────────────────────────────────────
const LIST_STYLE_OPTIONS: { value: ListStyleOption; label: string; preview: string }[] = [
  { value: 'decimal', label: 'Decimal', preview: '1, 2, 3' },
  { value: 'lower-alpha', label: 'Lower Alpha', preview: 'a, b, c' },
  { value: 'upper-alpha', label: 'Upper Alpha', preview: 'A, B, C' },
  { value: 'lower-roman', label: 'Lower Roman', preview: 'i, ii, iii' },
  { value: 'upper-roman', label: 'Upper Roman', preview: 'I, II, III' },
];

const BULLET_STYLE_OPTIONS: { value: ListStyleOption; label: string; preview: string }[] = [
  { value: 'disc', label: 'Disc', preview: '●' },
  { value: 'circle', label: 'Circle', preview: '○' },
  { value: 'square', label: 'Square', preview: '■' },
];

// ─── Toolbar Button ─────────────────────────────────────────────────────
function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault(); // prevent blur
        e.stopPropagation();
        onClick();
      }}
      className={`p-1 rounded transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-muted text-foreground'
      }`}
      title={title}
    >
      {children}
    </button>
  );
}

// ─── Toolbar Divider ────────────────────────────────────────────────────
function ToolbarDivider() {
  return <div className="w-px h-5 bg-border mx-0.5 shrink-0" />;
}

// ─── Labeled Select (border-label dropdown) ────────────────────────────
// A <select> with a tiny label on its top border (like a fieldset legend).
// The dropdown shows the current value; the label identifies the feature.
export function LabeledSelect({
  label,
  value,
  onChange,
  onMouseDown,
  title,
  className = '',
  children,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLSelectElement>) => void;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`relative ${className}`}>
      <span className="absolute -top-1.5 left-1.5 text-[8px] text-muted-foreground bg-popover px-0.5 leading-none select-none pointer-events-none z-10">
        {label}
      </span>
      <select
        data-no-drag
        className="h-6 text-[10px] px-1 pt-0.5 border border-border rounded bg-background cursor-pointer w-full"
        value={value}
        onChange={onChange}
        onMouseDown={onMouseDown}
        title={title}
      >
        {children}
      </select>
    </div>
  );
}

// ─── Formatting Toolbar (exported for use in panel/floating-card) ───────
// This toolbar controls the canvas TipTap editor via the activeTextEditor ref.
interface FormattingToolbarProps {
  editor: any; // TipTap Editor instance — can be null
  baseProps?: TextProperties; // Element base properties — used to show default values in dropdowns
}

export const FormattingToolbar = memo(function FormattingToolbar({ editor, baseProps }: FormattingToolbarProps) {
  const [showListStyleMenu, setShowListStyleMenu] = useState(false);
  const listStyleMenuRef = useRef<HTMLDivElement>(null);
  const listStyleTriggerRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  // Force re-render when editor selection changes (so active states update)
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const handleSelectionUpdate = () => forceUpdate((v) => v + 1);
    editor.on('selectionUpdate', handleSelectionUpdate);
    editor.on('transaction', handleSelectionUpdate);
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
      editor.off('transaction', handleSelectionUpdate);
    };
  }, [editor]);

  // Close list style menu on outside click
  useEffect(() => {
    if (!showListStyleMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        listStyleMenuRef.current && !listStyleMenuRef.current.contains(e.target as Node) &&
        listStyleTriggerRef.current && !listStyleTriggerRef.current.contains(e.target as Node)
      ) {
        setShowListStyleMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showListStyleMenu]);

  // Compute menu position when it opens (portal renders at document body level
  // so it escapes any overflow:hidden / overflow:auto containers)
  useEffect(() => {
    if (showListStyleMenu && listStyleTriggerRef.current) {
      const rect = listStyleTriggerRef.current.getBoundingClientRect();
      const MENU_WIDTH = 160; // min-w-[140px] + padding/border
      const MENU_MARGIN = 8;
      let left = rect.left;
      // Clamp so the menu doesn't go off the right edge of the viewport
      if (left + MENU_WIDTH > window.innerWidth - MENU_MARGIN) {
        left = window.innerWidth - MENU_WIDTH - MENU_MARGIN;
      }
      // Clamp so it doesn't go off the left edge either
      if (left < MENU_MARGIN) left = MENU_MARGIN;
      setMenuPos({ top: rect.bottom + 4, left });
    } else {
      setMenuPos(null);
    }
  }, [showListStyleMenu]);

  if (!editor) {
    return (
      <div className="flex items-center justify-center py-3 text-[10px] text-muted-foreground italic" data-no-drag>
        Double-click a text element to start editing
      </div>
    );
  }

  const currentListStyle = editor.getAttributes('orderedList').listStyleType || 'decimal';
  const currentBulletStyle = editor.getAttributes('bulletList').listStyleType || 'disc';

  return (
    <div className="space-y-1.5 p-1.5 bg-popover border border-border rounded-lg select-none" data-no-drag>
      {/* Row 1: Text Style + Font + Color — wraps to prevent overflow */}
      <div className="flex items-center gap-0.5 flex-wrap">
        {/* Bold */}
        <ToolbarButton
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (Ctrl+B)"
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>

        {/* Italic */}
        <ToolbarButton
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (Ctrl+I)"
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>

        {/* Underline */}
        <ToolbarButton
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolbarButton>

        {/* Strikethrough */}
        <ToolbarButton
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Strikethrough"
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Font Size */}
        <LabeledSelect
          label="Size"
          value={(() => {
            const fs = editor.getAttributes('textStyle').fontSize;
            if (!fs) return '__default__';
            const num = parseInt(String(fs), 10);
            return FONT_SIZES.includes(num) ? String(num) : '__custom__';
          })()}
          onChange={(e) => {
            if (e.target.value === '__default__') {
              editor.chain().focus().unsetFontSize().run();
            } else {
              editor.chain().focus().setFontSize(`${e.target.value}px`).run();
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          title="Font Size"
          className="w-[60px]"
        >
          <option value="__default__">{baseProps ? `${baseProps.fontSize}px` : 'Default'}</option>
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}px
            </option>
          ))}
          <option value="__custom__">Custom</option>
        </LabeledSelect>

        {/* Font Family */}
        <LabeledSelect
          label="Font"
          value={editor.getAttributes('textStyle').fontFamily || '__default__'}
          onChange={(e) => {
            if (e.target.value === '__default__') {
              editor.chain().focus().unsetFontFamily().run();
            } else {
              editor.chain().focus().setFontFamily(e.target.value).run();
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          title="Font Family"
          className="max-w-[90px] min-w-[60px]"
        >
          <option value="__default__">{baseProps ? (FONT_FAMILIES.find(f => f.value === baseProps.fontFamily)?.label || baseProps.fontFamily) : 'Default'}</option>
          {FONT_FAMILIES_GROUPED.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((f) => (
                <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          ))}
        </LabeledSelect>

        <ToolbarDivider />

        {/* Text Color */}
        <label className="relative cursor-pointer" title="Text Color">
          <input
            type="color"
            data-no-drag
            className="absolute inset-0 opacity-0 cursor-pointer w-6 h-6"
            defaultValue={editor.getAttributes('textStyle').color || '#000000'}
            onInput={(e) => editor.chain().focus().setColor((e.target as HTMLInputElement).value).run()}
            onChange={(e) => editor.chain().focus().setColor((e.target as HTMLInputElement).value).run()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <div className="p-1 rounded hover:bg-muted">
            <Type className="h-3.5 w-3.5" />
            <div
              className="h-0.5 mt-0.5 rounded-full"
              style={{ backgroundColor: editor.getAttributes('textStyle').color || '#000000' }}
            />
          </div>
        </label>

        {/* Letter Spacing */}
        <LabeledSelect
          label="Spacing"
          value={(() => {
            const ls = editor.getAttributes('textStyle').letterSpacing;
            if (!ls) return '__default__';
            const num = parseFloat(String(ls));
            if (isNaN(num)) return '__default__';
            return String(num);
          })()}
          onChange={(e) => {
            if (e.target.value === '__default__') {
              editor.chain().focus().unsetLetterSpacing().run();
            } else {
              editor.chain().focus().setLetterSpacing(`${e.target.value}px`).run();
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          title="Letter Spacing"
          className="w-[72px]"
        >
          <option value="__default__">{baseProps ? `${baseProps.letterSpacing}px` : 'Default'}</option>
          {[-2, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map((s) => (
            <option key={s} value={s}>
              {s}px
            </option>
          ))}
        </LabeledSelect>
      </div>

      {/* Row 2: Alignment + Lists — wraps to prevent overflow */}
      <div className="flex items-center gap-0.5 flex-wrap">
        {/* Alignment — fall back to baseProps.textAlign when no inline override is active */}
        {(() => {
          const anyAlignActive =
            editor.isActive({ textAlign: 'left' }) ||
            editor.isActive({ textAlign: 'center' }) ||
            editor.isActive({ textAlign: 'right' }) ||
            editor.isActive({ textAlign: 'justify' });
          const fallbackAlign = baseProps?.textAlign ?? 'left';
          const effectiveAlign = (align: string) =>
            anyAlignActive ? editor.isActive({ textAlign: align }) : fallbackAlign === align;
          return (
            <>
              <ToolbarButton
                active={effectiveAlign('left')}
                onClick={() => editor.chain().focus().setTextAlign('left').run()}
                title="Align Left"
              >
                <AlignLeft className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                active={effectiveAlign('center')}
                onClick={() => editor.chain().focus().setTextAlign('center').run()}
                title="Align Center"
              >
                <AlignCenter className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                active={effectiveAlign('right')}
                onClick={() => editor.chain().focus().setTextAlign('right').run()}
                title="Align Right"
              >
                <AlignRight className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                active={effectiveAlign('justify')}
                onClick={() => editor.chain().focus().setTextAlign('justify').run()}
                title="Justify"
              >
                <AlignJustify className="h-3.5 w-3.5" />
              </ToolbarButton>
            </>
          );
        })()}

        <ToolbarDivider />

        {/* Bullet List */}
        <ToolbarButton
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet List"
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>

        {/* Ordered List with style selector */}
        <div className="relative">
          <div className="flex items-center">
            <ToolbarButton
              active={editor.isActive('orderedList')}
              onClick={() => {
                if (!editor.isActive('orderedList')) {
                  editor.chain().focus().toggleOrderedList().run();
                }
              }}
              title="Numbered List"
            >
              <ListOrdered className="h-3.5 w-3.5" />
            </ToolbarButton>
            <button
              ref={listStyleTriggerRef}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowListStyleMenu(!showListStyleMenu);
              }}
              className="p-0.5 rounded hover:bg-muted text-foreground"
              title="List Style"
            >
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
        {showListStyleMenu && menuPos && createPortal(
          <div
            ref={listStyleMenuRef}
            className="fixed bg-popover border border-border rounded-lg shadow-xl min-w-[140px] py-1"
            style={{ top: menuPos.top, left: menuPos.left, zIndex: 2147483647 }}
          >
            <div className="px-2 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
              Numbering
            </div>
            {LIST_STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                data-no-drag
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  editor.chain().focus().setListStyleType(opt.value).run();
                  setShowListStyleMenu(false);
                }}
                className={`w-full text-left px-2 py-1 text-[11px] hover:bg-accent flex items-center justify-between ${
                  currentListStyle === opt.value ? 'font-medium text-primary' : ''
                }`}
              >
                <span>{opt.label}</span>
                <span className="text-muted-foreground text-[10px]">{opt.preview}</span>
              </button>
            ))}
            <div className="border-t border-border my-1" />
            <div className="px-2 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
              Bullets
            </div>
            {BULLET_STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                data-no-drag
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!editor.isActive('bulletList')) {
                    editor.chain().focus().toggleBulletList().run();
                  }
                  editor.chain().focus().setListStyleType(opt.value).run();
                  setShowListStyleMenu(false);
                }}
                className={`w-full text-left px-2 py-1 text-[11px] hover:bg-accent flex items-center justify-between ${
                  currentBulletStyle === opt.value ? 'font-medium text-primary' : ''
                }`}
              >
                <span>{opt.label}</span>
                <span className="text-muted-foreground text-[10px]">{opt.preview}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
      </div>
    </div>
  );
});

// ─── Non-Editing Renderer ───────────────────────────────────────────────
interface RichTextRendererProps {
  props: TextProperties;
  /** Scroll offset to start at (carried over from the TipTap editor on exit).
   *  The renderer will smoothly animate from this position back to 0. */
  initialScrollTop?: number;
}

export const RichTextRenderer = memo(function RichTextRenderer({ props, initialScrollTop = 0 }: RichTextRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // For 'capitalize', apply proper title case via JS (first letter uppercase, rest lowercase)
  // because CSS text-transform: capitalize only uppercases first letters without lowercasing the rest.
  const effectiveTextTransform = props.textTransform === 'capitalize' ? 'none' : props.textTransform;
  const displayContent = useMemo(() => {
    const raw = props.content || '<p>Double-click to edit text</p>';
    if (props.textTransform === 'capitalize') {
      return properCapitalizeHTML(raw);
    }
    return raw;
  }, [props.content, props.textTransform]);

  // Smooth scroll-back animation: when the renderer mounts with an
  // initialScrollTop > 0 (carried over from the TipTap editor), start at
  // that offset and smoothly lerp back to 0 so the transition isn't jarring.
  useEffect(() => {
    if (initialScrollTop < 1 || !containerRef.current) return;
    const el = containerRef.current;
    el.scrollTop = initialScrollTop;

    let rafId: number;
    const animate = () => {
      const current = el.scrollTop;
      if (current < 0.5) {
        el.scrollTop = 0;
        return;
      }
      el.scrollTop = current * 0.75; // lerp: move 25% toward 0 each frame
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [initialScrollTop]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full rich-text-content rich-text-scrollable"
      style={{
        fontSize: `${props.fontSize}px`,
        fontFamily: props.fontFamily,
        fontWeight: props.fontWeight,
        fontStyle: props.fontStyle,
        textDecoration: props.textDecoration,
        textTransform: effectiveTextTransform as 'none' | 'uppercase' | 'lowercase',
        color: props.color,
        textAlign: props.textAlign,
        ...(props.textAlign === 'justify' ? { textAlignLast: 'left' as const, textJustify: 'inter-character' as const, hyphens: 'auto' as const } : {}),
        lineHeight: props.lineHeight,
        letterSpacing: `${props.letterSpacing}px`,
        opacity: props.opacity,
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
        overflowY: 'auto',
        overflowX: 'hidden',
        // Hide scrollbars across browsers
        scrollbarWidth: 'none', // Firefox
      }}
      dangerouslySetInnerHTML={{ __html: displayContent }}
    />
  );
});

// ─── Canvas Text Editor ─────────────────────────────────────────────────
// Inline TipTap editor that renders directly on the canvas when a text
// element is being edited (activated by double-click).
// NO floating toolbar — formatting is controlled from the panel/floating-card.
// The editor instance is registered in the store so the panel/floating-card
// FormattingToolbar can control it.

interface CanvasTextEditorProps {
  elementId: string;
  props: TextProperties;
  onContentChange: (html: string) => void;
  onFinishEditing: () => void;
}

export const CanvasTextEditor = memo(function CanvasTextEditor({
  elementId,
  props,
  onContentChange,
  onFinishEditing,
}: CanvasTextEditorProps) {
  const setActiveTextEditor = useDesignerStore((s) => s.setActiveTextEditor);
  const debouncedSaveRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleContentChangeRef = useRef(onContentChange);
  useEffect(() => {
    handleContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  const onFinishEditingRef = useRef(onFinishEditing);
  useEffect(() => {
    onFinishEditingRef.current = onFinishEditing;
  }, [onFinishEditing]);

  const saveContent = useCallback(() => {
    // This is now called from the editor's update callback
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        strike: false,
      }),
      Underline,
      Strike,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      TextAlign.configure({
        types: ['paragraph'],
      }),
      LetterSpacing,
      ListStyleType,
      EdgeSelection,
      Placeholder.configure({
        placeholder: 'Start typing...',
      }),
    ],
    content: props.content || '<p></p>',
    editorProps: {
      attributes: {
        // Add rich-text-content and rich-text-scrollable classes to the
        // ProseMirror element so it matches the RichTextRenderer's CSS exactly.
        // This prevents text position shifts between display and edit mode.
        class: 'outline-none rich-text-content rich-text-scrollable',
      },
    },
    onUpdate: ({ editor }) => {
      if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
      debouncedSaveRef.current = window.setTimeout(() => {
        const html = editor.getHTML();
        handleContentChangeRef.current(html);
      }, 300);
    },
    onBlur: ({ editor }) => {
      // Save immediately on blur: flush any pending debounce instead of just
      // clearing it. Blur fires when focus moves to the properties panel etc.
      // — paths that never run exitEdit — so discarding the timer here would
      // silently drop the last ≤300ms of typing from save/autosave/PDF export.
      if (debouncedSaveRef.current) {
        clearTimeout(debouncedSaveRef.current);
        debouncedSaveRef.current = null;
        if (!editor.isDestroyed) {
          handleContentChangeRef.current(editor.getHTML());
        }
      }
    },
    immediatelyRender: false,
  });

  // Register/unregister the editor instance in the store so
  // the panel/floating-card FormattingToolbar can access it.
  useEffect(() => {
    if (editor) {
      setActiveTextEditor(editor);
      // Focus the editor after mounting without scrolling to cursor.
      // focus() without arguments places cursor at the start and does not
      // auto-scroll, keeping the text at its original scroll position.
      // Store the timer id so we can clear it on cleanup — calling
      // .focus() on a destroyed editor (unmount within 50ms) throws.
      const focusTimer = setTimeout(() => {
        if (editor.isDestroyed) return;
        editor.commands.focus();
        // Ensure the editor starts at the top — no auto-scroll to cursor
        const tiptapEl = document.querySelector('.tiptap.ProseMirror');
        if (tiptapEl) {
          tiptapEl.scrollTop = 0;
        }
      }, 50);
      return () => {
        clearTimeout(focusTimer);
        setActiveTextEditor(null);
      };
    }
    return () => {
      setActiveTextEditor(null);
    };
  }, [editor, setActiveTextEditor]);

  // Sync content from external changes (e.g. undo/redo)
  const lastContentRef = useRef(props.content);
  useEffect(() => {
    if (!editor) return;
    // Only update if content changed externally (not from our own edits)
    if (props.content !== lastContentRef.current) {
      const currentEditorHTML = editor.getHTML();
      if (props.content !== currentEditorHTML) {
        editor.commands.setContent(props.content || '<p></p>');
      }
      lastContentRef.current = props.content;
    }
  }, [editor, props.content]);

  // Track our own content changes
  useEffect(() => {
    if (!editor) return;
    const handleUpdate = () => {
      lastContentRef.current = editor.getHTML();
    };
    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
    };
  }, [editor]);

  // Helper: flush pending saves and exit edit mode immediately.
  // The smooth scroll-back is handled by RichTextRenderer's initialScrollTop prop.
  const exitEdit = useCallback(() => {
    if (!editor) return;
    if (debouncedSaveRef.current) {
      clearTimeout(debouncedSaveRef.current);
      debouncedSaveRef.current = null;
    }
    const html = editor.getHTML();
    handleContentChangeRef.current(html);
    onFinishEditingRef.current();
  }, [editor, handleContentChangeRef, onFinishEditingRef]);

  // Global click listener: finish editing when clicking outside the editor container
  useEffect(() => {
    if (!editor) return;

    const handleGlobalMouseDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) {
        return;
      }
      // Don't close if clicking on a UI panel (properties panel, floating card, toolbar)
      const target = e.target as HTMLElement;
      if (target.closest?.('[data-ui-panel]')) {
        return;
      }
      if (target.closest?.('[data-no-drag]')) {
        return;
      }
      // Don't close if clicking on a resize handle — the resize handler
      // will exit edit mode separately to avoid race conditions
      if (target.closest?.('[data-resize-handle]')) {
        return;
      }
      exitEdit();
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleGlobalMouseDown, true);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleGlobalMouseDown, true);
    };
  }, [editor]);

  // Handle Escape key to finish editing
  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        exitEdit();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [editor]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (debouncedSaveRef.current) {
        clearTimeout(debouncedSaveRef.current);
      }
    };
  }, []);

  if (!editor) return null;

  return (
    <div className="w-full h-full" data-no-drag ref={containerRef}>
      {/* Editor content — no toolbar on canvas */}
      <EditorContent
        editor={editor}
        className="w-full h-full [&_.tiptap]:w-full [&_.tiptap]:h-full [&_.tiptap]:outline-none"
        style={{
          fontSize: `${props.fontSize}px`,
          fontFamily: props.fontFamily,
          fontWeight: props.fontWeight,
          fontStyle: props.fontStyle,
          textDecoration: props.textDecoration,
          // Don't apply 'capitalize' via CSS — it doesn't lowercase the rest.
          // Proper capitalization is applied to the stored content when needed.
          textTransform: props.textTransform === 'capitalize' ? 'none' : props.textTransform,
          color: props.color,
          textAlign: props.textAlign,
          ...(props.textAlign === 'justify' ? { textAlignLast: 'left' as const, textJustify: 'inter-character' as const, hyphens: 'auto' as const } : {}),
          lineHeight: props.lineHeight,
          letterSpacing: `${props.letterSpacing}px`,
          opacity: props.opacity,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      />

      {/* TipTap styles — must match display-mode rendering exactly so text
          position does not shift when entering/exiting edit mode. */}
      <style jsx global>{`
        .tiptap {
          /* No padding/margin/box-sizing hacks — keep border-box and zero
             padding to match RichTextRenderer exactly. */
          padding: 0 !important;
          margin: 0 !important;
          box-sizing: border-box !important;
          /* Use overflow-y: auto with hidden scrollbar to match
             RichTextRenderer's .rich-text-scrollable behavior exactly.
             Using overflow:hidden creates a different scrollbar gutter
             reservation, causing the text position to shift. */
          overflow-y: auto !important;
          overflow-x: hidden !important;
          /* Hide scrollbars — must match RichTextRenderer */
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
          /* ProseMirror overrides white-space to 'break-spaces', but the
             display-mode renderer uses 'pre-wrap'. This mismatch causes
             text to wrap differently between modes, shifting the position.
             Force 'pre-wrap' to match exactly. */
          white-space: pre-wrap !important;
        }
        .tiptap::-webkit-scrollbar {
          display: none !important;
        }
        /* Justify text improvements — match RichTextRenderer */
        .tiptap[style*="text-align: justify"],
        .tiptap [style*="text-align: justify"] {
          text-align-last: left;
          text-justify: inter-character;
          hyphens: auto;
        }
        .tiptap ul {
          list-style-type: disc;
          padding-left: 1.5em;
          margin: 0;
        }
        .tiptap ol {
          list-style-type: decimal;
          padding-left: 1.5em;
          margin: 0;
        }
        .tiptap li {
          margin: 0;
        }
        .tiptap p {
          margin: 0;
        }
        .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #adb5bd;
          pointer-events: none;
          height: 0;
        }
      `}</style>
    </div>
  );
});

// ─── Legacy: Panel Text Editor ──────────────────────────────────────────
// DEPRECATED: This is kept for backward compatibility but is no longer used.
// The canvas now uses CanvasTextEditor for inline editing, and the
// panel/floating-card uses FormattingToolbar connected to the canvas editor.

interface PanelTextEditorProps {
  elementId: string;
  props: TextProperties;
}

export const PanelTextEditor = memo(function PanelTextEditor({ elementId, props }: PanelTextEditorProps) {
  const updateElementProperties = useDesignerStore((s) => s.updateElementProperties);
  const setEditingTextElement = useDesignerStore((s) => s.setEditingTextElement);
  const debouncedSaveRef = useRef<number | null>(null);

  const handleContentChange = useCallback((html: string) => {
    updateElementProperties(elementId, {
      type: 'text',
      data: { ...props, content: html },
    });
  }, [elementId, props, updateElementProperties]);

  const handleContentChangeRef = useRef(handleContentChange);
  useEffect(() => {
    handleContentChangeRef.current = handleContentChange;
  }, [handleContentChange]);

  const handleClose = useCallback(() => {
    // Flush any pending saves
    if (debouncedSaveRef.current) {
      clearTimeout(debouncedSaveRef.current);
      debouncedSaveRef.current = null;
    }
    setEditingTextElement(null);
  }, [setEditingTextElement]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        strike: false,
      }),
      Underline,
      Strike,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      TextAlign.configure({
        types: ['paragraph'],
      }),
      LetterSpacing,
      ListStyleType,
      Placeholder.configure({
        placeholder: 'Start typing...',
      }),
    ],
    content: props.content || '<p></p>',
    editorProps: {
      attributes: {
        class: 'outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
      debouncedSaveRef.current = window.setTimeout(() => {
        const html = editor.getHTML();
        handleContentChangeRef.current(html);
      }, 300);
    },
    onBlur: () => {
      // Save immediately on blur (if there's a pending debounce, it will be cleared by the next update)
      if (debouncedSaveRef.current) {
        clearTimeout(debouncedSaveRef.current);
        debouncedSaveRef.current = null;
      }
    },
    immediatelyRender: false,
  });

  // Sync content from external changes (e.g. undo/redo)
  const lastContentRef = useRef(props.content);
  useEffect(() => {
    if (!editor) return;
    // Only update if content changed externally (not from our own edits)
    if (props.content !== lastContentRef.current) {
      const currentEditorHTML = editor.getHTML();
      if (props.content !== currentEditorHTML) {
        editor.commands.setContent(props.content || '<p></p>');
      }
      lastContentRef.current = props.content;
    }
  }, [editor, props.content]);

  // Track our own content changes
  useEffect(() => {
    if (!editor) return;
    const handleUpdate = () => {
      lastContentRef.current = editor.getHTML();
    };
    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
    };
  }, [editor]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debouncedSaveRef.current) {
        clearTimeout(debouncedSaveRef.current);
      }
    };
  }, []);

  // Focus editor on mount
  useEffect(() => {
    if (editor) {
      const focusTimer = setTimeout(() => {
        if (editor.isDestroyed) return;
        editor.commands.focus('end');
      }, 50);
      return () => clearTimeout(focusTimer);
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="flex flex-col gap-1.5" data-no-drag>
      {/* Header with close button */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Text Editor
        </span>
        <button
          type="button"
          data-no-drag
          className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
          onClick={handleClose}
          title="Close editor"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Fixed formatting toolbar */}
      <FormattingToolbar editor={editor} baseProps={props} />

      {/* Editor content area */}
      <div className="border border-border rounded-md overflow-hidden min-h-[120px] max-h-[300px] overflow-y-auto bg-background">
        <EditorContent
          editor={editor}
          className="[&_.tiptap]:w-full [&_.tiptap]:min-h-[120px] [&_.tiptap]:p-2 [&_.tiptap]:outline-none [&_.tiptap]:text-sm"
          style={{
            fontSize: `${props.fontSize}px`,
            fontFamily: props.fontFamily,
            fontWeight: props.fontWeight,
            fontStyle: props.fontStyle,
            color: props.color,
            lineHeight: props.lineHeight,
            letterSpacing: `${props.letterSpacing}px`,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
          }}
        />
      </div>

      {/* TipTap styles for list rendering in the panel editor */}
      <style jsx global>{`
        .tiptap ul {
          list-style-type: disc;
          padding-left: 1.5em;
          margin: 0;
        }
        .tiptap ol {
          list-style-type: decimal;
          padding-left: 1.5em;
          margin: 0;
        }
        .tiptap li {
          margin: 0;
        }
        .tiptap p {
          margin: 0;
        }
        .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #adb5bd;
          pointer-events: none;
          height: 0;
        }
      `}</style>
    </div>
  );
});

// ─── Legacy: Canvas-based RichTextEditor ────────────────────────────────
// DEPRECATED: Use CanvasTextEditor instead.
// Kept for backward compatibility but no longer used.

interface RichTextEditorProps {
  elementId: string;
  props: TextProperties;
  onContentChange: (html: string) => void;
  onFinishEditing: () => void;
}

export const RichTextEditor = memo(function RichTextEditor({
  props,
  onContentChange,
  onFinishEditing,
}: RichTextEditorProps) {
  const debouncedSaveRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);
  const [isEditorFocused, setIsEditorFocused] = useState(false);

  const saveContent = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (debouncedSaveRef.current) {
      clearTimeout(debouncedSaveRef.current);
      debouncedSaveRef.current = null;
    }
    const html = ed.getHTML();
    onContentChange(html);
  }, [onContentChange]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        strike: false,
      }),
      Underline,
      Strike,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      TextAlign.configure({
        types: ['paragraph'],
      }),
      LetterSpacing,
      ListStyleType,
      Placeholder.configure({
        placeholder: 'Start typing...',
      }),
    ],
    content: props.content || '<p></p>',
    editorProps: {
      attributes: {
        class: 'outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
      debouncedSaveRef.current = window.setTimeout(() => {
        const html = editor.getHTML();
        onContentChange(html);
      }, 300);
    },
    onFocus: () => {
      setIsEditorFocused(true);
    },
    onBlur: () => {
      if (!editor) return;
      if (debouncedSaveRef.current) {
        clearTimeout(debouncedSaveRef.current);
        debouncedSaveRef.current = null;
      }
      const html = editor.getHTML();
      onContentChange(html);
    },
    immediatelyRender: false,
  });

  // Keep the ref in sync
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Use a ref for the finish callback to avoid stale closures
  const onFinishEditingRef = useRef(onFinishEditing);
  useEffect(() => {
    onFinishEditingRef.current = onFinishEditing;
  }, [onFinishEditing]);

  const saveContentRef = useRef(saveContent);
  useEffect(() => {
    saveContentRef.current = saveContent;
  }, [saveContent]);

  // Global click listener: finish editing when clicking outside the editor container
  useEffect(() => {
    if (!editor) return;

    const handleGlobalMouseDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) {
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest?.('[data-no-drag]')) {
        return;
      }
      saveContentRef.current();
      onFinishEditingRef.current();
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleGlobalMouseDown, true);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleGlobalMouseDown, true);
    };
  }, [editor]);

  // Handle Escape key
  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        saveContentRef.current();
        onFinishEditingRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [editor]);

  // Focus editor on mount
  useEffect(() => {
    if (editor) {
      const focusTimer = setTimeout(() => {
        if (editor.isDestroyed) return;
        editor.commands.focus('end');
      }, 50);
      return () => clearTimeout(focusTimer);
    }
  }, [editor]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (debouncedSaveRef.current) {
        clearTimeout(debouncedSaveRef.current);
      }
    };
  }, []);

  if (!editor) return null;

  return (
    <div className="w-full h-full relative" data-no-drag ref={containerRef}>
      {/* Fixed toolbar at the top of the editor when focused */}
      {isEditorFocused && (
        <div
          className="absolute bottom-full left-0 mb-1 z-[99999]"
          data-no-drag
        >
          <FormattingToolbar editor={editor} baseProps={props} />
        </div>
      )}

      {/* Editor content */}
      <EditorContent
        editor={editor}
        className="w-full h-full [&_.tiptap]:w-full [&_.tiptap]:h-full [&_.tiptap]:outline-none [&_.tiptap]:p-0"
        style={{
          fontSize: `${props.fontSize}px`,
          fontFamily: props.fontFamily,
          fontWeight: props.fontWeight,
          fontStyle: props.fontStyle,
          color: props.color,
          lineHeight: props.lineHeight,
          letterSpacing: `${props.letterSpacing}px`,
          opacity: props.opacity,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      />

      {/* TipTap styles for list rendering */}
      <style jsx global>{`
        .tiptap ul {
          list-style-type: disc;
          padding-left: 1.5em;
          margin: 0;
        }
        .tiptap ol {
          list-style-type: decimal;
          padding-left: 1.5em;
          margin: 0;
        }
        .tiptap li {
          margin: 0;
        }
        .tiptap p {
          margin: 0;
        }
        .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #adb5bd;
          pointer-events: none;
          height: 0;
        }
      `}</style>
    </div>
  );
});
