"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { APP_NAV } from "@/core/security/registry"
import type { AppCode } from "@/core/security/types"
import { usePermissions } from "@/core/security/useCan"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/** The app code chip (ui_guidelines.md §4): mono, uppercase, pill. */
export function AppChip({ app, active, className }: { app: string; active?: boolean; className?: string }) {
  return (
    <span
      translate="no"
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-[0.6875rem] leading-none font-semibold uppercase",
        active ? "bg-primary-soft text-primary" : "bg-surface-raised text-foreground/85",
        className
      )}
    >
      {app}
    </span>
  )
}

function matches(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The header strip of an app (plan §9): its code chip and name, and its
 * screens as tabs (filtered live by permission). Every `app/(erp)/<app>`
 * layout renders it above the app's pages.
 */
export function AppFrame({ app, children }: { app: AppCode; children: React.ReactNode }) {
  const { tk } = useLocale()
  const pathname = usePathname()
  const { can } = usePermissions()
  const nav = APP_NAV.find((item) => item.app === app)
  const sections = (nav?.sections ?? []).filter((s) => can(s.permission ?? `${app}.app.view`))
  let active: string | null = null
  for (const s of sections) {
    if (matches(pathname, s.href) && (!active || s.href.length > active.length)) active = s.href
  }
  const Icon = nav?.icon

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-app={app}>
      <div className="flex min-w-0 flex-col gap-2 border-b border-hairline pb-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? <Icon className="size-4 shrink-0 text-primary" /> : null}
          <AppChip app={app} active />
          <span className="truncate text-sm font-semibold">{tk(`${app}.name`)}</span>
        </div>
        {sections.length > 1 ? (
          <nav aria-label={tk(`${app}.name`)} className="-mx-1 flex gap-1 overflow-x-auto pb-0.5">
            {sections.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                aria-current={s.href === active ? "page" : undefined}
                data-testid={`tab-${s.href.slice(1).replace(/\//g, "-")}`}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-[0.8125rem] whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  s.href === active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
                )}
              >
                {tk(s.labelKey)}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
      {children}
    </div>
  )
}
