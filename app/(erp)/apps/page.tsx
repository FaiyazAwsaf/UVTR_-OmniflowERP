"use client"

import Link from "next/link"
import { Lock } from "lucide-react"

import { AppChip } from "@/components/shared/app-frame"
import { useNavCounts } from "@/components/shell/nav-counts"
import { APP_NAV } from "@/core/security/registry"
import { SUITES, type AppCode, type NavItem, type SuiteCode } from "@/core/security/types"
import { usePermissions } from "@/core/security/useCan"
import { useSyncFlash } from "@/components/shell/use-sync-flash"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/** Icon well colour per suite (ui_guidelines.md §4: FMS turquoise, SDM lavender, SCM deep blue, CSC yellow). */
const SUITE_WELL: Record<SuiteCode, string> = {
  fms: "text-[var(--chart-1)]",
  sdm: "text-[var(--chart-2)]",
  scm: "text-[var(--chart-3)]",
  csc: "text-[var(--chart-4)]",
}

/**
 * "/apps": the SME package, 4 suites by their apps (plan §9, ui_guidelines
 * §4 "App tile"): code, name, icon, a one-line description and a live count
 * of what waits there for this user. Locked tiles (no view permission) are
 * muted with a lock; an RBAC change in any window locks or unlocks a tile at
 * once.
 */
export default function AppsPage() {
  const { t, tk, num } = useLocale()
  const { can } = usePermissions()
  const counts = useNavCounts()
  const open = APP_NAV.filter((nav) => can(nav.permission)).length

  return (
    <div className="flex flex-col gap-6" data-testid="apps-grid">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.375rem] font-semibold">{t("shell.apps.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("shell.apps.subtitle")}</p>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="apps-open-count">
          {t("shell.apps.openCount", { open: num(open), total: num(APP_NAV.length) })}
        </p>
      </div>
      {SUITES.map((suite) => (
        <section key={suite.code} className="flex flex-col gap-3" data-testid={`suite-${suite.code}`}>
          <h2 className="flex items-baseline gap-2">
            <span translate="no" className="font-mono text-sm font-semibold">
              {tk(`suites.${suite.code}.code`)}
            </span>
            <span className="text-sm text-muted-foreground">{tk(`suites.${suite.code}.name`)}</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {suite.apps.map((code) => {
              const nav = APP_NAV.find((n) => n.app === code)
              if (!nav) return null
              return (
                <AppTile
                  key={code}
                  code={code}
                  nav={nav}
                  suite={suite.code}
                  allowed={can(nav.permission)}
                  waiting={counts ? (counts[nav.href] ?? 0) : undefined}
                />
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function AppTile({
  code,
  nav,
  suite,
  allowed,
  waiting,
}: {
  code: AppCode
  nav: NavItem
  suite: SuiteCode
  allowed: boolean
  waiting: number | undefined
}) {
  const { t, tk, num } = useLocale()
  const flash = useSyncFlash(waiting === undefined ? undefined : `${allowed}:${waiting}`)
  const Icon = nav.icon
  const body = (
    <>
      <span className={cn("icon-well flex size-11 shrink-0 items-center justify-center", SUITE_WELL[suite])}>
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <AppChip app={code} />
          <span className="truncate text-[0.9375rem] font-semibold">{tk(nav.labelKey)}</span>
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{tk(nav.descriptionKey ?? "")}</span>
        {!allowed ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" />
            {t("shell.apps.locked")}
          </span>
        ) : waiting ? (
          <span className="mt-0.5 flex items-center gap-1.5 text-xs font-medium" data-testid={`app-waiting-${code}`}>
            <span className="count-badge size-2 shrink-0" aria-hidden />
            {t("shell.apps.waiting", { count: num(waiting) })}
          </span>
        ) : null}
      </span>
    </>
  )
  return allowed ? (
    <Link
      href={nav.href}
      data-testid={`app-tile-${code}`}
      data-waiting={waiting ?? 0}
      className={cn(
        "surface-card flex items-start gap-3 p-4 transition-colors outline-none hover:bg-surface-raised focus-visible:ring-[3px] focus-visible:ring-ring/40",
        flash
      )}
    >
      {body}
    </Link>
  ) : (
    <div
      data-testid={`app-tile-${code}`}
      data-locked="true"
      aria-disabled
      className={cn("surface-card flex items-start gap-3 p-4 opacity-55", flash)}
    >
      {body}
    </div>
  )
}
