"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ExternalLink, KeyRound, LayoutGrid, Lock, MonitorPlay, PanelsTopLeft } from "lucide-react"
import { toast } from "sonner"

import { GeneratedAvatar } from "@/components/shared/avatars"
import { TenantMark } from "@/components/shared/tenant-mark"
import { Wordmark } from "@/components/shell/app-sidebar"
import { LanguageToggle, ThemeToggle } from "@/components/shell/toggles"
import { Button } from "@/components/ui/button"
import { tenant } from "@/config/brand.config"
import { ROLE_DESIGNATION, ROLE_ORDER, SEED_USERS, findSeedUser, type SeedUser } from "@/core/security/seed-users"
import { usePermissions } from "@/core/security/useCan"
import { useUsers } from "@/core/security/users"
import { updateSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { ROLE_ICONS } from "../role-icons"
import { SeedStatus } from "../seed-status"
import { DEMO_LAYOUT, openDemoLayout, openWindow, userUrl, windowNameFor } from "./windows"

/**
 * The launcher ("/", plan §9): demo users by role (one click signs THIS
 * window in), the 4-window demo layout, the Demo Wall, seed status and
 * reset. Lock state is live from the users table, so a lockout or an unlock
 * in another window shows here at once.
 */
export function Launcher() {
  const { t, locale } = useLocale()
  const router = useRouter()
  const { user } = usePermissions()
  const liveUsers = useUsers()
  const status = React.useMemo(
    () => new Map((liveUsers ?? []).map((u) => [u.username, u.status])),
    [liveUsers]
  )

  const signInHere = (u: SeedUser) => updateSession({ pendingQuickSignIn: u.username, pendingRoute: null })
  const openLayout = () => {
    const { blocked } = openDemoLayout()
    if (blocked) toast.warning(t("demo.launcher.popupBlocked"))
  }

  return (
    <div className="min-h-svh bg-background" data-testid="launcher">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-6 pb-4 sm:px-6">
        <Wordmark className="text-[1.5rem]" />
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <TenantMark size={26} />
          <span className="font-medium text-foreground">{tenant.shortName[locale]}</span>
          <span className="hidden sm:inline">· {t("demo.launcher.tenantLine")}</span>
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-10 sm:px-6">
        <section className="surface-card grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_22rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <div>
              <h1 className="text-[1.375rem] font-semibold">{t("shell.launcherTitle")}</h1>
              <p className="text-sm text-muted-foreground">{t("shell.launcherSubtitle")}</p>
            </div>
            <p className="text-sm" data-testid="launcher-current">
              {user ? (
                <>
                  {t("demo.launcher.signedInAs", { name: locale === "bn" ? user.nameBn : user.nameEn })}
                  {" · "}
                  <Link
                    href={findSeedUser(user.username)?.landing ?? "/home"}
                    className="font-medium text-link hover:underline"
                  >
                    {t("demo.launcher.continue")}
                  </Link>
                </>
              ) : (
                <span className="text-muted-foreground">{t("demo.launcher.notSignedIn")}</span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={openLayout} data-testid="open-layout">
                <PanelsTopLeft />
                {t("demo.launcher.openLayout")}
              </Button>
              <Button variant="outline" onClick={() => router.push("/wall")} data-testid="open-wall">
                <MonitorPlay />
                {t("demo.launcher.openWall")}
              </Button>
              <Button variant="ghost" onClick={() => router.push("/apps")} data-testid="open-apps">
                <LayoutGrid />
                {t("demo.launcher.openApps")}
              </Button>
              <Button variant="ghost" nativeButton={false} render={<Link href="/login" />} data-testid="open-login">
                <KeyRound />
                {t("demo.launcher.signInWithPassword")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("demo.launcher.openLayoutHint")}</p>
          </div>

          <div className="flex flex-col gap-2" aria-label={t("demo.launcher.layoutTitle")}>
            <p className="text-xs font-medium text-muted-foreground">{t("demo.launcher.layoutTitle")}</p>
            <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-background/60 p-1.5">
              {DEMO_LAYOUT.map((username, index) => {
                const u = findSeedUser(username)
                if (!u) return null
                return (
                  <div key={username} className="flex items-center gap-2 rounded-md bg-surface-raised/70 px-2 py-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[0.625rem] font-semibold">
                      {index + 1}
                    </span>
                    <GeneratedAvatar seed={u.username} sex={u.sex} role={u.role} size={26} />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{locale === "bn" ? u.nameBn : u.nameEn}</span>
                      <span className="block truncate text-[0.6875rem] text-muted-foreground">
                        {ROLE_DESIGNATION[u.role][locale]}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
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
                    {users.map((u) => {
                      const locked = (status.get(u.username) ?? (u.lockedAtSeed ? "locked" : "active")) !== "active"
                      const note = locale === "bn" ? u.noteBn : u.noteEn
                      const showNote = note && !(u.lockedAtSeed && !locked)
                      const current = user?.username === u.username
                      return (
                        <li key={u.username} className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => signInHere(u)}
                            data-testid={`launch-${u.username}`}
                            data-locked={locked}
                            className={cn(
                              "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors outline-none hover:bg-primary-soft focus-visible:ring-[3px] focus-visible:ring-ring/40",
                              current && "bg-primary-soft",
                              locked && "opacity-75"
                            )}
                            title={locked ? t("demo.launcher.lockedHint") : t("demo.launcher.openHere")}
                          >
                            <span className="relative shrink-0">
                              <GeneratedAvatar
                                seed={u.username}
                                sex={u.sex}
                                role={u.role}
                                size={30}
                                className={cn(locked && "grayscale")}
                              />
                              {locked ? (
                                <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-destructive text-white ring-2 ring-card">
                                  <Lock className="size-2.5" />
                                </span>
                              ) : null}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-sm font-medium">
                                  {locale === "bn" ? u.nameBn : u.nameEn}
                                </span>
                                {locked ? (
                                  <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--destructive)_15%,transparent)] px-1.5 py-px text-[0.625rem] font-semibold text-destructive">
                                    {t("demo.launcher.locked")}
                                  </span>
                                ) : null}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                <span lang="en" className="font-mono">
                                  {u.username} · {u.locations === "all" ? u.home : u.locations.join("/")}
                                </span>
                                {showNote ? ` · ${note}` : ""}
                              </span>
                            </span>
                          </button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("demo.launcher.openNewWindow")}
                            title={t("demo.launcher.openNewWindow")}
                            onClick={() => openWindow(userUrl(u.username), windowNameFor(u.username))}
                            data-testid={`launch-window-${u.username}`}
                          >
                            <ExternalLink />
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>

        <section className="surface-card p-4 sm:p-5">
          <SeedStatus />
        </section>
      </main>
    </div>
  )
}
