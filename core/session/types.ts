import type { Locale } from "@/lib/i18n/config"

export type ThemeChoice = "dark" | "light"

/**
 * Per-window state (plan §3.14). Each window, tab or Demo Wall pane has its
 * own, keyed by `window.name` in sessionStorage.
 */
export type WindowSession = {
  /** The signed-in user; null until sign-in */
  userId: string | null
  /** The `sessions` row of this window's sign-in */
  sessionId: string | null
  /** Current location (users with several pick it in the top bar) */
  locationId: string | null
  /**
   * `?user=<username>` asks for a quick demo sign-in; the session gate
   * performs it (a demo-quick `sac.signIn`) and clears this.
   */
  pendingQuickSignIn: string | null
  /** Route to open after a pending quick sign-in */
  pendingRoute: string | null
  /** Why this window was signed out (shown on /login) */
  signedOutReason: "forced" | "timeout" | "sign-out" | null
  lang: Locale
  theme: ThemeChoice
  /** Root UI scale (0.9 to 1.4); Demo Wall panes default to 0.9 */
  uiScale: number
  /** Active scenario cue card in this window, with display values from its setup */
  cue: {
    scenarioId: string
    step: number
    params?: Record<string, string | number>
  } | null
}
