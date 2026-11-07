"use client"

import * as React from "react"
import { ChevronDown, Save, TriangleAlert, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { AppChip } from "@/components/shared/app-frame"
import { StatusText } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { RoleRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { PERMISSION_COLUMNS, type PermissionColumn, type Scope } from "@/core/security/types"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { Mono } from "@/modules/sac/components/kit"

import { setPermission } from "../commands"
import { useRbacFormat } from "../format"
import { MATRIX_APPS, cellState, diffGrants, keysFor, keysOfApp, rowScope, type CellState } from "../matrix"
import type { RbacData } from "../queries"
import { sodHits } from "../sod"

/**
 * The permission matrix (plan §9 /rbac/roles/[id], ui_guidelines.md §4): apps
 * as rows, the eight columns, each cell a checkbox over that app's keys in the
 * column: ticked when all are granted, empty when none, a dash when only
 * some, with a popover to grant them one by one. A scope toggle per row;
 * changed cells tinted until saved; SoD conflicts flagged. Saving runs
 * `rbac.setPermission` once for every change, and every window's permissions
 * follow at once.
 */
export function PermissionMatrix({
  role,
  data,
  editable,
}: {
  role: RoleRow
  data: RbacData
  editable: boolean
}) {
  const { t, tk, num, locale } = useLocale()
  const { keyLabel, appName } = useRbacFormat()
  const command = useCommand(setPermission)
  const current = React.useMemo(() => data.grantsByRole.get(role.id) ?? new Map<string, Scope>(), [data, role.id])
  const [pending, setPending] = React.useState<Map<string, Scope | null>>(() => new Map())
  const [rowChoice, setRowChoice] = React.useState<Map<string, Scope>>(() => new Map())
  const [reason, setReason] = React.useState("")

  // Drop pending entries that now equal the live state (saved here or in another window).
  const effective = React.useMemo(() => {
    const out = new Map<string, Scope | null>()
    for (const [key, want] of pending) if ((current.get(key) ?? null) !== want) out.set(key, want)
    return out
  }, [pending, current])

  const desired = (key: string): Scope | null => (effective.has(key) ? (effective.get(key) ?? null) : (current.get(key) ?? null))

  const defaultScope: Scope = React.useMemo(() => {
    let own = 0
    for (const scope of current.values()) if (scope === "own-location") own += 1
    return own > current.size / 2 ? "own-location" : "all"
  }, [current])

  const scopeForRow = (app: string): Scope => {
    const chosen = rowChoice.get(app)
    if (chosen) return chosen
    const now = rowScope(app, desired)
    return now === "all" || now === "own-location" ? now : defaultScope
  }

  const apply = (changes: [string, Scope | null][]) =>
    setPending((prev) => {
      const next = new Map(prev)
      for (const [key, want] of changes) {
        if ((current.get(key) ?? null) === want) next.delete(key)
        else next.set(key, want)
      }
      return next
    })

  const toggleCell = (app: string, column: PermissionColumn, state: CellState) => {
    const keys = keysFor(app, column)
    if (state === "checked") apply(keys.map((k) => [k, null]))
    else apply(keys.filter((k) => desired(k) === null).map((k) => [k, scopeForRow(app)]))
  }

  const toggleKey = (app: string, key: string) => apply([[key, desired(key) === null ? scopeForRow(app) : null]])

  const setRowScope = (app: string, scope: Scope) => {
    setRowChoice((prev) => new Map(prev).set(app, scope))
    apply(keysOfApp(app).filter((k) => desired(k) !== null).map((k) => [k, scope]))
  }

  // Segregation of duties for the role on its own: now and with the changes.
  const rules = data.rules
  const beforeHits = React.useMemo(() => sodHits(current.keys(), rules), [current, rules])
  const afterKeys = React.useMemo(() => {
    const keys = new Set(current.keys())
    for (const [key, want] of effective) {
      if (want === null) keys.delete(key)
      else keys.add(key)
    }
    return keys
  }, [current, effective])
  const afterHits = React.useMemo(() => sodHits(afterKeys, rules), [afterKeys, rules])
  const hadCode = new Set(beforeHits.map((h) => h.rule.code))
  const flaggedKeys = new Set(afterHits.flatMap((h) => [...h.a, ...h.b]))

  const save = async () => {
    const changes = diffGrants(current, effective)
    if (!changes.length) return
    const result = await command.run({ roleId: role.id, changes, reason: reason.trim() || undefined })
    if (!result) return
    setPending(new Map())
    setReason("")
    toast.success(t("rbac.matrix.saved", { count: num(changes.length) }))
    if (result.flagged.length) toast.warning(t("rbac.matrix.flagged", { rules: result.flagged.join(", ") }))
  }

  const count = effective.size

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="matrix" data-role={role.code}>
      {afterHits.length ? (
        <div className="flex flex-col gap-1.5 rounded-md bg-warning/12 px-4 py-3 text-[0.8125rem]" data-testid="matrix-sod">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4 text-warning" />
            {t("rbac.matrix.conflictsNow")}
          </p>
          <ul className="flex flex-col gap-1 pl-6">
            {afterHits.map((hit) => (
              <li key={hit.rule.code} className="flex flex-wrap items-center gap-x-2" data-testid="matrix-sod-rule" data-code={hit.rule.code}>
                <Mono className="font-semibold">{hit.rule.code}</Mono>
                <span>{locale === "bn" ? hit.rule.descriptionBn : hit.rule.descriptionEn}</span>
                <StatusText tone={hit.rule.mode === "block" ? "destructive" : "warning"}>
                  {hit.rule.mode === "block" && !hadCode.has(hit.rule.code)
                    ? t("rbac.matrix.conflictBlock")
                    : !hadCode.has(hit.rule.code)
                      ? t("rbac.matrix.conflictNew")
                      : t("rbac.matrix.conflictWarn")}
                </StatusText>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="@container/matrix min-w-0 overflow-x-auto">
        <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-[0.8125rem]">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="h-10 rounded-l-md bg-surface-raised px-3 text-left font-medium">{t("rbac.matrix.app")}</th>
              {PERMISSION_COLUMNS.map((column) => (
                <th key={column} className="h-10 bg-surface-raised px-1 text-center font-medium whitespace-nowrap">
                  {tk(`rbac.columns.${column}`)}
                </th>
              ))}
              <th className="h-10 rounded-r-md bg-surface-raised px-3 text-center font-medium" title={t("rbac.matrix.scopeHint")}>
                {t("rbac.matrix.scope")}
              </th>
            </tr>
          </thead>
          <tbody>
            {MATRIX_APPS.map((app) => {
              const scope = rowScope(app, desired)
              const rowPending = keysOfApp(app).some((k) => effective.has(k))
              return (
                <tr key={app} data-testid="matrix-row" data-app={app} className="hover:bg-primary-soft/40">
                  <td className="h-11 border-b border-hairline px-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <AppChip app={app} active={rowPending} />
                      <span className="hidden truncate text-muted-foreground @min-[56rem]/matrix:inline">{appName(app)}</span>
                    </span>
                  </td>
                  {PERMISSION_COLUMNS.map((column) => (
                    <MatrixCell
                      key={column}
                      app={app}
                      column={column}
                      keys={keysFor(app, column)}
                      desired={desired}
                      pending={keysFor(app, column).some((k) => effective.has(k))}
                      flagged={keysFor(app, column).some((k) => flaggedKeys.has(k))}
                      editable={editable}
                      onToggle={(state) => toggleCell(app, column, state)}
                      onToggleKey={(key) => toggleKey(app, key)}
                      keyLabel={keyLabel}
                      label={`${appName(app)}: ${tk(`rbac.columns.${column}`)}`}
                    />
                  ))}
                  <td className="h-11 border-b border-hairline px-2 text-center">
                    <ScopeToggle
                      app={app}
                      scope={scope}
                      choice={scopeForRow(app)}
                      disabled={!editable}
                      onChange={(next) => setRowScope(app, next)}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editable ? (
        <div
          className={cn(
            "sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-md bg-popover/95 p-3 shadow-lg ring-1 ring-foreground/5 backdrop-blur transition-opacity",
            count ? "opacity-100" : "opacity-70"
          )}
        >
          <span className="text-[0.8125rem] font-medium" data-testid="matrix-pending" data-count={count}>
            {t("rbac.matrix.pending", { count: num(count) })}
          </span>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("rbac.matrix.reason")}
            aria-label={t("rbac.matrix.reason")}
            className="h-8 max-w-72 min-w-40 flex-1"
            disabled={!count}
          />
          <div className="ml-auto flex gap-2">
            <Button variant="neutral" size="sm" disabled={!count} onClick={() => setPending(new Map())}>
              <Undo2 />
              {t("rbac.matrix.discard")}
            </Button>
            <Button size="sm" disabled={!count || command.pending} onClick={save} data-testid="matrix-save">
              <Save />
              {command.pending ? t("rbac.matrix.saving") : t("rbac.matrix.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MatrixCell({
  app,
  column,
  keys,
  desired,
  pending,
  flagged,
  editable,
  onToggle,
  onToggleKey,
  keyLabel,
  label,
}: {
  app: string
  column: PermissionColumn
  keys: string[]
  desired: (key: string) => Scope | null
  pending: boolean
  flagged: boolean
  editable: boolean
  onToggle: (state: CellState) => void
  onToggleKey: (key: string) => void
  keyLabel: (key: string) => string
  label: string
}) {
  const { t, tk } = useLocale()
  const state = cellState(keys, (k) => desired(k) !== null)
  return (
    <td
      data-testid="matrix-cell"
      data-app={app}
      data-column={column}
      data-state={state}
      data-pending={pending ? "true" : "false"}
      className={cn("h-11 border-b border-hairline px-1 text-center transition-colors", pending && "bg-primary-soft")}
    >
      {state === "none" ? (
        <span className="text-muted-foreground/40" title={t("rbac.matrix.noKey")}>
          ·
        </span>
      ) : (
        <span className="inline-flex items-center justify-center gap-0.5">
          <Checkbox
            checked={state === "checked"}
            indeterminate={state === "indeterminate"}
            disabled={!editable}
            onCheckedChange={() => onToggle(state)}
            aria-label={label}
            data-testid="matrix-check"
          />
          {keys.length > 1 ? (
            <Popover>
              <PopoverTrigger
                aria-label={t("rbac.matrix.showKeys")}
                data-testid="matrix-keys"
                className="flex size-5 items-center justify-center rounded text-muted-foreground outline-none hover:bg-surface-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <ChevronDown className="size-3.5" />
              </PopoverTrigger>
              <PopoverContent className="w-80 gap-2" data-testid="matrix-popover">
                <p className="text-[0.8125rem] font-semibold">{label}</p>
                <ul className="flex flex-col gap-1">
                  {keys.map((key) => {
                    const scope = desired(key)
                    return (
                      <li key={key}>
                        <label className="flex items-start gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-surface-raised">
                          <Checkbox
                            checked={scope !== null}
                            disabled={!editable}
                            onCheckedChange={() => onToggleKey(key)}
                            data-testid="matrix-key"
                            data-key={key}
                            data-state={scope !== null ? "checked" : "unchecked"}
                            className="mt-0.5"
                          />
                          <span className="min-w-0 flex-1 text-left">
                            <span className="block">{keyLabel(key)}</span>
                            <Mono className="block text-muted-foreground">{key}</Mono>
                          </span>
                          {scope ? (
                            <span className="text-[0.6875rem] whitespace-nowrap text-muted-foreground">
                              {tk(scope === "all" ? "rbac.scope.allShort" : "rbac.scope.ownShort")}
                            </span>
                          ) : null}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </PopoverContent>
            </Popover>
          ) : null}
          {flagged ? <TriangleAlert className="size-3 text-warning" aria-hidden /> : null}
        </span>
      )}
    </td>
  )
}

function ScopeToggle({
  app,
  scope,
  choice,
  disabled,
  onChange,
}: {
  app: string
  scope: Scope | "mixed" | null
  choice: Scope
  disabled: boolean
  onChange: (scope: Scope) => void
}) {
  const { t } = useLocale()
  const shown = scope === "all" || scope === "own-location" ? scope : choice
  const item = (value: Scope, label: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(value)}
      aria-pressed={shown === value}
      data-testid={value === "all" ? "matrix-scope-all" : "matrix-scope-own"}
      className={cn(
        "h-6 rounded-full px-2 text-[0.6875rem] font-medium transition-colors disabled:cursor-not-allowed",
        shown === value && scope !== null
          ? "bg-primary text-primary-foreground"
          : shown === value
            ? "bg-surface-raised text-foreground"
            : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  )
  return (
    <span
      data-testid="matrix-scope"
      data-app={app}
      data-scope={scope ?? "none"}
      title={scope === "mixed" ? t("rbac.scope.mixed") : t("rbac.matrix.scopeHint")}
      className={cn("inline-flex items-center gap-0.5 rounded-full border border-border p-0.5", scope === "mixed" && "border-warning")}
    >
      {item("own-location", t("rbac.scope.ownShort"))}
      {item("all", t("rbac.scope.allShort"))}
    </span>
  )
}
