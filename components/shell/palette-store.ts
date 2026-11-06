"use client"

import { create } from "zustand"

import { useUi } from "@/lib/store"

/**
 * The palette's search text for this window. The top-bar search field hands
 * what was typed to the palette, so typing there continues in the palette.
 */
type PaletteState = {
  query: string
  setQuery: (query: string) => void
}

export const usePalette = create<PaletteState>()((set) => ({
  query: "",
  setQuery: (query) => set({ query }),
}))

/** Open the command palette, optionally with a search already typed. */
export function openPalette(query = ""): void {
  usePalette.getState().setQuery(query)
  useUi.getState().setCommandOpen(true)
}
