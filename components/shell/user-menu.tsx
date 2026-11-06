"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronDown, KeyRound, LayoutGrid, LogOut, MapPin } from "lucide-react"

import { UserAvatar } from "@/components/shared/avatars"
import { ChangePasswordDialog } from "@/components/shell/change-password-dialog"
import { switchLocation } from "@/components/shell/location-switcher"
import { UiScaleStepper } from "@/components/shell/ui-scale"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getCentralDb } from "@/core/db/database"
import type { UserRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { signOut } from "@/core/security/signin"
import { usePermissions } from "@/core/security/useCan"
import { nameOf, useLocations, userName } from "@/core/security/users"
import { useActor } from "@/core/session/actor"
import { setSignedOut, useSession } from "@/core/session/session"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/** Sign this window out: end its session row, then clear the window. */
export function useSignOut() {
  const router = useRouter()
  const actor = useActor()
  return React.useCallback(async () => {
    if (actor) {
      try {
        await commit(signOut, {}, { db: getCentralDb(), actor })
      } catch {
        // An ended session is already signed out.
      }
    }
    setSignedOut("sign-out")
    router.push("/login")
  }, [actor, router])
}

/**
 * The avatar block (name, role, chevron) opens the user menu
 * (ui_guidelines.md §3): the profile line, change password, location switch
 * for users with several, display size, the launcher and sign out.
 */
export function UserMenu({ user, className }: { user: UserRow; className?: string }) {
  const { t, locale } = useLocale()
  const router = useRouter()
  const { security } = usePermissions()
  const { locationId } = useSession()
  const locations = useLocations()
  const doSignOut = useSignOut()
  const current = locationId ?? user.homeLocationId
  const mine = (locations ?? []).filter((l) => user.locationIds.includes(l.id))
  const home = (locations ?? []).find((l) => l.id === user.homeLocationId)
  const role = security?.roleCodes[0]
  const [passwordOpen, setPasswordOpen] = React.useState(false)

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        data-slot="user-menu"
        data-testid="user-menu"
        aria-label={t("shell.account")}
        className={cn(
          "flex h-12 min-w-0 shrink-0 items-center gap-3 rounded-md py-1 pr-2 pl-1 text-left transition-colors outline-none hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-expanded:bg-card",
          className
        )}
      >
        <UserAvatar user={user} role={role} size={40} />
        <span className="hidden min-w-0 flex-col @min-[76rem]/topbar:flex">
          <span className="max-w-[11rem] truncate text-[0.9375rem] leading-tight font-semibold">
            {userName(user, locale)}
          </span>
          <span className="max-w-[11rem] truncate text-xs leading-tight text-muted-foreground">
            {locale === "bn" ? user.designationBn : user.designationEn}
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-[min(20rem,calc(100vw-2rem))] p-0">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-3 px-4 pt-4 pb-3">
            <UserAvatar user={user} role={role} size={44} />
            <span className="min-w-0">
              <span className="block text-xs font-normal text-muted-foreground">
                {t("shell.userMenu.signedInAs")}
              </span>
              <span className="block truncate text-[0.9375rem] font-semibold text-foreground">
                {userName(user, locale)}
              </span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {[locale === "bn" ? user.designationBn : user.designationEn, nameOf(home, locale)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span lang="en" className="block truncate font-mono text-xs font-normal text-muted-foreground">
                {user.username} · {user.employeeNo}
              </span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="mx-0 my-0" />
        <div className="p-1.5">
          <DropdownMenuItem data-testid="change-password" onClick={() => setPasswordOpen(true)}>
            <KeyRound />
            {t("shell.changePassword")}
          </DropdownMenuItem>
        </div>
        {mine.length > 1 ? (
          <>
            <DropdownMenuSeparator className="mx-0 my-0" />
            <div className="p-1.5">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("shell.location.switch")}</DropdownMenuLabel>
                {mine.map((l) => (
                  <DropdownMenuItem
                    key={l.id}
                    data-testid={`location-${l.code}`}
                    onClick={() =>
                      l.id !== current &&
                      switchLocation(l, t("shell.location.switched", { location: nameOf(l, locale) }))
                    }
                    className={cn("gap-3", l.id === current && "bg-primary-soft")}
                  >
                    <MapPin />
                    <span className="flex-1 truncate">{nameOf(l, locale)}</span>
                    <span translate="no" className="font-mono text-[0.6875rem] text-muted-foreground">
                      {l.code}
                    </span>
                    {l.id === current ? <Check className="size-4 text-primary" /> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </div>
          </>
        ) : null}
        <DropdownMenuSeparator className="mx-0 my-0" />
        <div className="px-4 py-2.5">
          <UiScaleStepper />
        </div>
        <DropdownMenuSeparator className="mx-0 my-0" />
        <div className="p-1.5">
          <DropdownMenuItem onClick={() => router.push("/")}>
            <LayoutGrid />
            {t("shell.userMenu.openLauncher")}
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="sign-out" onClick={() => void doSignOut()}>
            <LogOut />
            {t("shell.signOut")}
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
    <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  )
}
