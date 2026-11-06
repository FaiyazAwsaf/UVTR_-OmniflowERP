import { APP_CODES, type AppCode } from "./types"

/**
 * Route guard map (plan §3.8): route prefixes to the key needed to open them,
 * most specific first. "authenticated" means any signed-in user. Routes not
 * listed are public (the launcher, /login, /wall).
 */
export const ROUTE_PERMISSIONS: { prefix: string; permission: string }[] = [
  { prefix: "/sac/audit", permission: "sac.audit.view" },
  ...APP_CODES.map((app) => ({ prefix: `/${app}`, permission: `${app}.app.view` })),
  { prefix: "/dashboard", permission: "dashboard.app.view" },
  { prefix: "/home", permission: "authenticated" },
  { prefix: "/apps", permission: "authenticated" },
  { prefix: "/approvals", permission: "authenticated" },
]

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/** The key a route needs, or null when it is public. */
export function permissionForRoute(pathname: string): string | null {
  return ROUTE_PERMISSIONS.find((r) => matches(pathname, r.prefix))?.permission ?? null
}

/** The app that owns a route, if any. */
export function appForRoute(pathname: string): AppCode | null {
  const first = pathname.split("/")[1] ?? ""
  return (APP_CODES as readonly string[]).includes(first) ? (first as AppCode) : null
}

/** Whether a set of granted keys may open a route. */
export function routeAllowed(pathname: string, has: (key: string) => boolean): boolean {
  const permission = permissionForRoute(pathname)
  if (!permission || permission === "authenticated") return true
  return has(permission)
}
