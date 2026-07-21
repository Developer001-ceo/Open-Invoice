'use client';

import { useDesignerStore, PAGE_SIZE_PRESETS, CanvasSettings, DEFAULT_CANVAS_SETTINGS } from '@/store/designer-store';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText } from 'lucide-react';
import { useState } from 'react';

function NewProjectDialogContent() {
  const newProject = useDesignerStore((s) => s.newProject);
  const setNewProjectOpen = useDesignerStore((s) => s.setNewProjectOpen);

  const [projectName, setProjectName] = useState('Untitled Project');
  const [pageSizePreset, setPageSizePreset] = useState('A4 (210 × 297 mm)');
  const [pageWidth, setPageWidth] = useState(794);
  const [pageHeight, setPageHeight] = useState(1123);

  const handlePresetChange = (label: string) => {
    setPageSizePreset(label);
    if (label !== 'Custom') {
      const preset = PAGE_SIZE_PRESETS.find((p) => p.label === label);
      if (preset) {
        setPageWidth(preset.width);
        setPageHeight(preset.height);
      }
    }
  };

  const handleCreate = () => {
    const canvasSettings: CanvasSettings = {
      ...DEFAULT_CANVAS_SETTINGS,
      pageWidth: Math.max(100, pageWidth),
      pageHeight: Math.max(100, pageHeight),
    };
    newProject({ projectName: projectName.trim() || 'Untitled Project', canvasSettings });
    setNewProjectOpen(false);
  };

  const handleCancel = () => {
    setNewProjectOpen(false);
  };

  return (
    <>
      <div className="px-6 pb-6 space-y-5">
        {/* Project Name */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Project Name</Label>
          <Input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Enter project name..."
            className="h-9 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
          />
        </div>

        {/* Page Size */}
        <div className="space-y-3">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Canvas Size</Label>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Preset</Label>
            <Select value={pageSizePreset} onValueChange={handlePresetChange}>
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Width (px)</Label>
              <Input
                type="number"
                min={100}
                max={5000}
                value={pageWidth}
                onChange={(e) => {
                  const val = Math.max(100, +e.target.value);
                  setPageWidth(val);
                  // Auto-switch to Custom if values don't match current preset
                  const preset = PAGE_SIZE_PRESETS.find((p) => p.label === pageSizePreset && p.label !== 'Custom');
                  if (preset && (val !== preset.width || pageHeight !== preset.height)) {
                    setPageSizePreset('Custom');
                  }
                }}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Height (px)</Label>
              <Input
                type="number"
                min={100}
                max={5000}
                value={pageHeight}
                onChange={(e) => {
                  const val = Math.max(100, +e.target.value);
                  setPageHeight(val);
                  // Auto-switch to Custom if values don't match current preset
                  const preset = PAGE_SIZE_PRESETS.find((p) => p.label === pageSizePreset && p.label !== 'Custom');
                  if (preset && (pageWidth !== preset.width || val !== preset.height)) {
                    setPageSizePreset('Custom');
                  }
                }}
                className="h-8 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Preview card */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border">
          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{projectName || 'Untitled Project'}</p>
            <p className="text-xs text-muted-foreground">
              {pageWidth} × {pageHeight} px
            </p>
          </div>
        </div>
      </div>

      <DialogFooter className="px-6 py-4 border-t border-border gap-2">
        <Button variant="outline" size="sm" onClick={handleCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleCreate}>
          Create Project
        </Button>
      </DialogFooter>
    </>
  );
}

export function NewProjectDialog() {
  const newProjectOpen = useDesignerStore((s) => s.newProjectOpen);
  const setNewProjectOpen = useDesignerStore((s) => s.setNewProjectOpen);

  const [dialogKey, setDialogKey] = useState(0);

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setDialogKey((k) => k + 1);
    }
    setNewProjectOpen(open);
  };

  return (
    <Dialog open={newProjectOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px] p-0 gap-0" key={dialogKey}>
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="text-lg font-semibold">New Project</DialogTitle>
        </DialogHeader>
        <NewProjectDialogContent />
      </DialogContent>
    </Dialog>
  );
}
