'use client';

import { useDesignerStore, CanvasSettings, DEFAULT_CANVAS_SETTINGS, MARGIN_PRESETS, MarginPreset, PropertyDisplayMode } from '@/store/designer-store';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FolderOpen, Sparkles, PanelRight, Layers, Columns2, Lightbulb } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

// ---------- Presets ----------
const SIZE_PRESETS = [
  { label: 'A4', sublabel: '210 × 297 mm', widthPx: 794, heightPx: 1123 },
  { label: 'Letter', sublabel: '8.5 × 11 in', widthPx: 816, heightPx: 1056 },
  { label: 'A5', sublabel: '148 × 210 mm', widthPx: 559, heightPx: 794 },
  { label: 'Legal', sublabel: '8.5 × 14 in', widthPx: 816, heightPx: 1344 },
  { label: 'Receipt', sublabel: '80 × 297 mm', widthPx: 302, heightPx: 1123 },
  { label: 'Custom', sublabel: 'Manual', widthPx: 794, heightPx: 1123 },
];

const MARGIN_PRESET_OPTIONS: { value: MarginPreset; label: string; px: string }[] = [
  { value: 'none', label: 'None', px: '0' },
  { value: 'narrow', label: 'Narrow', px: '25' },
  { value: 'normal', label: 'Normal', px: '50' },
  { value: 'wide', label: 'Wide', px: '80' },
  { value: 'custom', label: 'Custom', px: '—' },
];

// Default accent color used for preview + canvas margin guideline (pink)
const DEFAULT_ACCENT = '#ec4899';

// Property display method options — segmented control
const PROPERTY_DISPLAY_OPTIONS = [
  { value: 'panel' as const, label: 'Panel', icon: PanelRight, description: 'Traditional side panel on the right.' },
  { value: 'floating' as const, label: 'Cards', icon: Layers, description: 'Floating cards via Shift+S spotlight.' },
  { value: 'both' as const, label: 'Both', icon: Columns2, description: 'Side panel + Shift+S floating cards.' },
];

// ---------- Component ----------
interface WelcomeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WelcomeModal({ open, onOpenChange }: WelcomeModalProps) {
  const newProject = useDesignerStore((s) => s.newProject);
  const loadProject = useDesignerStore((s) => s.loadProject);
  const setPropertyDisplayMode = useDesignerStore((s) => s.setPropertyDisplayMode);
  // On-canvas keyboard shortcut hints (the cursive text on the workspace
  // background). Toggling this updates the store in real time, so the hints
  // animate away/appear behind the modal immediately.
  const shortcutsOverlayVisible = useDesignerStore((s) => s.shortcutsOverlayVisible);
  const setShortcutsOverlayVisible = useDesignerStore((s) => s.setShortcutsOverlayVisible);

  // Form state
  const [projectName, setProjectName] = useState('Untitled Template');
  const [sizePreset, setSizePreset] = useState('A4');
  const [widthPx, setWidthPx] = useState(794);
  const [heightPx, setHeightPx] = useState(1123);
  const [marginPreset, setMarginPreset] = useState<MarginPreset>('normal');
  const [customMargin, setCustomMargin] = useState(50);
  // Default to 'panel' — the traditional side panel is the most discoverable
  // property display method for new users.
  const [propertyMode, setPropertyMode] = useState<PropertyDisplayMode>('panel');
  const [creating, setCreating] = useState(false);
  const rightColRef = useRef<HTMLDivElement>(null);
  const createTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel any pending create-shimmer timer if the dialog unmounts first
  // (otherwise it would call setState on an unmounted component).
  useEffect(() => {
    return () => {
      if (createTimerRef.current) clearTimeout(createTimerRef.current);
    };
  }, []);

  // Callback ref — fires the moment the right column element mounts (Radix portals content async).
  // Immediately hide vertical scroll to prevent a brief scrollbar flash during entrance animation.
  const setRightColRef = useCallback((el: HTMLDivElement | null) => {
    rightColRef.current = el;
    if (el) {
      el.style.overflowY = 'hidden';
    }
  }, []);

