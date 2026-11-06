"use client"

import * as React from "react"

/**
 * "flash-sync" for about 1.2 s when a live value changes (ui_guidelines.md
 * §5), like hooks/use-flash-on-change, but `undefined` means "still loading":
 * the first loaded value never flashes, so a badge or tile only flashes when
 * another window's commit moves it, not when the page opens.
 */
export function useSyncFlash(value: unknown, durationMs = 1200): string {
  const previous = React.useRef<unknown>(undefined)
  const [flashKey, setFlashKey] = React.useState(0)

  React.useEffect(() => {
    if (value === undefined) return
    if (previous.current === undefined) {
      previous.current = value
      return
    }
    if (Object.is(previous.current, value)) return
    previous.current = value
    const start = window.setTimeout(() => setFlashKey((key) => key + 1), 0)
    const stop = window.setTimeout(() => setFlashKey(0), durationMs)
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(stop)
    }
  }, [value, durationMs])

  return flashKey > 0 ? "flash-sync" : ""
}
