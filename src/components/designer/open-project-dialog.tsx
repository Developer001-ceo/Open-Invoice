'use client';

import { useDesignerStore } from '@/store/designer-store';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FolderOpen, Clock, FileText, X } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import {
  getRecentProjects,
  removeRecentProject,
  clearRecentProjects,
  formatLastOpened,
  type RecentProjectEntry,
} from '@/lib/recent-projects';
import { thumbnailToDataUrl, getPlaceholderThumbnail } from '@/lib/thumbnail';
import { openProjectWithDialog } from '@/lib/project-file';

export function OpenProjectDialog() {
  const newProjectOpen = useDesignerStore((s) => s.newProjectOpen);
  const setNewProjectOpen = useDesignerStore((s) => s.setNewProjectOpen);
  const loadProjectFromFileData = useDesignerStore((s) => s.loadProjectFromFileData);

  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load recent projects when dialog opens
  useEffect(() => {
    if (newProjectOpen) {
      setRecentProjects(getRecentProjects());
    }
  }, [newProjectOpen]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setNewProjectOpen(false);
      }
    },
    [setNewProjectOpen],
  );

  // Browse for a file using the native file picker
  const handleBrowse = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await openProjectWithDialog();
      loadProjectFromFileData(result.project);
      setNewProjectOpen(false);

      // Update recent projects list
      setRecentProjects(getRecentProjects());
    } catch (err) {
      if (err instanceof Error && err.message !== 'File selection cancelled') {
        console.error('Failed to open project:', err);
      }
    } finally {
      setIsLoading(false);
    }
  }, [loadProjectFromFileData, setNewProjectOpen]);

  // Remove a recent project entry
  const handleRemoveRecent = useCallback((filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeRecentProject(filename);
    setRecentProjects(getRecentProjects());
  }, []);

  // Clear all recent projects
  const handleClearRecent = useCallback(() => {
    clearRecentProjects();
    setRecentProjects([]);
  }, []);

  return (
    <Dialog open={newProjectOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px] p-0 gap-0 max-h-[80vh] flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle className="text-lg font-semibold flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            Open Project
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-4 shrink-0">
          <Button
            className="w-full h-11 gap-2"
            onClick={handleBrowse}
            disabled={isLoading}
          >
            <FolderOpen className="h-4 w-4" />
            {isLoading ? 'Opening...' : 'Browse for .mjc File'}
          </Button>
        </div>

        {/* Recent Projects Section */}
        {recentProjects.length > 0 && (
          <div className="flex items-center justify-between px-6 pb-2 shrink-0">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Recent Projects
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground hover:text-destructive"
              onClick={handleClearRecent}
            >
              Clear All
            </Button>
          </div>
        )}

        <div className="flex-1 min-h-0 px-6 pb-6">
          <ScrollArea className="h-full max-h-[400px]">
            {recentProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
                  <FileText className="h-7 w-7 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">No recent projects</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Save or open a project to see it here
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentProjects.map((project) => (
                  <RecentProjectCard
                    key={project.filename}
                    project={project}
                    onRemove={handleRemoveRecent}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecentProjectCard({
  project,
  onRemove,
}: {
  project: RecentProjectEntry;
  onRemove: (filename: string, e: React.MouseEvent) => void;
}) {
  const thumbnailSrc = project.thumbnail
    ? thumbnailToDataUrl(project.thumbnail)
    : getPlaceholderThumbnail();

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:bg-accent/50 transition-colors group">
      {/* Thumbnail */}
      <div className="w-14 h-14 rounded-md border border-border bg-white overflow-hidden shrink-0 flex items-center justify-center">
        <img
          src={thumbnailSrc}
          alt={project.projectName}
          className="max-w-full max-h-full object-contain"
          style={{ imageRendering: 'auto' }}
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{project.projectName}</p>
        <p className="text-xs text-muted-foreground truncate">{project.filename}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-muted-foreground">
            {project.pageCount} element{project.pageCount !== 1 ? 's' : ''}
          </span>
          <span className="text-[11px] text-muted-foreground">·</span>
          <span className="text-[11px] text-muted-foreground">
            {formatLastOpened(project.lastOpened)}
          </span>
        </div>
      </div>

      {/* Remove button */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        onClick={(e) => onRemove(project.filename, e)}
        aria-label={`Remove ${project.filename} from recent projects`}
        title="Remove from recent"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
