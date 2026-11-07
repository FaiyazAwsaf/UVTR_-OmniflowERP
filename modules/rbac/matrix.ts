import { PERMISSIONS, PERMISSION_BY_KEY } from "@/core/security/registry"
import { APP_CODES, PERMISSION_COLUMNS, type PermissionColumn, type Scope } from "@/core/security/types"

/**
 * The RBAC permission matrix model (implementation_plan.md §3.9,
 * ui_guidelines.md §4 "Permission matrix"): apps as rows, the eight columns,
 * each cell the app's keys in that column. Pure, so the matrix screen, the
 * commands and the tests share it.
 */

/** The app prefix of a key ("si.invoice.issue" → "si"). */
export function appOfKey(key: string): string {
  return key.split(".")[0] ?? key
}

/** Matrix rows: the 18 apps in suite order, then the executive dashboard. */
export const MATRIX_APPS: string[] = [
  ...APP_CODES,
  ...[...new Set(PERMISSIONS.map((p) => appOfKey(p.key)))].filter(
    (app) => !(APP_CODES as readonly string[]).includes(app)
  ),
]

const CELL_KEYS = new Map<string, string[]>()
for (const p of PERMISSIONS) {
  const id = `${appOfKey(p.key)}:${p.column}`
  const list = CELL_KEYS.get(id) ?? []
  list.push(p.key)
  CELL_KEYS.set(id, list)
}

/** The catalogue keys of an app in one column (empty: the cell has no key). */
export function keysFor(app: string, column: PermissionColumn): string[] {
  return CELL_KEYS.get(`${app}:${column}`) ?? []
}

/** Every key of an app, in catalogue order. */
export function keysOfApp(app: string): string[] {
  return PERMISSION_COLUMNS.flatMap((column) => keysFor(app, column))
}

/** The column of a key, from the catalogue. */
export function columnOf(key: string): PermissionColumn | undefined {
  return PERMISSION_BY_KEY.get(key)?.column
}

export type CellState = "checked" | "unchecked" | "indeterminate" | "none"

/**
 * A cell's state: checked when all its keys are granted, unchecked when none,
 * indeterminate when only some; "none" when the app has no key in the column.
 */
export function cellState(keys: readonly string[], granted: (key: string) => boolean): CellState {
  if (!keys.length) return "none"
  const count = keys.filter(granted).length
  if (count === 0) return "unchecked"
  if (count === keys.length) return "checked"
  return "indeterminate"
}

/** A row's scope: the scope its granted keys share, "mixed", or null when nothing is granted. */
export function rowScope(
  app: string,
  scopeOf: (key: string) => Scope | null | undefined
): Scope | "mixed" | null {
  const scopes = new Set<Scope>()
  for (const key of keysOfApp(app)) {
    const scope = scopeOf(key)
    if (scope) scopes.add(scope)
  }
  if (!scopes.size) return null
  if (scopes.size > 1) return "mixed"
  return [...scopes][0]
}

/** Desired state per key: a scope when granted, null when revoked. */
export type GrantState = Map<string, Scope | null>

/**
 * The changes that turn `current` into `desired` (only keys whose grant or
 * scope differ), in catalogue order.
 */
export function diffGrants(
  current: ReadonlyMap<string, Scope>,
  desired: ReadonlyMap<string, Scope | null>
): { permission: string; scope: Scope | null }[] {
  const out: { permission: string; scope: Scope | null }[] = []
  for (const p of PERMISSIONS) {
    if (!desired.has(p.key)) continue
    const want = desired.get(p.key) ?? null
    const have = current.get(p.key) ?? null
    if (want !== have) out.push({ permission: p.key, scope: want })
  }
  return out
}
