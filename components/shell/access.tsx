"use client"

import * as React from "react"
import Link from "next/link"
import { ShieldX, UserRound } from "lucide-react"

import { Wordmark } from "@/components/shell/app-sidebar"
import { Button } from "@/components/ui/button"
import { ROLE_LANDING } from "@/core/security/seed-users"
import { appForRoute } from "@/core/security/routes"
import { usePermissions } from "@/core/security/useCan"
import type { RoleCode } from "@/core/security/types"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/** The landing route for the user's first role (plan §8). */
export function useHomeRoute(): string {
  const { security } = usePermissions()
  const code = security?.roleCodes[0] as RoleCode | undefined
  return (code && ROLE_LANDING[code]) || "/home"
}

/** No one is signed in to this window: sign in, or pick a demo user. */
export function SignInRequired({ pathname }: { pathname: string }) {
  const { t } = useLocale()
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-4 py-10">
      <Wordmark className="text-[1.75rem]" />
      <div className="surface-card flex w-full max-w-md flex-col items-center gap-5 p-6 text-center sm:p-8">
        <span className="icon-well flex size-12 items-center justify-center text-link">
          <UserRound className="size-6" />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-[1.375rem] font-semibold">{t("shell.guard.signInTitle")}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("shell.guard.signInBody")}</p>
          <p lang="en" className="font-mono text-xs text-muted-foreground">
            {pathname}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button nativeButton={false} render={<Link href={`/login?next=${encodeURIComponent(pathname)}`} />}>
            {t("shell.guard.signIn")}
          </Button>
          <Button nativeButton={false} variant="outline" render={<Link href="/" />}>
            {t("shell.userMenu.openLauncher")}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * The signed-in user lacks the route's key (plan §3.8): "You don't have
 * access to AR Accounts Receivable. An administrator can grant it in RBAC."
 */
export function AccessDenied({ pathname, className }: { pathname: string; className?: string }) {
  const { t, tk } = useLocale()
  const home = useHomeRoute()
  const app = appForRoute(pathname)
  const body = app
    ? t("shell.guard.deniedBody", { app: `${app.toUpperCase()} ${tk(`${app}.name`)}` })
    : t("shell.guard.deniedScreen")
  return (
    <div
      data-slot="access-denied"
      data-testid="access-denied"
      className={cn("flex flex-1 flex-col items-center justify-center py-10", className)}
    >
      <div className="surface-card flex w-full max-w-xl flex-col items-center gap-5 p-6 text-center sm:p-8">
        <span className="flex size-12 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--warning)_18%,transparent)] text-warning">
          <ShieldX className="size-6" />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-[1.375rem] font-semibold">{t("shell.guard.deniedTitle")}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
          <p lang="en" className="font-mono text-xs text-muted-foreground">
            {pathname}
          </p>
        </div>
        <Button nativeButton={false} render={<Link href={home} />}>
          {t("shell.guard.goHome")}
        </Button>
      </div>
    </div>
  )
}
