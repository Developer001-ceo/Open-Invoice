'use client';

/**
 * Next.js App Router error boundary.
 *
 * Catches uncaught errors thrown during render of any route segment under
 * src/app (including the main designer page). Without this, a single
 * render-time throw (e.g. a malformed project file producing invalid state)
 * would white-screen the whole app with no recovery path.
 *
 * This boundary shows a friendly recovery screen with "Reload" and "Reset
 * project" actions. `error.digest` is surfaced for support/debugging.
 *
 * Note: this component is only shown on the client for unexpected errors.
 * Intentional, handled errors (try/catch in event handlers, API failures) are
 * not routed through here.
 */

import { useEffect } from 'react';
import { RotateCw, Trash2, AlertTriangle } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Log to the console so it shows up in dev / production debugging tools.
  useEffect(() => {
    console.error('[app-error-boundary]', error);
  }, [error]);

  const handleResetProject = () => {
    // Clear any persisted draft / project state that might be the source of
    // the crash, then reload. We deliberately touch localStorage directly
    // (rather than going through the store) because the store may be in a
    // broken state at this point.
    try {
      localStorage.removeItem('open-invoice:autosave');
      localStorage.removeItem('open-invoice:current-project');
    } catch {
      // localStorage may be unavailable (private mode / quota) — ignore.
    }
    // reset() re-renders the error boundary's children; a full reload is the
    // safest way to guarantee a clean store after clearing cached state.
    if (typeof window !== 'undefined') window.location.reload();
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background px-6">
      <div className="flex flex-col items-center gap-5 max-w-md text-center">
        <div className="flex items-center justify-center h-16 w-16 rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="h-8 w-8" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            Something went wrong
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            An unexpected error occurred while rendering the editor. Your saved
            project files on disk are safe. Try reloading — and if the problem
            persists, reset the in-browser project state.
          </p>
        </div>

        {error.digest && (
          <code className="text-[11px] font-mono text-muted-foreground/70 bg-muted/50 border border-border/60 rounded px-2 py-1">
            {error.digest}
          </code>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <RotateCw className="h-4 w-4" />
            Try again
          </button>
          <button
            onClick={handleResetProject}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-border bg-card text-foreground text-sm font-medium hover:bg-accent transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            Reset project state
          </button>
        </div>
      </div>
    </div>
  );
}
