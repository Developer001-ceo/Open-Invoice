'use client';

import dynamic from 'next/dynamic';
import { ToolPalette } from '@/components/designer/tool-palette';
import { Canvas } from '@/components/designer/canvas';
import { PropertiesPanel } from '@/components/designer/properties-panel';
// Dialogs/modals are lazy-loaded via next/dynamic (ssr: false). They are all
// controlled by an `open` flag that starts false, so they render no visible
// content on first paint — safe to defer their (heavy) chunks until needed.
const SettingsDialog = dynamic(
  () => import('@/components/designer/settings-dialog').then((m) => m.SettingsDialog),
  { ssr: false },
);
const NewProjectDialog = dynamic(
  () => import('@/components/designer/new-project-dialog').then((m) => m.NewProjectDialog),
  { ssr: false },
);
const ExportPdfDialog = dynamic(
  () => import('@/components/designer/export-pdf-dialog').then((m) => m.ExportPdfDialog),
  { ssr: false },
);
const LargePreviewModal = dynamic(
  () => import('@/components/designer/large-preview-modal').then((m) => m.LargePreviewModal),
  { ssr: false },
);
const ToolInfoDialog = dynamic(
  () => import('@/components/designer/tool-info-dialog').then((m) => m.ToolInfoDialog),
  { ssr: false },
);
const WelcomeModal = dynamic(
  () => import('@/components/designer/welcome-modal').then((m) => m.WelcomeModal),
  { ssr: false },
);
import { LoadingScreen } from '@/components/designer/loading-screen';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings,
  FolderOpen,
  Save,
  SaveAll,
  FilePlus,
  FileDown,
  Eye,
  Undo2,
  Redo2,
  Scissors,
  Copy,
  ClipboardPaste,
  Trash2,
  CopyPlus,
  BringToFront,
  SendToBack,
  Lock,
  Unlock,
  EyeOff,
  ZoomIn,
  ZoomOut,
  Maximize,
  Grid3x3,
  Magnet,
  Ruler,
  AlignStartVertical,
  AlignEndVertical,
  AlignCenterVertical,
  AlignStartHorizontal,
  AlignEndHorizontal,
  AlignCenterHorizontal,
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { ShortcutsBar } from '@/components/designer/shortcuts-bar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { useDesignerStore } from '@/store/designer-store';
import { useState, useEffect } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileNotSupported } from '@/components/designer/mobile-not-supported';
import {
  buildProjectSnapshot,
  saveAutosave,
  loadAutosave,
  clearAutosave,
  formatAutosaveAge,
  type AutosaveSnapshot,
} from '@/lib/autosave';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RotateCcw, FileX2, History } from 'lucide-react';

