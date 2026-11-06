import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A screen's header (ui_guidelines.md §3): title and muted subtitle on the
 * left, the primary action (and outline or ghost secondary actions) on the
 * right. The app's code chip and tabs sit above it in the app layout.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="truncate text-[1.375rem] leading-tight font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
