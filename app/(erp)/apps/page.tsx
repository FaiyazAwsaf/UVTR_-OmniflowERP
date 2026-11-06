"use client"

import Link from "next/link"
import { Lock } from "lucide-react"

import { AppChip } from "@/components/shared/app-frame"
import { APP_NAV } from "@/core/security/registry"
import { SUITES } from "@/core/security/types"
import { usePermissions } from "@/core/security/useCan"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

const SUITE_WELL: Record<string, string> = {
  fms: "text-[var(--chart-1)]",
  sdm: "text-[var(--chart-2)]",
  scm: "text-[var(--chart-3)]",
  csc: "text-[var(--chart-4)]",
}

/**
 * "/apps": the SME package, 4 suites by their apps (plan §9, ui_guidelines
 * §4 "App tile"). Locked tiles (no view permission) are muted with a lock.
 */
export default function AppsPage() {
  const { t, tk } = useLocale()
  const { can } = usePermissions()
  return (
    <div className="flex flex-col gap-6" data-testid="apps-grid">
      <div>
        <h1 className="text-[1.375rem] font-semibold">{t("shell.apps.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("shell.apps.subtitle")}</p>
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
              const allowed = can(nav.permission)
              const Icon = nav.icon
              const body = (
                <>
                  <span
                    className={cn(
                      "icon-well flex size-11 shrink-0 items-center justify-center",
                      SUITE_WELL[suite.code]
                    )}
                  >
                    <Icon className="size-5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <AppChip app={code} />
                      <span className="truncate text-[0.9375rem] font-semibold">{tk(nav.labelKey)}</span>
                    </span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {tk(nav.descriptionKey ?? "")}
                    </span>
                    {!allowed ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Lock className="size-3" />
                        {t("shell.apps.locked")}
                      </span>
                    ) : null}
                  </span>
                </>
              )
              return allowed ? (
                <Link
                  key={code}
                  href={nav.href}
                  data-testid={`app-tile-${code}`}
                  className="surface-card flex items-start gap-3 p-4 transition-colors outline-none hover:bg-surface-raised focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  {body}
                </Link>
              ) : (
                <div
                  key={code}
                  data-testid={`app-tile-${code}`}
                  data-locked="true"
                  aria-disabled
                  className="surface-card flex items-start gap-3 p-4 opacity-55"
                >
                  {body}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