export default function DesignerPage() {
  // Loading screen state — tracks whether the app has finished initial render
  const [appReady, setAppReady] = useState(false);
  // Welcome modal open state — controlled from parent so it opens immediately
  // when the loading screen finishes, without an extra effect in the modal.
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  // Crash-recovery: if a previous session left an auto-saved draft, prompt the
  // user to restore it instead of (or before) the welcome modal. Null = no
  // draft / not prompting.
  const [recoverySnapshot, setRecoverySnapshot] = useState<AutosaveSnapshot | null>(null);

  useEffect(() => {
    // Keep the loading screen visible for at least 3 seconds so the MJC
    // spinner animation plays fully before the app appears.
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) {
        setAppReady(true);
        // Check for an auto-saved draft from a previous (possibly crashed)
        // session. If one exists with content, offer to restore it instead of
        // showing the welcome modal. If there's no draft (or it's empty), fall
        // through to the normal welcome flow.
        const draft = loadAutosave();
        if (draft && draft.project.elements && draft.project.elements.length > 0) {
          setRecoverySnapshot(draft);
        } else {
          setWelcomeOpen(true);
        }
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const setSettingsOpen = useDesignerStore((s) => s.setSettingsOpen);
  const saveProject = useDesignerStore((s) => s.saveProject);
  const saveProjectAs = useDesignerStore((s) => s.saveProjectAs);
  const setNewProjectOpen = useDesignerStore((s) => s.setNewProjectOpen);
  const setWelcomeModalOpen = useDesignerStore((s) => s.setWelcomeModalOpen);
  const propertyDisplayMode = useDesignerStore((s) => s.propertyDisplayMode);
  // Panel collapse state — desktop collapsible side panels
  const toolPaletteCollapsed = useDesignerStore((s) => s.toolPaletteCollapsed);
  const setToolPaletteCollapsed = useDesignerStore((s) => s.setToolPaletteCollapsed);
  const propsPanelCollapsed = useDesignerStore((s) => s.propsPanelCollapsed);
  const setPropsPanelCollapsed = useDesignerStore((s) => s.setPropsPanelCollapsed);
  // Whether the docked properties panel is currently visible (panel/both mode
  // and not collapsed). In 'floating' mode the docked panel is hidden.
  const rightPanelVisible = !propsPanelCollapsed && propertyDisplayMode !== 'floating';
  // Responsive — below 768px (phones/small tablets) show a desktop-required screen
  const isMobile = useIsMobile();
  const projectName = useDesignerStore((s) => s.projectName);
  const isDirty = useDesignerStore((s) => s.isDirty);
  const loadProject = useDesignerStore((s) => s.loadProject);
  const setExportPdfOpen = useDesignerStore((s) => s.setExportPdfOpen);
  const setLargePreviewOpen = useDesignerStore((s) => s.setLargePreviewOpen);

  // Edit menu actions
  const undo = useDesignerStore((s) => s.undo);
  const redo = useDesignerStore((s) => s.redo);
  const canUndo = useDesignerStore((s) => s.canUndo);
  const canRedo = useDesignerStore((s) => s.canRedo);
  const cutElement = useDesignerStore((s) => s.cutElement);
  const copyElement = useDesignerStore((s) => s.copyElement);
  const pasteElement = useDesignerStore((s) => s.pasteElement);
  const pasteElementInPlace = useDesignerStore((s) => s.pasteElementInPlace);
  const selectAll = useDesignerStore((s) => s.selectAll);
  const selectedElementIds = useDesignerStore((s) => s.selectedElementIds);
  const removeElement = useDesignerStore((s) => s.removeElement);
  const duplicateElement = useDesignerStore((s) => s.duplicateElement);
  const bringToFront = useDesignerStore((s) => s.bringToFront);
  const sendToBack = useDesignerStore((s) => s.sendToBack);
  const toggleLock = useDesignerStore((s) => s.toggleLock);
  const toggleVisibility = useDesignerStore((s) => s.toggleVisibility);
  const elements = useDesignerStore((s) => s.elements);
  const clipboardElement = useDesignerStore((s) => s.clipboardElement);

  // View menu actions
  const zoomIn = useDesignerStore((s) => s.zoomIn);
  const zoomOut = useDesignerStore((s) => s.zoomOut);
  const resetZoom = useDesignerStore((s) => s.resetZoom);
  const fitToPage = useDesignerStore((s) => s.fitToPage);
  const snapToGrid = useDesignerStore((s) => s.snapToGrid);
  const setSnapToGrid = useDesignerStore((s) => s.setSnapToGrid);
  const snapEnabled = useDesignerStore((s) => s.snapEnabled);
  const setSnapEnabled = useDesignerStore((s) => s.setSnapEnabled);
  const marginShow = useDesignerStore((s) => s.canvasSettings.marginGuideline.show);
  const updateCanvasSettings = useDesignerStore((s) => s.updateCanvasSettings);
  const showMiniPreview = useDesignerStore((s) => s.showMiniPreview);
  const setShowMiniPreview = useDesignerStore((s) => s.setShowMiniPreview);

  // Derive state for menu items
  const hasSelection = selectedElementIds.length > 0;
  const firstSelectedId = selectedElementIds[0];
  const firstSelectedElement = firstSelectedId
    ? elements.find((el) => el.id === firstSelectedId)
    : null;
  const canPaste = clipboardElement !== null;

  const handleDeleteSelected = () => {
    for (const id of [...selectedElementIds]) {
      removeElement(id);
    }
  };

  const handleDuplicateSelected = () => {
    if (firstSelectedId) {
      duplicateElement(firstSelectedId);
    }
  };

  const handleBringToFront = () => {
    if (firstSelectedId) {
      bringToFront(firstSelectedId);
    }
  };

  const handleSendToBack = () => {
    if (firstSelectedId) {
      sendToBack(firstSelectedId);
    }
  };

  // Multi-select alignment actions
  const alignElementsLeft = useDesignerStore((s) => s.alignElementsLeft);
  const alignElementsRight = useDesignerStore((s) => s.alignElementsRight);
  const alignElementsTop = useDesignerStore((s) => s.alignElementsTop);
  const alignElementsBottom = useDesignerStore((s) => s.alignElementsBottom);
  const alignElementsCenterH = useDesignerStore((s) => s.alignElementsCenterH);
  const alignElementsCenterV = useDesignerStore((s) => s.alignElementsCenterV);
  const distributeElementsH = useDesignerStore((s) => s.distributeElementsH);
  const distributeElementsV = useDesignerStore((s) => s.distributeElementsV);
  const hasMultiSelect = selectedElementIds.length >= 2;
  const hasDistributeSelect = selectedElementIds.length >= 3;

  const handleToggleLock = () => {
    if (firstSelectedId) {
      toggleLock(firstSelectedId);
    }
  };

  const handleToggleVisibility = () => {
    if (firstSelectedId) {
      toggleVisibility(firstSelectedId);
    }
  };

  // Sync the welcome modal's open state into the store so the canvas's global
  // keydown handler can disable feature shortcuts (Shift+S spotlight, Shift+Q
  // predefined blocks) while the welcome modal is showing — the user has no
  // project yet, so those overlays shouldn't be openable.
  useEffect(() => {
    setWelcomeModalOpen(welcomeOpen);
  }, [welcomeOpen, setWelcomeModalOpen]);

  // Warn the user before closing/reloading the tab when there are unsaved
  // changes. Reads isDirty fresh from the store inside the handler (rather than
  // from the closure) so the listener only registers once and always reflects
  // the latest dirty state. Browsers ignore the custom message and show a
  // generic prompt — that's expected and unavoidable.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useDesignerStore.getState().isDirty) {
        e.preventDefault();
        // returnValue must be set to trigger the prompt in most browsers.
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Auto-save (crash recovery). Debounced: 5s after the last change, serialize
  // the current project to localStorage. Only runs once the app is ready (not
  // during the loading screen) and only when there's actually something to save
  // (elements present + dirty). Best-effort — quota/private-mode failures are
  // swallowed inside saveAutosave so the editor is never blocked.
  //
  // We depend on BOTH isDirty AND the elements array reference. isDirty alone
  // only transitions false→true once per save cycle, so subsequent edits (which
  // keep isDirty true) wouldn't re-trigger the effect. The elements array is
  // reassigned on every content edit (add/move/resize/delete), so including it
  // in the deps guarantees the debounce re-arms after every edit — not just the
  // first one. getState() inside the timeout reads the freshest state.
  useEffect(() => {
    if (!appReady) return;
    if (!isDirty) return;
    // Don't auto-save while the recovery prompt is showing — the user hasn't
    // decided whether to keep the draft yet, and saving would overwrite it.
    if (recoverySnapshot) return;

    const timer = setTimeout(() => {
      const s = useDesignerStore.getState();
      // Nothing to recover if the canvas is empty.
      if (s.elements.length === 0) return;
      try {
        const project = buildProjectSnapshot({
          elements: s.elements,
          elementCounter: s.elementCounter,
          canvasSettings: s.canvasSettings,
          snapEnabled: s.snapEnabled,
          snapToGrid: s.snapToGrid,
          snapToElements: s.snapToElements,
          snapUnit: s.snapUnit,
          zoomStep: s.zoomStep,
          projectName: s.projectName,
        });
        saveAutosave(project);
      } catch (err) {
        // Autosave is best-effort — never block the editor. Log so it's
        // visible during debugging but don't surface to the user.
        console.warn('[autosave] Failed to build/save snapshot:', err);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [appReady, isDirty, elements, recoverySnapshot]);

  // ── Crash-recovery handlers ──────────────────────────────────────────────
  const loadProjectFromFileData = useDesignerStore((s) => s.loadProjectFromFileData);

  const handleRestoreDraft = () => {
    if (!recoverySnapshot) return;
    try {
      // loadProjectFromFileData calls deserializeProject internally, so we
      // pass the raw ProjectFile from the snapshot.
      loadProjectFromFileData(recoverySnapshot.project);
      // Mark non-dirty so the user isn't immediately prompted on close — the
      // restored state IS the saved state (matches loadProject's behaviour).
      useDesignerStore.setState({ isDirty: false });
    } catch (err) {
      console.error('[autosave] Failed to restore draft:', err);
      clearAutosave();
    }
    setRecoverySnapshot(null);
    setWelcomeOpen(false);
  };

  const handleDiscardDraft = () => {
    clearAutosave();
    setRecoverySnapshot(null);
    // Show the normal welcome flow now that the draft is gone.
    setWelcomeOpen(true);
  };

  const handleFitToPage = () => {
    const viewport = document.querySelector('.canvas-viewport') as HTMLElement | null;
    if (viewport) {
      fitToPage(viewport.clientWidth, viewport.clientHeight);
    }
  };

  const handleToggleMarginGuides = () => {
    const current = useDesignerStore.getState().canvasSettings.marginGuideline;
    updateCanvasSettings({
      marginGuideline: { ...current, show: !current.show },
    });
  };

  // Responsive — on phones/small tablets (below 768px) the precision editor is
  // not usable, so show a friendly desktop-required screen instead of a broken
  // layout. The loading screen still renders on top during init (branded
  // animation), then fades to reveal the message. The welcome modal is
  // intentionally NOT shown on mobile — it would prompt the user to create a
  // project they can't edit, which is confusing.
  if (isMobile) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-background">
        <MobileNotSupported />
        {/* Loading screen overlay — fades out after app hydrates */}
        <LoadingScreen isLoading={!appReady} />
      </div>
    );
  }

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden bg-background"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('element-type')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
    >
      {/* Loading screen overlay — fades out after app hydrates */}
      <LoadingScreen isLoading={!appReady} />
      {/* Welcome Modal — shows immediately after loading screen finishes */}
      <WelcomeModal open={welcomeOpen} onOpenChange={setWelcomeOpen} />
      {/* Crash-recovery dialog — if a previous session left an auto-saved
          draft, offer to restore it (or discard and start fresh). */}
      <Dialog
        open={recoverySnapshot !== null}
        onOpenChange={(open) => {
          if (!open) handleDiscardDraft();
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 text-primary">
                <History className="h-5 w-5" />
              </div>
              <DialogTitle className="text-base">Unsaved work found</DialogTitle>
            </div>
            <DialogDescription className="text-sm leading-relaxed">
              We recovered an unsaved project from your last session
              {recoverySnapshot ? ` (${formatAutosaveAge(recoverySnapshot.savedAt)})` : ''}.
              Restore it to pick up where you left off, or start fresh.
            </DialogDescription>
          </DialogHeader>
          {recoverySnapshot && (
            <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {recoverySnapshot.project.projectName || 'Untitled Project'}
              </span>
              {' · '}
              {recoverySnapshot.project.elements.length} element{recoverySnapshot.project.elements.length === 1 ? '' : 's'}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDiscardDraft}
              className="gap-1.5"
            >
              <FileX2 className="h-4 w-4" />
              Start fresh
            </Button>
            <Button
              size="sm"
              onClick={handleRestoreDraft}
              className="gap-1.5"
            >
              <RotateCcw className="h-4 w-4" />
              Restore work
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* App Header */}
      <header data-tour="header" className="h-12 border-b border-border bg-card flex items-center px-4 gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <img src="/Logo.png" alt="Open Invoice" className="w-7 h-7 rounded-md object-contain" />
          <h1 className="text-sm font-bold text-foreground tracking-tight">
            Open Invoice<sup className="text-[0.5em] font-semibold tracking-wider leading-none">MJC</sup>
          </h1>
        </div>

        <div className="h-4 w-px bg-border" />

        {/* File Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="nav-btn-pink text-xs text-muted-foreground px-2 py-1 rounded">
              File
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={() => setNewProjectOpen(true)}>
              <FilePlus className="mr-2 h-4 w-4" />
              New Project
              <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { void loadProject(); }}>
              <FolderOpen className="mr-2 h-4 w-4" />
              Open Project
              <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { void saveProject(); }}>
              <Save className="mr-2 h-4 w-4" />
              Save
              <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { void saveProjectAs(); }}>
              <SaveAll className="mr-2 h-4 w-4" />
              Save As...
              <DropdownMenuShortcut>⇧⌘S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setExportPdfOpen(true)}>
              <FileDown className="mr-2 h-4 w-4" />
              Export as PDF
              <DropdownMenuShortcut>⇧⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Edit Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="nav-btn-pink text-xs text-muted-foreground px-2 py-1 rounded">
              Edit
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={undo} disabled={!canUndo}>
              <Undo2 className="mr-2 h-4 w-4" />
              Undo
              <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={redo} disabled={!canRedo}>
              <Redo2 className="mr-2 h-4 w-4" />
              Redo
              <DropdownMenuShortcut>⇧⌘Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={cutElement} disabled={!hasSelection}>
              <Scissors className="mr-2 h-4 w-4" />
              Cut
              <DropdownMenuShortcut>⌘X</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={copyElement} disabled={!hasSelection}>
              <Copy className="mr-2 h-4 w-4" />
              Copy
              <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={pasteElement} disabled={!canPaste}>
              <ClipboardPaste className="mr-2 h-4 w-4" />
              Paste
              <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={pasteElementInPlace} disabled={!canPaste}>
              <ClipboardPaste className="mr-2 h-4 w-4" />
              Paste in Place
              <DropdownMenuShortcut>⇧⌘V</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={selectAll}>
              <CopyPlus className="mr-2 h-4 w-4" />
              Select All
              <DropdownMenuShortcut>⌘A</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDeleteSelected} disabled={!hasSelection}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
              <DropdownMenuShortcut>Del</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDuplicateSelected} disabled={!hasSelection}>
              <CopyPlus className="mr-2 h-4 w-4" />
              Duplicate
              <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleBringToFront} disabled={!hasSelection}>
              <BringToFront className="mr-2 h-4 w-4" />
              Bring to Front
              <DropdownMenuShortcut>⇧⌘]</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSendToBack} disabled={!hasSelection}>
              <SendToBack className="mr-2 h-4 w-4" />
              Send to Back
              <DropdownMenuShortcut>⇧⌘[</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={alignElementsLeft} disabled={!hasMultiSelect}>
              <AlignStartVertical className="mr-2 h-4 w-4" />
              Align Left
            </DropdownMenuItem>
            <DropdownMenuItem onClick={alignElementsRight} disabled={!hasMultiSelect}>
              <AlignEndVertical className="mr-2 h-4 w-4" />
              Align Right
            </DropdownMenuItem>
            <DropdownMenuItem onClick={alignElementsTop} disabled={!hasMultiSelect}>
              <AlignStartHorizontal className="mr-2 h-4 w-4" />
              Align Top
            </DropdownMenuItem>
            <DropdownMenuItem onClick={alignElementsBottom} disabled={!hasMultiSelect}>
              <AlignEndHorizontal className="mr-2 h-4 w-4" />
              Align Bottom
            </DropdownMenuItem>
            <DropdownMenuItem onClick={alignElementsCenterH} disabled={!hasMultiSelect}>
              <AlignCenterVertical className="mr-2 h-4 w-4" />
              Align Center H
            </DropdownMenuItem>
            <DropdownMenuItem onClick={alignElementsCenterV} disabled={!hasMultiSelect}>
              <AlignCenterHorizontal className="mr-2 h-4 w-4" />
              Align Center V
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={distributeElementsH} disabled={!hasDistributeSelect}>
              <AlignHorizontalSpaceAround className="mr-2 h-4 w-4" />
              Distribute H
            </DropdownMenuItem>
            <DropdownMenuItem onClick={distributeElementsV} disabled={!hasDistributeSelect}>
              <AlignVerticalSpaceAround className="mr-2 h-4 w-4" />
              Distribute V
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleToggleLock} disabled={!hasSelection}>
              {firstSelectedElement?.locked ? <Unlock className="mr-2 h-4 w-4" /> : <Lock className="mr-2 h-4 w-4" />}
              {firstSelectedElement?.locked ? 'Unlock' : 'Lock'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleToggleVisibility} disabled={!hasSelection}>
              {firstSelectedElement?.visible === false ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
              {firstSelectedElement?.visible === false ? 'Show' : 'Hide'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* View Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="nav-btn-pink text-xs text-muted-foreground px-2 py-1 rounded">
              View
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={zoomIn}>
              <ZoomIn className="mr-2 h-4 w-4" />
              Zoom In
              <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={zoomOut}>
              <ZoomOut className="mr-2 h-4 w-4" />
              Zoom Out
              <DropdownMenuShortcut>⌘−</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={resetZoom}>
              <Maximize className="mr-2 h-4 w-4" />
              Reset Zoom
              <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleFitToPage}>
              <Maximize className="mr-2 h-4 w-4" />
              Fit to Page
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={snapToGrid}
              onCheckedChange={setSnapToGrid}
            >
              <Grid3x3 className="mr-2 h-4 w-4" />
              Show Grid
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={snapEnabled}
              onCheckedChange={setSnapEnabled}
            >
              <Magnet className="mr-2 h-4 w-4" />
              Show Snap Guides
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={marginShow}
              onCheckedChange={handleToggleMarginGuides}
            >
              <Ruler className="mr-2 h-4 w-4" />
              Show Margin Guides
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={showMiniPreview}
              onCheckedChange={setShowMiniPreview}
            >
              <Eye className="mr-2 h-4 w-4" />
              Show Mini Preview
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem onClick={() => setLargePreviewOpen(true)}>
              <Eye className="mr-2 h-4 w-4" />
              Large Preview
              <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Project name indicator */}
        <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={projectName}>
          {projectName}{isDirty ? ' •' : ''}
        </span>

        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs rounded-md"
          onClick={() => setLargePreviewOpen(true)}
        >
          <Eye className="h-3.5 w-3.5" />
          Preview
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs rounded-md"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </Button>
      </header>

      {/* Main content area — dragover handler prevents 'not-allowed' cursor when dragging tools */}
      <div
        className="flex-1 flex overflow-hidden relative"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('element-type')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={() => {
          // Only handle drops that aren't on the canvas — let canvas handle its own drops
          // If we reach here, the drop was outside the canvas, so we ignore it
          // (the canvas has its own onDrop handler that actually creates elements)
        }}
      >
        {/* Left: Tool Palette & Layers — collapses to width 0 when toggled off
            (header button). Stays mounted so the exit/enter animation plays. */}
        <div data-tour="tool-palette" className="contents">
          <motion.div
            initial={false}
            animate={{
              width: toolPaletteCollapsed ? 0 : 240,
              opacity: toolPaletteCollapsed ? 0 : 1,
            }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden h-full"
            style={{ pointerEvents: toolPaletteCollapsed ? 'none' : 'auto' }}
          >
            <ToolPalette />
          </motion.div>
        </div>

        {/* Center: Canvas */}
        <Canvas />

        {/* Right: Properties Panel — animated width/opacity transition when the
            property display mode changes OR when the panel is collapsed via the
            header button. In 'floating' mode the panel collapses to width 0
            (canvas expands to fill) and fades out; in 'panel'/'both' it expands
            back to 288px and fades in. The PropertiesPanel stays mounted
            throughout so the exit animation is visible (it no longer returns
            null for floating mode). */}
        <div data-tour="properties-panel" className="contents">
          <motion.div
            initial={false}
            animate={{
              width: propsPanelCollapsed || propertyDisplayMode === 'floating' ? 0 : 288,
              opacity: propsPanelCollapsed || propertyDisplayMode === 'floating' ? 0 : 1,
            }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden h-full"
            style={{ pointerEvents: propsPanelCollapsed || propertyDisplayMode === 'floating' ? 'none' : 'auto' }}
          >
            <PropertiesPanel />
          </motion.div>
        </div>

        {/* Tool palette edge handle — sits on the left panel's right border,
            vertically centered. Slides to the screen edge when the panel
            collapses so the button is always reachable. The x offset (230)
            centers the 20px-wide handle on the 240px panel border. */}
        <div className="absolute top-1/2 left-0 -translate-y-1/2 z-30">
          <motion.button
            initial={false}
            animate={{ x: toolPaletteCollapsed ? 0 : 230 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => setToolPaletteCollapsed(!toolPaletteCollapsed)}
            className="flex items-center justify-center w-5 h-16 bg-card border border-border shadow-md hover:bg-accent hover:shadow-lg transition-colors rounded-r-lg text-muted-foreground hover:text-foreground"
            title={toolPaletteCollapsed ? 'Show tool palette' : 'Hide tool palette'}
            aria-label={toolPaletteCollapsed ? 'Show tool palette' : 'Hide tool palette'}
            aria-pressed={!toolPaletteCollapsed}
          >
            {toolPaletteCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </motion.button>
        </div>

        {/* Properties panel edge handle — only shown when the property display
            mode is 'panel' or 'both'. In 'floating' mode the docked panel can
            never be toggled open, so the handle is removed entirely (not just
            parked at the edge). Sits on the right panel's left border,
            vertically centered, and slides to the screen edge when the panel
            collapses. The x offset (-278) centers the 20px-wide handle on the
            288px panel border. */}
        <AnimatePresence>
          {propertyDisplayMode !== 'floating' && (
            <motion.div
              key="props-edge-handle"
              className="absolute top-1/2 right-0 -translate-y-1/2 z-30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <motion.button
                initial={false}
                animate={{ x: rightPanelVisible ? -278 : 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                onClick={() => {
                  if (rightPanelVisible) {
                    setPropsPanelCollapsed(true);
                  } else {
                    setPropsPanelCollapsed(false);
                  }
                }}
                className="flex items-center justify-center w-5 h-16 bg-card border border-border shadow-md hover:bg-accent hover:shadow-lg transition-colors rounded-l-lg text-muted-foreground hover:text-foreground"
                title={rightPanelVisible ? 'Hide properties panel' : 'Show properties panel'}
                aria-label={rightPanelVisible ? 'Hide properties panel' : 'Show properties panel'}
                aria-pressed={rightPanelVisible}
              >
                {rightPanelVisible ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom: Shortcuts Bar */}
      <div data-tour="shortcuts-bar">
        <ShortcutsBar />
      </div>

      {/* Large PDF Preview Modal */}
      <LargePreviewModal />

      {/* Settings Dialog */}
      <SettingsDialog />

      {/* New Project Dialog */}
      <NewProjectDialog />

      {/* Export PDF Dialog */}
      <ExportPdfDialog />

      {/* Per-tool info dialog (opened by the "ⓘ" icons above elements) */}
      <ToolInfoDialog />

    </div>
  );
}
