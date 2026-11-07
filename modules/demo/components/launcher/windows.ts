import { ROLE_LANDING, findSeedUser } from "@/core/security/seed-users"

/**
 * Window helpers for the launcher and Demo Wall. Every window gets a stable
 * `of-` name so its per-window session (user, language) survives reloads and
 * re-opening the same user reuses its window (plan §3.14).
 */

/** Landing route for a user, with the quick sign-in the window applies. */
export function userUrl(username: string, extra?: Record<string, string>, route?: string): string {
  const seed = findSeedUser(username)
  const params = new URLSearchParams({ user: username, ...extra })
  const path = route ?? (seed ? ROLE_LANDING[seed.role] : "/home")
  return `${path}${path.includes("?") ? "&" : "?"}${params.toString()}`
}

/** Message a Demo Wall pane posts to the wall to open a scenario's companion in the next pane. */
export const WALL_COMPANION = "of:wall-companion"
export type WallCompanionMessage = { type: typeof WALL_COMPANION; from: string; user: string; route: string }

/**
 * Opens a scenario's companion window (E13, E15: a second user on the same
 * story). Inside a Demo Wall pane the wall signs the next pane in instead.
 * Returns false when a pop-up blocker stopped a separate window.
 */
export function openCompanion(username: string, route: string): boolean {
  if (window.parent !== window && window.name.startsWith("of-wall-")) {
    const message: WallCompanionMessage = { type: WALL_COMPANION, from: window.name, user: username, route }
    window.parent.postMessage(message, window.location.origin)
    return true
  }
  return openWindow(userUrl(username, {}, route), windowNameFor(username)) !== null
}

export function windowNameFor(username: string): string {
  return `of-win-${username}`
}

/** Opens (or reuses) a named window. Returns null when a pop-up blocker stopped it. */
export function openWindow(url: string, name: string, features?: string): Window | null {
  const win = window.open(url, name, features)
  if (!win || win.closed || typeof win.closed === "undefined") return null
  return win
}

/** Advisor, Technician, Cashier and Accountant: the four-window layout (plan §9). */
export const DEMO_LAYOUT: string[] = ["nayeem", "rakib", "tania", "mahbub"]

/**
 * Opens the four layout windows tiled as 960x600 quadrants of the screen
 * (smaller when the screen is smaller). Browsers allow one pop-up per click
 * unless the site is allowed, so the caller shows a hint when any is blocked.
 */
export function openDemoLayout(): { opened: number; blocked: number } {
  const screen = window.screen as Screen & { availLeft?: number; availTop?: number }
  const width = Math.min(960, Math.floor((screen.availWidth || 1920) / 2))
  const height = Math.min(600, Math.floor((screen.availHeight || 1200) / 2))
  const originLeft = screen.availLeft ?? 0
  const originTop = screen.availTop ?? 0
  let blocked = 0
  DEMO_LAYOUT.forEach((username, i) => {
    const left = originLeft + (i % 2) * width
    const top = originTop + Math.floor(i / 2) * height
    const win = openWindow(
      userUrl(username, { scale: "0.9" }),
      windowNameFor(username),
      `popup=yes,left=${left},top=${top},width=${width},height=${height}`
    )
    if (!win) {
      blocked += 1
      return
    }
    try {
      win.moveTo(left, top)
      win.resizeTo(width, height)
    } catch {
      // Some browsers refuse to move windows; the requested position still applies.
    }
  })
  return { opened: DEMO_LAYOUT.length - blocked, blocked }
}
