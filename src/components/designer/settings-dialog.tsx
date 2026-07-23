'use client';

import { useDesignerStore, PAGE_SIZE_PRESETS, MARGIN_PRESETS, MarginPreset, CanvasSettings, MarginGuidelineSettings, PropertyDisplayMode } from '@/store/designer-store';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ColorInput } from '@/components/ui/color-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useState, useEffect, useCallback } from 'react';
import { FileText, Space, Ruler, Keyboard, LayoutDashboard } from 'lucide-react';
import { ShortcutDefinition, loadShortcuts, saveShortcut, resetShortcuts, keyEventToString } from '@/lib/shortcuts';

// Inner component that re-mounts when dialog opens (via key), so draft resets automatically
function SettingsDialogContent() {
  const canvasSettings = useDesignerStore((s) => s.canvasSettings);
  const updateCanvasSettings = useDesignerStore((s) => s.updateCanvasSettings);
  const setSettingsOpen = useDesignerStore((s) => s.setSettingsOpen);
  const projectName = useDesignerStore((s) => s.projectName);
  const setProjectName = useDesignerStore((s) => s.setProjectName);

  // Draft initializes from current settings each time the component mounts
  const [draft, setDraft] = useState<CanvasSettings>({ ...canvasSettings });
  const [draftName, setDraftName] = useState(projectName);
  const [draftDisplayMode, setDraftDisplayMode] = useState<PropertyDisplayMode>(useDesignerStore.getState().propertyDisplayMode);

  const handleSave = () => {
    updateCanvasSettings(draft);
    if (draftName.trim()) {
      setProjectName(draftName.trim());
    }
    // Save property display mode
    useDesignerStore.getState().setPropertyDisplayMode(draftDisplayMode);
    setSettingsOpen(false);
  };

  const handleCancel = () => {
    setDraft({ ...canvasSettings });
    setDraftName(projectName);
    setDraftDisplayMode(useDesignerStore.getState().propertyDisplayMode);
    setSettingsOpen(false);
  };

  const updateDraft = (updates: Partial<CanvasSettings>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
  };

  const updateMarginGuideline = (updates: Partial<MarginGuidelineSettings>) => {
    setDraft((prev) => ({
      ...prev,
      marginGuideline: { ...prev.marginGuideline, ...updates },
    }));
  };

  const handlePresetChange = (preset: MarginPreset) => {
    if (preset === 'custom') {
      updateDraft({ marginPreset: 'custom' });
    } else {
      const values = MARGIN_PRESETS[preset];
      updateDraft({
        marginPreset: preset,
        marginTop: values.top,
        marginBottom: values.bottom,
        marginLeft: values.left,
        marginRight: values.right,
      });
    }
  };

  // When margin values change manually, switch to custom
  const handleMarginChange = (field: 'marginTop' | 'marginBottom' | 'marginLeft' | 'marginRight', value: number) => {
    const newDraft = { ...draft, [field]: value, marginPreset: 'custom' as MarginPreset };
    // Check if the new values match a preset
    for (const [key, preset] of Object.entries(MARGIN_PRESETS)) {
      if (
        Math.abs((newDraft.marginTop) - preset.top) < 1 &&
        Math.abs((newDraft.marginBottom) - preset.bottom) < 1 &&
        Math.abs((newDraft.marginLeft) - preset.left) < 1 &&
        Math.abs((newDraft.marginRight) - preset.right) < 1
      ) {
        newDraft.marginPreset = key as MarginPreset;
        break;
      }
    }
    setDraft(newDraft);
  };

  const currentPresetLabel = PAGE_SIZE_PRESETS.find(
    (p) => p.width === draft.pageWidth && p.height === draft.pageHeight
  )?.label || 'Custom';

  const isCustomPageSize = !PAGE_SIZE_PRESETS.some(
    (p) => p.label !== 'Custom' && p.width === draft.pageWidth && p.height === draft.pageHeight
  );

  return (
    <>
      <Tabs defaultValue="project" className="flex-1 flex flex-col min-h-0">
        <div className="px-6 pt-2 pb-2">
          <TabsList className="w-full">
            <TabsTrigger value="project" className="gap-1.5 text-xs">
              <FileText className="h-3.5 w-3.5" />
              Project
            </TabsTrigger>
            <TabsTrigger value="margins" className="gap-1.5 text-xs">
              <Space className="h-3.5 w-3.5" />
              Margins
            </TabsTrigger>
            <TabsTrigger value="guidelines" className="gap-1.5 text-xs">
              <Ruler className="h-3.5 w-3.5" />
              Guidelines
            </TabsTrigger>
            <TabsTrigger value="display" className="gap-1.5 text-xs">
              <LayoutDashboard className="h-3.5 w-3.5" />
              Display
            </TabsTrigger>
            <TabsTrigger value="shortcuts" className="gap-1.5 text-xs">
              <Keyboard className="h-3.5 w-3.5" />
              Shortcuts
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="h-[300px] overflow-y-auto px-6 pb-6">
          {/* ── Tab 1: Project & Page Size ── */}
          <TabsContent value="project" className="space-y-5 mt-0">
            {/* Project Name */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Project Name</Label>
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Enter project name..."
                className="h-8 text-xs"
              />
            </div>

            {/* Page Size */}
            <div className="space-y-3">
              <Label className="text-xs text-muted-foreground">Page Size</Label>
              <Select
                value={isCustomPageSize ? 'Custom' : currentPresetLabel}
                onValueChange={(val) => {
                  const preset = PAGE_SIZE_PRESETS.find((p) => p.label === val);
                  if (preset && val !== 'Custom') {
                    updateDraft({ pageWidth: preset.width, pageHeight: preset.height });
                  } else {
                    updateDraft({});
                  }
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_PRESETS.map((preset) => (
                    <SelectItem key={preset.label} value={preset.label}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Width (px)</Label>
                  <Input
                    type="number"
                    min={100}
                    max={5000}
                    value={draft.pageWidth}
                    onChange={(e) => updateDraft({ pageWidth: Math.max(100, +e.target.value) })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Height (px)</Label>
                  <Input
                    type="number"
                    min={100}
                    max={5000}
                    value={draft.pageHeight}
                    onChange={(e) => updateDraft({ pageHeight: Math.max(100, +e.target.value) })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {/* Page Background Color */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Page Background</Label>
                <ColorInput
                  value={draft.pageBackgroundColor ?? '#ffffff'}
                  onChange={(v) => updateDraft({ pageBackgroundColor: v })}
                />
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 2: Page Margins ── */}
          <TabsContent value="margins" className="space-y-5 mt-0">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Margin Preset</Label>
                <Select
                  value={draft.marginPreset}
                  onValueChange={(val) => handlePresetChange(val as MarginPreset)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="narrow">Narrow (25px)</SelectItem>
                    <SelectItem value="normal">Normal (50px)</SelectItem>
                    <SelectItem value="wide">Wide (80px)</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Top (px)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={500}
                    value={draft.marginTop}
                    onChange={(e) => handleMarginChange('marginTop', Math.max(0, +e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Bottom (px)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={500}
                    value={draft.marginBottom}
                    onChange={(e) => handleMarginChange('marginBottom', Math.max(0, +e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Left (px)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={500}
                    value={draft.marginLeft}
                    onChange={(e) => handleMarginChange('marginLeft', Math.max(0, +e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Right (px)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={500}
                    value={draft.marginRight}
                    onChange={(e) => handleMarginChange('marginRight', Math.max(0, +e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 3: Margin Guidelines ── */}
          <TabsContent value="guidelines" className="space-y-5 mt-0">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Show Guidelines</Label>
              <Switch
                checked={draft.marginGuideline.show}
                onCheckedChange={(checked) => updateMarginGuideline({ show: checked })}
              />
            </div>

            {draft.marginGuideline.show && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Guideline Color</Label>
                    <ColorInput
                      value={draft.marginGuideline.color}
                      onChange={(v) => updateMarginGuideline({ color: v })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Thickness</Label>
                    <div className="flex items-center gap-1.5">
                      <Slider
                        value={[draft.marginGuideline.thickness]}
                        min={1}
                        max={5}
                        step={1}
                        onValueChange={([v]) => updateMarginGuideline({ thickness: v })}
                        className="flex-1"
                      />
                      <span className="text-xs text-muted-foreground w-6 text-right">{draft.marginGuideline.thickness}px</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Style</Label>
                    <Select
                      value={draft.marginGuideline.style}
                      onValueChange={(v) => updateMarginGuideline({ style: v as 'solid' | 'dashed' })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="solid">Solid</SelectItem>
                        <SelectItem value="dashed">Dashed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Opacity</Label>
                    <div className="flex items-center gap-1.5">
                      <Slider
                        value={[draft.marginGuideline.opacity]}
                        min={5}
                        max={100}
                        step={5}
                        onValueChange={([v]) => updateMarginGuideline({ opacity: v })}
                        className="flex-1"
                      />
                      <span className="text-xs text-muted-foreground w-8 text-right">{draft.marginGuideline.opacity}%</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!draft.marginGuideline.show && (
              <p className="text-xs text-muted-foreground text-center py-6">
                Enable guidelines to see margin boundaries on the canvas
              </p>
            )}
          </TabsContent>

          {/* ── Tab 4: Property Display Mode ── */}
          <TabsContent value="display" className="space-y-5 mt-0">
            <div className="space-y-3">
              <Label className="text-xs text-muted-foreground">Property Display Mode</Label>
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                Choose how you want to interact with element properties. You can always use <kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono text-[10px]">Shift+S</kbd> to open the Spotlight Property Picker regardless of this setting.
              </p>
              <div className="space-y-2 mt-3">
                {/* Option: Side Panel */}
                <button
                  type="button"
                  className={`w-full text-left rounded-lg border p-3 transition-all duration-150 ${
                    draftDisplayMode === 'panel'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border hover:border-border/80 hover:bg-accent/30'
                  }`}
                  onClick={() => setDraftDisplayMode('panel')}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-3 h-3 rounded-full border-2 ${draftDisplayMode === 'panel' ? 'border-primary bg-primary' : 'border-muted-foreground/30'}`} />
                    <span className="text-sm font-medium">Side Panel</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground ml-5">Traditional properties panel on the right side. Default view.</p>
                </button>

                {/* Option: Floating Cards */}
                <button
                  type="button"
                  className={`w-full text-left rounded-lg border p-3 transition-all duration-150 ${
                    draftDisplayMode === 'floating'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border hover:border-border/80 hover:bg-accent/30'
                  }`}
                  onClick={() => setDraftDisplayMode('floating')}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-3 h-3 rounded-full border-2 ${draftDisplayMode === 'floating' ? 'border-primary bg-primary' : 'border-muted-foreground/30'}`} />
                    <span className="text-sm font-medium">Floating Cards</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[10px] text-muted-foreground">Shift+S</kbd>
                  </div>
                  <p className="text-[11px] text-muted-foreground ml-5">Use spotlight picker to select floating property cards. Side panel is hidden.</p>
                </button>

                {/* Option: Both */}
                <button
                  type="button"
                  className={`w-full text-left rounded-lg border p-3 transition-all duration-150 ${
                    draftDisplayMode === 'both'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border hover:border-border/80 hover:bg-accent/30'
                  }`}
                  onClick={() => setDraftDisplayMode('both')}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-3 h-3 rounded-full border-2 ${draftDisplayMode === 'both' ? 'border-primary bg-primary' : 'border-muted-foreground/30'}`} />
                    <span className="text-sm font-medium">Both</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground ml-5">Side panel always visible + Shift+S also works for floating cards.</p>
                </button>
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 5: Keyboard Shortcuts ── */}
          <TabsContent value="shortcuts" className="mt-0">
            <ShortcutsTab />
          </TabsContent>
        </div>
      </Tabs>

      <DialogFooter className="px-6 py-4 border-t border-border gap-2">
        <Button variant="outline" size="sm" onClick={handleCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

// Shortcuts tab component
function ShortcutsTab() {
  const [shortcuts, setShortcuts] = useState<ShortcutDefinition[]>(() => loadShortcuts());
  const [listeningId, setListeningId] = useState<string | null>(null);

  // Group shortcuts by category
  const categories = Array.from(new Set(shortcuts.map(s => s.category)));

  const handleReset = () => {
    const reset = resetShortcuts();
    setShortcuts(reset);
  };

  const handleShortcutClick = (id: string) => {
    setListeningId(id);
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!listeningId) return;
    e.preventDefault();
    e.stopPropagation();

    // Escape cancels listening
    if (e.key === 'Escape') {
      setListeningId(null);
      return;
    }

    const keyStr = keyEventToString(e);
    // Don't record pure modifier presses
    if (['Ctrl', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    const updated = saveShortcut(listeningId, keyStr);
    setShortcuts(updated);
    setListeningId(null);
  }, [listeningId]);

  useEffect(() => {
    if (!listeningId) return;
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [listeningId, handleKeyDown]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Click a shortcut to customize it. Press Escape to cancel.</p>
        <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={handleReset}>
          Reset to Defaults
        </Button>
      </div>

      {categories.map(cat => (
        <div key={cat}>
          <h4 className="text-xs font-semibold text-foreground mb-1.5">{cat}</h4>
          <div className="space-y-0.5">
            {shortcuts.filter(s => s.category === cat).map(s => (
              <div
                key={s.id}
                className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-accent/50 cursor-pointer transition-colors"
                onClick={() => handleShortcutClick(s.id)}
              >
                <span className="text-xs text-foreground">{s.label}</span>
                <kbd
                  className={`text-[10px] px-2 py-0.5 rounded border font-mono transition-colors ${
                    listeningId === s.id
                      ? 'bg-primary text-primary-foreground border-primary animate-pulse'
                      : 'bg-muted text-muted-foreground border-border'
                  }`}
                >
                  {listeningId === s.id ? 'Press keys...' : s.currentKeys}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Outer wrapper that provides Dialog + key for resetting draft on open
export function SettingsDialog() {
  const settingsOpen = useDesignerStore((s) => s.settingsOpen);
  const setSettingsOpen = useDesignerStore((s) => s.setSettingsOpen);

  // Using a key based on a counter that increments on each open
  // so the inner component fully re-mounts and draft state resets
  const [dialogKey, setDialogKey] = useState(0);

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setDialogKey((k) => k + 1);
    }
    setSettingsOpen(open);
  };

  return (
    <Dialog open={settingsOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px] p-0 gap-0 flex flex-col max-h-[80vh]" key={dialogKey}>
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-lg font-semibold">Canvas Settings</DialogTitle>
        </DialogHeader>
        <SettingsDialogContent />
      </DialogContent>
    </Dialog>
  );
}
