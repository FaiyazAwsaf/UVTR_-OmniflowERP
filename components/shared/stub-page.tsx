"use client"

import { usePathname } from "next/navigation"
import { Construction } from "lucide-react"

import type { AppCode } from "@/core/security/types"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Placeholder for a route whose screen is not built yet. Every route in plan
 * §9 exists from Phase 0 so workstreams only replace their own page files.
 */
export function StubPage({ app, titleKey }: { app?: AppCode; titleKey: string }) {
  const { t, tk } = useLocale()
  const pathname = usePathname()
  return (
    <div
      data-testid="stub-page"
      className="flex min-h-[50svh] flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <span className="icon-well flex size-12 items-center justify-center text-primary">
        <Construction className="size-5" />
      </span>
      <p className="text-lg font-semibold">{tk(titleKey)}</p>
      <p lang="en" className="font-mono text-xs text-muted-foreground">
        {app ? `${app.toUpperCase()} · ` : ""}
        {pathname}
      </p>
      <p className="max-w-[42ch] text-sm text-muted-foreground">{t("shell.stub.body")}</p>
    </div>
  )
}
