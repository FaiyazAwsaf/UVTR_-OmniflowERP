"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { LoaderCircle } from "lucide-react"

import { AccessDenied, SignInRequired } from "@/components/shell/access"
import { AppSidebar } from "@/components/shell/app-sidebar"
import { PasswordChangeGate } from "@/components/shell/change-password-dialog"
import {
  CommandPalette,
  useShellHotkeys,
} from "@/components/shell/command-palette"
import { CrossWindowToasts } from "@/components/shell/cross-window-toasts"
import { CueCard } from "@/components/shell/demo/cue-card"
import { TopBar } from "@/components/shell/top-bar"
import { routeAllowed } from "@/core/security/routes"
import { findSeedUser } from "@/core/security/seed-users"
import { usePermissions } from "@/core/security/useCan"
import { useSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"

/**
 * The ERP app frame (ui_guidelines.md §3): sidebar, top bar and the scrolling
 * content area, plus the command palette, the cross-window toasts and the
 * scenario cue card. Guards the route live (plan §3.8): no user shows the
 * sign-in prompt, an off-permission route shows AccessDenied inside the
 * frame (an RBAC revoke in another window takes effect at once). A user whose
 * password was reset must choose a new one before going on.
 */
export function ErpShell({ children }: { children: React.ReactNode }) {
  const { userId, pendingQuickSignIn } = useSession()
  const { user, can, loading } = usePermissions()
  const pathname = usePathname()
  useShellHotkeys()

  // A quick sign-in in progress (launcher, Demo Wall pane, ?user=) says so instead of a blank frame.
  if (pendingQuickSignIn) return <SigningIn username={pendingQuickSignIn} />
  if (userId && loading) return null
  if (!userId || !user) return <SignInRequired pathname={pathname} />

  const allowed = routeAllowed(pathname, (key) => can(key))

  return (
    <div
      data-slot="erp-shell"
      className="flex h-svh w-full overflow-hidden bg-background text-foreground"
    >
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} />
        <main
          id="main"
          className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-4 pt-2 pb-[max(1.5rem,var(--cue-space,0px))] xl:px-6"
        >
          {allowed ? children : <AccessDenied pathname={pathname} />}
        </main>
      </div>
      <CommandPalette />
      <CrossWindowToasts />
      <CueCard />
      <PasswordChangeGate mustChange={user.mustChangePassword} />
    </div>
  )
}

/** "Signing in as Tania Akter…" while the quick sign-in commits (it waits for a first seed). */
function SigningIn({ username }: { username: string }) {
  const { t, locale } = useLocale()
  const seed = findSeedUser(username)
  const name = seed ? (locale === "bn" ? seed.nameBn : seed.nameEn) : username
  return (
    <div
      className="flex min-h-svh items-center justify-center gap-3 bg-background text-sm text-muted-foreground"
      data-testid="signing-in"
    >
      <LoaderCircle className="size-5 animate-spin text-link" />
      {t("shell.signingIn", { name })}
    </div>
  )
}
