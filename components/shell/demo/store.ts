"use client"

import { create } from "zustand"

/**
 * Drawer state for this window, at module level so the open drawer and its
 * tab survive route changes. Not persisted: every window keeps its own.
 */

export type PanelTab = "clock" | "data" | "scenarios"

type DemoUiState = {
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  panelTab: PanelTab
  setPanelTab: (tab: PanelTab) => void

  streamOpen: boolean
  setStreamOpen: (open: boolean) => void
  /** Highest event seq seen in the stream, per database name */
  seen: Record<string, number>
  markSeen: (dbName: string, seq: number) => void
}

export const useDemoUi = create<DemoUiState>()((set) => ({
  panelOpen: false,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  panelTab: "clock",
  setPanelTab: (panelTab) => set({ panelTab }),

  streamOpen: false,
  setStreamOpen: (streamOpen) => set({ streamOpen }),
  seen: {},
  markSeen: (dbName, seq) =>
    set((state) => (state.seen[dbName] === seq ? state : { seen: { ...state.seen, [dbName]: seq } })),
}))
