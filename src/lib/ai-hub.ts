"use client";

import { useSyncExternalStore } from "react";

/** AI actions the currently open page offers to the floating AI button. */
export interface PageAiTools {
  pageId: string;
  canEdit: boolean;
  /** Opens the "tidy whole document" bar. */
  openTidy: () => void;
  /** True when the editor has a non-empty text selection. */
  hasSelection: () => boolean;
  /** Attaches the current selection to the AI bar. Returns false if nothing is selected. */
  attachSelection: () => boolean;
}

let tools: PageAiTools | null = null;
const listeners = new Set<() => void>();

export const aiHub = {
  set(t: PageAiTools | null) {
    tools = t;
    listeners.forEach((l) => l());
  },
  get: () => tools,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};

export function usePageAiTools() {
  return useSyncExternalStore(aiHub.subscribe, aiHub.get, () => null);
}