  // After the staggered entrance animation settles (~1.6s), re-enable vertical scroll.
  // Uses direct DOM manipulation to avoid React state churn.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (rightColRef.current) {
        rightColRef.current.style.overflowY = 'auto';
      }
    }, 1600);
    return () => clearTimeout(timer);
  }, [open]);

  // ---------- Handlers ----------
  const handlePresetChange = useCallback((preset: typeof SIZE_PRESETS[number]) => {
    setSizePreset(preset.label);
    if (preset.label !== 'Custom') {
      setWidthPx(preset.widthPx);
      setHeightPx(preset.heightPx);
    }
  }, []);

  const handleWidthChange = useCallback((val: number) => {
    setWidthPx(val);
    if (sizePreset !== 'Custom') setSizePreset('Custom');
  }, [sizePreset]);

  const handleHeightChange = useCallback((val: number) => {
    setHeightPx(val);
    if (sizePreset !== 'Custom') setSizePreset('Custom');
  }, [sizePreset]);

  const getMarginValues = useCallback(() => {
    if (marginPreset === 'custom') {
      return { top: customMargin, bottom: customMargin, left: customMargin, right: customMargin };
    }
    return MARGIN_PRESETS[marginPreset];
  }, [marginPreset, customMargin]);

  const handleCreate = useCallback(() => {
    setCreating(true);
    const margins = getMarginValues();
    const canvasSettings: CanvasSettings = {
      ...DEFAULT_CANVAS_SETTINGS,
      pageWidth: Math.max(100, widthPx),
      pageHeight: Math.max(100, heightPx),
      marginPreset,
      marginTop: margins.top,
      marginBottom: margins.bottom,
      marginLeft: margins.left,
      marginRight: margins.right,
      pageBackgroundColor: '#ffffff',
      marginGuideline: {
        ...DEFAULT_CANVAS_SETTINGS.marginGuideline,
        color: DEFAULT_ACCENT,
      },
    };
    const name = projectName.trim() || 'Untitled Template';
    // Apply the chosen property display mode to the store
    setPropertyDisplayMode(propertyMode);
    // Brief shimmer then close + create
    if (createTimerRef.current) clearTimeout(createTimerRef.current);
    createTimerRef.current = setTimeout(() => {
      createTimerRef.current = null;
      newProject({ projectName: name, canvasSettings });
      onOpenChange(false);
      setCreating(false);
    }, 650);
  }, [projectName, widthPx, heightPx, marginPreset, customMargin, propertyMode, newProject, getMarginValues, onOpenChange, setPropertyDisplayMode]);

  const handleOpen = useCallback(async () => {
    // Only close the welcome modal once a project file has actually been
    // selected and loaded. loadProject returns false when the user cancels
    // the file picker (or the load fails), so the modal stays open and the
    // user can try again or choose a different action.
    const loaded = await loadProject();
    if (loaded) {
      onOpenChange(false);
    }
  }, [loadProject, onOpenChange]);

  // ---------- Derived ----------
  const marginValues = useMemo(() => getMarginValues(), [getMarginValues]);

  // Preview dimensions — scaled by a reference max so different presets visibly differ in size
  // (not just aspect ratio). The largest preset dimension maps to PREVIEW_AREA_H.
  const PREVIEW_AREA_W = 288;
  const PREVIEW_AREA_H = 240;
  const REF_MAX_DIM = 1344; // largest dimension across all presets (Legal height)
  const baseScale = PREVIEW_AREA_H / REF_MAX_DIM; // ~0.179
  const fitScale = Math.min(
    PREVIEW_AREA_W / Math.max(1, widthPx),
    PREVIEW_AREA_H / Math.max(1, heightPx)
  );
  const previewScale = Math.min(baseScale, fitScale);
  const previewWidth = Math.max(24, widthPx * previewScale);
  const previewHeight = Math.max(24, heightPx * previewScale);

  // Stagger config for entrance animation — tuned to be visible after loading screen fades
  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.09, delayChildren: 0.15, when: 'beforeChildren' },
    },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
    },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[920px] w-[92vw] p-0 gap-0 overflow-hidden rounded-2xl border-border/60 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.08),0_24px_48px_rgba(0,0,0,0.06)] ring-1 ring-inset ring-white/[0.06] dark:ring-white/[0.04]"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Film grain overlay — applies to entire modal */}
        <div
          className="pointer-events-none absolute inset-0 z-[60] opacity-[0.015] mix-blend-overlay"
          aria-hidden="true"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
            backgroundRepeat: 'repeat',
            backgroundSize: '200px 200px',
          }}
        />

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-[40%_60%] min-h-[560px] max-h-[88vh] overflow-x-hidden"
        >
          {/* ===================== LEFT: Branding Hero ===================== */}
          <div className="relative bg-gradient-to-br from-primary/8 via-primary/4 to-transparent overflow-hidden flex flex-col">
            {/* Animated mesh gradient blobs */}
            <motion.div
              className="absolute -top-20 -left-20 w-72 h-72 rounded-full bg-primary/10 blur-3xl"
              animate={{
                x: [0, 30, 0],
                y: [0, 20, 0],
                scale: [1, 1.1, 1],
              }}
              transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute bottom-0 right-0 w-64 h-64 rounded-full bg-amber-400/[0.04] blur-3xl"
              animate={{
                x: [0, -25, 0],
                y: [0, -15, 0],
                scale: [1, 1.15, 1],
              }}
              transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute top-1/3 right-1/4 w-48 h-48 rounded-full bg-rose-400/[0.03] blur-3xl"
              animate={{
                x: [0, 20, 0],
                y: [0, 25, 0],
              }}
              transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
            />

            {/* Content */}
            <div className="relative z-10 flex flex-col h-full px-8 pt-10 pb-8 flex-1">
              {/* Sparkle accent + brand */}
              <motion.div variants={itemVariants} className="flex items-center gap-2 mb-1">
                <Sparkles className="h-3.5 w-3.5 text-primary/60" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/80">
                  Invoice Studio
                </span>
              </motion.div>

              <motion.div variants={itemVariants} className="mt-2">
                <h1
                  className="text-3xl font-bold tracking-tight leading-[1.05] bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-transparent"
                >
                  Open Invoice
                </h1>
                {/* MJC brand mark — same size as the heading, gradient starts with primary on the left and ends with pink */}
                <div className="mt-2 flex flex-col">
                  <span className="text-3xl font-black tracking-[0.22em] leading-none bg-gradient-to-r from-primary via-rose-400 to-pink-500 bg-clip-text text-transparent">
                    MJC
                  </span>
                  {/* Brand-signature flourish — thin gradient underline */}
                  <span className="h-[2px] w-14 mt-2 rounded-full bg-gradient-to-r from-primary via-rose-400 to-pink-500 opacity-50" />
                </div>
                <p className="text-xs text-muted-foreground/70 mt-3 leading-relaxed">
                  Let&apos;s set up your workspace.<br />
                  You can change everything later.
                </p>
              </motion.div>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Live canvas preview — actual size scaled to fit, with turtle logo watermark */}
              <motion.div variants={itemVariants} className="relative">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-2">
                  Preview
                </div>
                <div
                  className="relative flex items-center justify-center"
                  style={{ height: PREVIEW_AREA_H }}
                >
                  {/* Page — uses actual pixel dimensions × scale, so different presets visibly differ */}
                  <div
                    className="relative bg-white rounded-sm shadow-md ring-1 ring-black/[0.06] transition-all duration-300 overflow-hidden"
                    style={{
                      width: `${previewWidth}px`,
                      height: `${previewHeight}px`,
                    }}
                  >
                    {/* Turtle logo watermark — faded brand mark on the invoice page; scales with preview size */}
                    <img
                      src="/Logo.png"
                      alt=""
                      aria-hidden="true"
                      className="absolute inset-0 m-auto pointer-events-none select-none object-contain mix-blend-multiply"
                      style={{
                        width: '55%',
                        height: '55%',
                        opacity: 0.09,
                      }}
                    />
                    {/* Margin guide */}
                    <div
                      className="absolute border-dashed rounded-[1px] transition-all duration-300"
                      style={{
                        top: `${(marginValues.top / heightPx) * 100}%`,
                        bottom: `${(marginValues.bottom / heightPx) * 100}%`,
                        left: `${(marginValues.left / widthPx) * 100}%`,
                        right: `${(marginValues.right / widthPx) * 100}%`,
                        borderColor: `${DEFAULT_ACCENT}66`,
                        borderWidth: 1,
                      }}
                    />
                    {/* Accent corner — scales with preview size */}
                    <div
                      className="absolute top-0 left-0 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(34, Math.max(10, previewWidth * 0.22))}px`,
                        height: `${Math.max(2, previewHeight * 0.014)}px`,
                        backgroundColor: DEFAULT_ACCENT,
                      }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-center gap-1.5 mt-2 text-[10px] text-muted-foreground/70">
                  <span>{widthPx} × {heightPx}</span>
                  <span className="text-muted-foreground/40">px</span>
                </div>
              </motion.div>

              {/* Version badge + hints toggle — bottom row of the branding hero.
                  The toggle controls the on-canvas keyboard shortcut hints in
                  the workspace background in real time. Default ON (hints
                  visible); unchecking animates them away smoothly. */}
              <motion.div variants={itemVariants} className="flex items-center justify-between mt-4 pt-3 border-t border-border/40">
                <span className="text-[10px] text-muted-foreground/50">v1.0</span>
                <label
                  htmlFor="welcome-show-hints"
                  className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer select-none"
                >
                  <Lightbulb className="h-3 w-3" />
                  Hints
                  <Switch
                    id="welcome-show-hints"
                    checked={shortcutsOverlayVisible}
                    onCheckedChange={setShortcutsOverlayVisible}
                    aria-label="Show on-canvas hints"
                    className="scale-90 ml-0.5"
                  />
                </label>
              </motion.div>
            </div>
          </div>

          {/* ===================== RIGHT: Form ===================== */}
          <div ref={setRightColRef} className="relative bg-background overflow-y-auto overflow-x-hidden flex flex-col">
            {/* Form content */}
            <div className="relative flex flex-col h-full">
              {/* Header */}
              <motion.div variants={itemVariants} className="px-7 pt-7 pb-5 border-b border-border/50">
                <DialogHeader className="space-y-0">
                  <DialogTitle className="text-lg font-semibold tracking-tight">
                    Create a new template
                  </DialogTitle>
                  <DialogDescription className="sr-only">
                    Configure your invoice template settings
                  </DialogDescription>
                </DialogHeader>
              </motion.div>

              {/* Scrollable form */}
              <div className="flex-1 px-7 py-6 space-y-6">
                {/* Template Name */}
                <motion.div variants={itemVariants} className="space-y-1.5">
                  <Label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Template Name
                  </Label>
                  <Input
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Enter template name..."
                    className="h-9 text-sm rounded-md border-border/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0 focus-visible:border-primary/40 transition-all"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate();
                    }}
                  />
                </motion.div>

                {/* Canvas Size — Quick-start chips */}
                <motion.div variants={itemVariants} className="space-y-2">
                  <Label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Canvas Size
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {SIZE_PRESETS.map((preset) => {
                      const selected = sizePreset === preset.label;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => handlePresetChange(preset)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${
                            selected
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background text-muted-foreground border-border/60 hover:border-border hover:text-foreground'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Width / Height (px only) */}
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Width (px)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={widthPx}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          handleWidthChange(val);
                        }}
                        className="h-8 text-xs rounded-md border-border/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/40 transition-all"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Height (px)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={heightPx}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          handleHeightChange(val);
                        }}
                        className="h-8 text-xs rounded-md border-border/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/40 transition-all"
                      />
                    </div>
                  </div>
                </motion.div>

                {/* Margin */}
                <motion.div variants={itemVariants} className="space-y-2">
                  <Label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Margin
                  </Label>
                  {/* Preset buttons + custom margin input share ONE row so toggling
                      "Custom" never changes the modal height — the input animates its
                      width in place rather than appearing on a new line. */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {MARGIN_PRESET_OPTIONS.map((opt) => {
                      const selected = marginPreset === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setMarginPreset(opt.value)}
                          className={`px-2 py-1 rounded-full text-[10px] font-medium transition-all border ${
                            selected
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background text-muted-foreground border-border/60 hover:border-border hover:text-foreground'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                    {/* Custom margin input — animates width/opacity in place when
                        "Custom" is selected, so the modal height stays constant. */}
                    <motion.div
                      initial={false}
                      animate={{
                        width: marginPreset === 'custom' ? 'auto' : 0,
                        opacity: marginPreset === 'custom' ? 1 : 0,
                        marginLeft: marginPreset === 'custom' ? 4 : 0,
                      }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                      style={{ alignSelf: 'center' }}
                    >
                      <Input
                        type="number"
                        min={0}
                        max={500}
                        value={customMargin}
                        onChange={(e) => setCustomMargin(Math.max(0, +e.target.value))}
                        className="h-7 w-20 text-[11px] rounded-md border-border/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/40 transition-all"
                      />
                    </motion.div>
                  </div>
                </motion.div>

                {/* Property Display — segmented control */}
                <motion.div variants={itemVariants} className="space-y-2">
                  <Label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Property Display
                  </Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {PROPERTY_DISPLAY_OPTIONS.map((opt) => {
                      const selected = propertyMode === opt.value;
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setPropertyMode(opt.value);
                            // Apply to the store IMMEDIATELY so the side panel
                            // appears/disappears in real time behind the modal
                            // (with a smooth transition handled by PropertiesPanel).
                            setPropertyDisplayMode(opt.value);
                          }}
                          className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[11px] font-medium transition-all border ${
                            selected
                              ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                              : 'bg-background text-muted-foreground border-border/60 hover:border-border hover:text-foreground'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {/* Dynamic description — subtle, fades on change */}
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 leading-tight h-3.5">
                    <motion.span
                      key={propertyMode}
                      initial={{ opacity: 0, y: -3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      className="truncate"
                    >
                      {PROPERTY_DISPLAY_OPTIONS.find((o) => o.value === propertyMode)?.description}
                    </motion.span>
                    <span className="text-muted-foreground/30">·</span>
                    <span className="text-muted-foreground/45 whitespace-nowrap">Change anytime in Settings</span>
                  </div>
                </motion.div>
              </div>

              {/* Footer buttons */}
              <motion.div variants={itemVariants} className="px-7 py-4 border-t border-border/50 flex items-center justify-end bg-background/80 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5 text-xs"
                    onClick={handleOpen}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Open
                  </Button>
                  <Button
                    size="sm"
                    className="h-9 gap-1.5 text-xs shadow-sm relative overflow-hidden"
                    onClick={handleCreate}
                    disabled={creating}
                  >
                    {creating ? (
                      <>
                        {/* Shimmer overlay */}
                        <span
                          className="absolute inset-0 -translate-x-full animate-[shimmer_0.65s_ease-out]"
                          style={{
                            background:
                              'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
                          }}
                        />
                        <Sparkles className="h-3.5 w-3.5" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        Create
                        <kbd className="ml-0.5 text-[9px] font-medium opacity-70 px-1 py-0.5 rounded bg-primary-foreground/15">
                          ⌘↵
                        </kbd>
                      </>
                    )}
                  </Button>
                </div>
              </motion.div>
            </div>
          </div>
        </motion.div>

        {/* Local style: shimmer keyframe + scroll refinements */}
        <style jsx global>{`
          @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
          /* Hide horizontal scrollbar everywhere in the dialog — prevents brief flash during entrance animation.
             Firefox: relies on overflow-x: hidden (set via Tailwind classes) to prevent horizontal scroll entirely.
             WebKit: explicitly hide only the horizontal scrollbar track. */
          [data-slot="dialog-content"]::-webkit-scrollbar:horizontal,
          [data-slot="dialog-content"] *::-webkit-scrollbar:horizontal {
            display: none !important;
          }
          .max-h-\\[88vh\\]::-webkit-scrollbar {
            width: 6px;
          }
          .max-h-\\[88vh\\]::-webkit-scrollbar-track {
            background: transparent;
          }
          .max-h-\\[88vh\\]::-webkit-scrollbar-thumb {
            background: hsl(var(--border) / 0.5);
            border-radius: 3px;
          }
          .max-h-\\[88vh\\]::-webkit-scrollbar-thumb:hover {
            background: hsl(var(--border));
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}
