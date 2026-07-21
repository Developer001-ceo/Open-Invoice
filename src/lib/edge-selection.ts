/**
 * EdgeSelection — TipTap / ProseMirror extension
 *
 * When the user drags to select text in the inline canvas editor, the cursor
 * can move outside the content area (especially near the left / right edges or
 * above / below the element).  The browser's native drag-to-select only works
 * within the `contenteditable` bounds — once the cursor leaves, the selection
 * freezes and no longer follows the cursor.
 *
 * This extension fixes the problem using document-level pointer event tracking:
 *
 *  1. **Drag tracking** — When the user presses the primary mouse button inside
 *     the editor (`pointerdown` on `view.dom`), we start tracking the drag and
 *     capture the pointer for reliable `pointerup` detection.
 *
 *  2. **Document-level selection extension** — We register a `pointermove`
 *     listener on `document` (capture phase) so it fires regardless of which
 *     element the cursor is over.  When `posAtCoords` returns `null` (cursor
 *     is outside the text content), we resolve the closest valid document
 *     position (start/end of line, start/end of document) and dispatch a
 *     `TextSelection` transaction to extend the selection.
 *
 *  3. **Cleanup** — On `pointerup`, we stop tracking and release pointer
 *     capture.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';

const edgeSelectionKey = new PluginKey('edgeSelection');

/**
 * Resolve a cursor position when the pointer is outside the editor content.
 * Returns the closest valid document position, or null if it can't be resolved.
 */
function resolveEdgePosition(
  view: any,
  clientX: number,
  clientY: number,
  contentRect: DOMRect,
): number | null {
  if (clientY < contentRect.top) {
    // Cursor is ABOVE the content → extend to start of document
    return view.state.doc.content.size > 0 ? 1 : 0;
  }

  if (clientY > contentRect.bottom) {
    // Cursor is BELOW the content → extend to end of document
    return Math.max(0, view.state.doc.content.size - 1);
  }

  // Cursor is within vertical bounds but past a horizontal edge.
  // Find the position on the line closest to the cursor's Y.
  const lineY = Math.max(
    contentRect.top + 1,
    Math.min(clientY, contentRect.bottom - 1),
  );

  if (clientX < contentRect.left) {
    // Cursor is to the LEFT → extend to start of line
    const nearPos = view.posAtCoords({
      left: contentRect.left + 1,
      top: lineY,
    });
    if (nearPos) {
      const $pos = view.state.doc.resolve(nearPos.pos);
      return $pos.start($pos.depth);
    }
    return 1; // Fallback: start of first block
  }

  if (clientX > contentRect.right) {
    // Cursor is to the RIGHT → extend to end of line
    const nearPos = view.posAtCoords({
      left: contentRect.right - 1,
      top: lineY,
    });
    if (nearPos) {
      const $pos = view.state.doc.resolve(nearPos.pos);
      return $pos.end($pos.depth);
    }
    return Math.max(0, view.state.doc.content.size - 1); // Fallback: end of doc
  }

  // Cursor is inside the content rect but posAtCoords still returned null.
  // This can happen in padding areas or at the very edges of characters.
  // Fall back to the nearest edge based on X position.
  if (clientX <= contentRect.left + contentRect.width / 2) {
    // Closer to the left edge → extend to start of line
    const nearPos = view.posAtCoords({
      left: contentRect.left + 1,
      top: lineY,
    });
    if (nearPos) {
      const $pos = view.state.doc.resolve(nearPos.pos);
      return $pos.start($pos.depth);
    }
    return 1;
  } else {
    // Closer to the right edge → extend to end of line
    const nearPos = view.posAtCoords({
      left: contentRect.right - 1,
      top: lineY,
    });
    if (nearPos) {
      const $pos = view.state.doc.resolve(nearPos.pos);
      return $pos.end($pos.depth);
    }
    return Math.max(0, view.state.doc.content.size - 1);
  }
}

export const EdgeSelection = Extension.create({
  name: 'edgeSelection',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: edgeSelectionKey,
        view(editorView) {
          const view = editorView;

          // ── Drag state ──────────────────────────────────────────────────
          let isDragging = false;
          let anchor: number | null = null;

          // ── Pointer down: start tracking a drag-selection ───────────────
          // We listen on view.dom directly (not via handleDOMEvents) so this
          // always fires, regardless of ProseMirror's internal event routing.
          const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0) return; // only primary button

            isDragging = true;
            anchor = null; // will be captured lazily on first pointermove

            // Capture the pointer so we reliably get pointerup even if the
            // cursor leaves the browser window.
            try {
              view.dom.setPointerCapture(event.pointerId);
            } catch {
              // May fail if pointerId is invalid — not critical.
            }
          };

          // ── Pointer move (document-level, capture phase) ────────────────
          // This fires no matter where the cursor is — inside or outside the
          // editor.  When posAtCoords returns null (cursor outside text
          // content), we manually extend the selection to the nearest edge.
          const onPointerMove = (event: PointerEvent) => {
            if (!isDragging) return;

            // Safety: if button was released without us catching pointerup
            if (!(event.buttons & 1)) {
              cleanup();
              return;
            }

            // If ProseMirror can resolve the position, the browser's native
            // selection handling works correctly — no intervention needed.
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (pos !== null) {
              return;
            }

            // ── posAtCoords returned null — cursor is outside text content ──

            // Lazily capture the anchor on the first outside move.
            // By now, ProseMirror's mousedown handler has already set the
            // selection anchor.
            if (anchor === null) {
              anchor = view.state.selection.anchor;
            }

            const contentDOM = (view as unknown as { contentDOM: HTMLElement | null }).contentDOM;
            if (!contentDOM) return;

            const contentRect = contentDOM.getBoundingClientRect();
            const targetPos = resolveEdgePosition(
              view,
              event.clientX,
              event.clientY,
              contentRect,
            );

            if (targetPos !== null && targetPos >= 0 && targetPos <= view.state.doc.content.size) {
              const safeTarget = Math.max(0, Math.min(targetPos, view.state.doc.content.size));

              try {
                const newSelection = TextSelection.create(
                  view.state.doc,
                  anchor,
                  safeTarget,
                );
                view.dispatch(view.state.tr.setSelection(newSelection));
              } catch {
                // TextSelection.create may fail for invalid ranges — ignore.
              }
            }
          };

          // ── Pointer up: end the drag-selection ──────────────────────────
          const onPointerUp = (_event: PointerEvent) => {
            cleanup();
          };

          function cleanup() {
            isDragging = false;
            anchor = null;
          }

          // ── Register listeners ──────────────────────────────────────────
          view.dom.addEventListener('pointerdown', onPointerDown);
          // Document-level listeners (capture phase) to ensure we get events
          // even when the cursor is over other elements or outside the editor.
          document.addEventListener('pointermove', onPointerMove, true);
          document.addEventListener('pointerup', onPointerUp, true);

          return {
            destroy() {
              view.dom.removeEventListener('pointerdown', onPointerDown);
              document.removeEventListener('pointermove', onPointerMove, true);
              document.removeEventListener('pointerup', onPointerUp, true);
            },
          };
        },
      }),
    ];
  },
});
