"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ExternalLink, LayoutGrid, Lock, MonitorPlay, PanelsTopLeft } from "lucide-react"
import { toast } from "sonner"

import { GeneratedAvatar } from "@/components/shared/avatars"
import { TenantMark } from "@/components/shared/tenant-mark"
import { Wordmark } from "@/components/shell/demo/wordmark"
import { LanguageToggle, ThemeToggle } from "@/components/shell/toggles"
import { Button } from "@/components/ui/button"
import { tenant } from "@/config/brand.config"
import { ROLE_DESIGNATION, ROLE_ORDER, SEED_USERS, type SeedUser } from "@/core/security/seed-users"
import { usePermissions } from "@/core/security/useCan"
import { updateSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { ROLE_ICONS } from "../role-icons"
import { ResetDemoButton, SeedStatus } from "../seed-status"
import { openDemoLayout, openWindow, userUrl, windowNameFor } from "./windows"

/**
 * The launcher ("/", plan §9): demo users by role (one click signs THIS
 * window in), the 4-window demo layout, the Demo Wall, reset and seed status.
 */
export function Launcher() {
  const { t, locale } = useLocale()
  const router = useRouter()
  const { user } = usePermissions()

  const signInHere = (u: SeedUser) => updateSession({ pendingQuickSignIn: u.username, pendingRoute: null })
  const openLayout = () => {
    const { blocked } = openDemoLayout()
    if (blocked) toast.warning(t("demo.launcher.popupBlocked"))
  }

  return (
    <div className="min-h-svh bg-background" data-testid="launcher">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 pt-6 pb-4">
        <Wordmark className="text-2xl" />
        <span className="rounded-full border border-primary/60 px-2 py-px font-mono text-xs font-semibold text-primary">
          SME
        </span>
        <span className="ml-2 flex items-center gap-2 text-sm text-muted-foreground">
          <TenantMark size={24} />
          {tenant.shortName[locale]}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-10">
        <section className="surface-card flex flex-col gap-4 p-5">
          <div>
            <h1 className="text-[1.375rem] font-semibold">{t("shell.launcherTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("shell.launcherSubtitle")}</p>
            {user ? (
              <p className="mt-1 text-sm">
                {t("demo.launcher.signedInAs", { name: locale === "bn" ? user.nameBn : user.nameEn })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={openLayout} data-testid="open-layout">
              <PanelsTopLeft />
              {t("demo.launcher.openLayout")}
            </Button>
            <Button variant="outline" onClick={() => router.push("/wall")} data-testid="open-wall">
              <MonitorPlay />
              {t("demo.launcher.openWall")}
            </Button>
            <Button variant="outline" onClick={() => router.push("/apps")} data-testid="open-apps">
              <LayoutGrid />
              {t("demo.launcher.openApps")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("demo.launcher.openLayoutHint")}</p>
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-[1.0625rem] font-semibold">{t("demo.launcher.usersTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("demo.launcher.usersHint")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ROLE_ORDER.map((role) => {
              const users = SEED_USERS.filter((u) => u.role === role)
              const Icon = ROLE_ICONS[role]
              return (
                <div key={role} className="surface-card flex flex-col gap-2 p-4" data-testid={`role-${role}`}>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="icon-well flex size-8 items-center justify-center text-primary">
                      <Icon className="size-4" />
                    </span>
                    {ROLE_DESIGNATION[role][locale]}
                  </div>
                  <ul className="flex flex-col gap-1">
                    {users.map((u) => (
                      <li key={u.username} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => signInHere(u)}
                          data-testid={`launch-${u.username}`}
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors outline-none hover:bg-primary-soft focus-visible:ring-[3px] focus-visible:ring-ring/40",
                            u.lockedAtSeed && "opacity-70"
                          )}
                          title={t("demo.launcher.openHere")}
                        >
                          <GeneratedAvatar seed={u.username} sex={u.sex} role={u.role} size={30} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {locale === "bn" ? u.nameBn : u.nameEn}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              <span lang="en" className="font-mono">
                                {u.username} · {u.home}
                              </span>
                              {(locale === "bn" ? u.noteBn : u.noteEn) ? ` · ${locale === "bn" ? u.noteBn : u.noteEn}` : ""}
                            </span>
                          </span>
                          {u.lockedAtSeed ? <Lock className="size-3.5 text-warning" /> : null}
                        </button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("demo.launcher.openNewWindow")}
                          title={t("demo.launcher.openNewWindow")}
                          onClick={() => openWindow(userUrl(u.username), windowNameFor(u.username))}
                        >
                          <ExternalLink />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>

        <section className="surface-card flex flex-wrap items-center gap-3 p-4">
          <SeedStatus className="flex-1" />
          <ResetDemoButton className="ml-auto" />
        </section>
      </main>
    </div>
  )
}
