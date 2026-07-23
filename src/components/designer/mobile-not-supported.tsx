'use client';

import { Monitor } from 'lucide-react';

/**
 * Shown when the app is opened on a screen narrower than 768px (phones / small
 * tablets). Open Invoice is a precision design tool — drag handles, alignment
 * guides, keyboard shortcuts, and the three-panel layout need a real desktop.
 * Rather than ship a broken, cramped editor, we show a friendly, honest message.
 */
export function MobileNotSupported() {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-background px-6 text-center">
      <div className="flex flex-col items-center gap-5 max-w-sm">
        <div className="flex items-center justify-center h-16 w-16 rounded-2xl bg-primary/10 text-primary">
          <Monitor className="h-8 w-8" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            Desktop required
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Open Invoice is a precision design tool optimized for larger screens.
            Please open this on a desktop or laptop (1024px or wider) for the full
            editing experience.
          </p>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/60">
          <img src="/Logo.png" alt="Open Invoice" className="w-5 h-5 rounded object-contain" />
          <span className="text-xs font-medium text-foreground">
            Open Invoice<sup className="text-[0.5em] font-semibold tracking-wider">MJC</sup>
          </span>
        </div>
      </div>
    </div>
  );
}
