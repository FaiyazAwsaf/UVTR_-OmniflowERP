/**
 * A stable identity for this browsing context (window, tab or Demo Wall
 * iframe). `window.name` survives reloads and navigation and is never shared
 * between iframes, so it keys per-window session state (plan §3.14).
 * window.open(url, "of-...") and <iframe name="of-..."> set it explicitly.
 */
export function windowKey(): string {
  if (typeof window === "undefined") return "server"
  if (!window.name || !window.name.startsWith("of-")) {
    const random = Math.random().toString(36).slice(2, 10)
    window.name = `of-${random}`
  }
  return window.name
}
