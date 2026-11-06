"use client"

import * as React from "react"
import { Check, ChevronDown, MapPin } from "lucide-react"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { LocationRow, UserRow } from "@/core/db/schema"
import { nameOf, useLocations } from "@/core/security/users"
import { updateSession, useSession } from "@/core/session/session"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/** The locations this user works at, in the order of the location table. */
export function useMyLocations(user: UserRow): { mine: LocationRow[]; current: LocationRow | undefined } {
  const { locationId } = useSession()
  const locations = useLocations()
  const mine = (locations ?? []).filter((l) => user.locationIds.includes(l.id))
  const currentId = locationId ?? user.homeLocationId
  return { mine, current: mine.find((l) => l.id === currentId) ?? (locations ?? []).find((l) => l.id === currentId) }
}

/** Make a location this window's current one (new documents take it, plan §3.8). */
export function switchLocation(location: LocationRow, message: string): void {
  updateSession({ locationId: location.id })
  toast.success(message)
}

/**
 * The top bar's location switcher for users who work at several locations
 * (Habib at CST, GUL and UTT; Farzana everywhere). It sets this window's
 * current location; other windows keep theirs.
 */
export function LocationSwitcher({ user, className }: { user: UserRow; className?: string }) {
  const { t, locale } = useLocale()
  const { mine, current } = useMyLocations(user)
  if (mine.length < 2 || !current) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="location-switcher"
        data-location={current.code}
        aria-label={`${t("shell.location.switch")}: ${nameOf(current, locale)}`}
        title={t("shell.location.switch")}
        className={cn(
          "flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-card px-2.5 text-[0.8125rem] font-medium shadow-(--card-shadow) transition-colors outline-none hover:bg-surface-raised focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-expanded:bg-surface-raised",
          className
        )}
      >
        <MapPin className="size-4 shrink-0 text-primary" />
        <span translate="no" className="font-mono text-xs font-semibold @min-[84rem]/topbar:hidden">
          {current.code}
        </span>
        <span className="hidden max-w-[10rem] truncate @min-[84rem]/topbar:inline">{nameOf(current, locale)}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-[min(18rem,calc(100vw-2rem))]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("shell.location.switch")}</DropdownMenuLabel>
          {mine.map((l) => (
            <DropdownMenuItem
              key={l.id}
              data-testid={`location-option-${l.code}`}
              onClick={() =>
                l.id !== current.id &&
                switchLocation(l, t("shell.location.switched", { location: nameOf(l, locale) }))
              }
              className={cn("gap-3", l.id === current.id && "bg-primary-soft")}
            >
              <MapPin />
              <span className="flex-1 truncate">{nameOf(l, locale)}</span>
              <span translate="no" className="font-mono text-[0.6875rem] text-muted-foreground">
                {l.code}
              </span>
              {l.id === current.id ? <Check className="size-4 text-primary" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
