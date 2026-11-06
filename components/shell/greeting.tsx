"use client"

import * as React from "react"
import { Hand } from "lucide-react"

import { dhakaTime } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import type { UserRow } from "@/core/db/schema"
import { useSession } from "@/core/session/session"
import { firstName, nameOf, useLocations } from "@/core/security/users"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

type DayPart = "morning" | "afternoon" | "evening"

/** Morning until 11:59, afternoon to 16:59, evening otherwise (Dhaka, demo clock). */
export function dayPartAt(ms: number): DayPart {
  const hour = Number(dhakaTime(ms).slice(0, 2))
  if (hour < 12) return "morning"
  if (hour < 17) return "afternoon"
  return "evening"
}

/**
 * The top bar greeting (ui_guidelines.md §3): "Good morning, Tania" by the
 * demo-clock hour, and the context line "Cashier · Gulshan Studio".
 */
export function Greeting({ user, className }: { user: UserRow; className?: string }) {
  const { t, locale } = useLocale()
  const nowMs = useNow(60_000)
  const { locationId } = useSession()
  const locations = useLocations()
  const location = locations?.find((l) => l.id === (locationId ?? user.homeLocationId))
  const context = [locale === "bn" ? user.designationBn : user.designationEn, nameOf(location, locale)]
    .filter(Boolean)
    .join(" · ")
  return (
    <div data-slot="greeting" className={cn("min-w-0", className)}>
      <h1 className="flex min-w-0 items-center gap-2 text-[1.1875rem] leading-tight font-semibold tracking-tight @min-[60rem]/topbar:text-[1.375rem]">
        <span className="truncate">
          {t(`shell.greeting.${dayPartAt(nowMs)}`, { name: firstName(user, locale) })}
        </span>
        <Hand
          aria-hidden
          className="size-5.5 shrink-0 -rotate-12 fill-warning/85 stroke-[1.6] text-[color-mix(in_oklch,var(--warning),black_35%)]"
        />
      </h1>
      <p data-testid="greeting-context" className="mt-1 truncate text-[0.8125rem] text-muted-foreground">
        {context}
      </p>
    </div>
  )
}
