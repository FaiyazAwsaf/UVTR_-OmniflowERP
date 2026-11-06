"use client"

import * as React from "react"
import { Search } from "lucide-react"

import { ApprovalsBell } from "@/components/shell/approvals-bell"
import { ClockChip } from "@/components/shell/clock-chip"
import { DemoPanelTrigger } from "@/components/shell/demo/demo-panel"
import { EventStreamTrigger } from "@/components/shell/demo/event-stream"
import { Greeting } from "@/components/shell/greeting"
import { LocationSwitcher } from "@/components/shell/location-switcher"
import { openPalette } from "@/components/shell/palette-store"
import { LanguageToggle, ThemeToggle } from "@/components/shell/toggles"
import { UserMenu } from "@/components/shell/user-menu"
import { TenantMark } from "@/components/shared/tenant-mark"
import { tenant } from "@/config/brand.config"
import type { UserRow } from "@/core/db/schema"
import { useModKey } from "@/hooks/use-mod-key"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/**
 * The global search field (ui_guidelines.md §3): a filled input that hands
 * over to the command palette's search. A click opens the palette; typing
 * opens it with what was typed, so the search continues there.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const { t } = useLocale()
  const mod = useModKey()
  return (
    <label
      data-slot="global-search"
      className={cn(
        "relative flex h-11 min-w-0 cursor-text items-center rounded-md border border-transparent bg-card shadow-(--card-shadow) transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/20",
        className
      )}
    >
      <Search className="pointer-events-none absolute left-3.5 size-[1.125rem] text-muted-foreground" />
      <input
        type="search"
        value=""
        onChange={(event) => openPalette(event.target.value)}
        onMouseDown={(event) => {
          event.preventDefault()
          openPalette()
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "ArrowDown") {
            event.preventDefault()
            openPalette()
          }
        }}
        placeholder={t("shell.searchPlaceholder")}
        aria-label={t("shell.searchPlaceholder")}
        aria-haspopup="dialog"
        data-testid="global-search"
        className="h-full w-full min-w-0 bg-transparent pr-14 pl-10 text-sm text-foreground outline-none placeholder:truncate placeholder:text-muted-foreground"
      />
      <kbd
        aria-hidden
        className="pointer-events-none absolute right-2.5 rounded-sm bg-surface-raised px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground"
      >
        {mod} K
      </kbd>
    </label>
  )
}

/** Narrow top bars show a search button that opens the same palette search. */
function SearchButton({ className }: { className?: string }) {
  const { t } = useLocale()
  return (
    <button
      type="button"
      onClick={() => openPalette()}
      aria-label={t("shell.searchPlaceholder")}
      title={t("common.search")}
      data-testid="global-search-button"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-md bg-card text-foreground shadow-(--card-shadow) transition-colors outline-none hover:bg-surface-raised focus-visible:ring-[3px] focus-visible:ring-ring/40",
        className
      )}
    >
      <Search className="size-[1.125rem]" />
    </button>
  )
}

/**
 * The ERP top bar (ui_guidelines.md §3), left to right: greeting and context
 * line, the tenant mark (wide screens), the search field, then the location
 * switcher (users with several locations), the demo clock, the demo panel,
 * the approvals bell, the event stream, EN/বাং, theme and the user menu. It
 * adapts to its own width, so a 960x600 window keeps every control.
 */
export function TopBar({ user }: { user: UserRow }) {
  const { locale } = useLocale()
  return (
    <header
      data-slot="top-bar"
      className="@container/topbar relative z-20 flex h-[4.75rem] shrink-0 items-center gap-3 px-4 xl:px-6 print:hidden"
    >
      <Greeting user={user} className="min-w-[8rem] flex-1" />
      <span
        className="hidden shrink-0 items-center gap-2 @min-[100rem]/topbar:flex"
        data-testid="tenant-mark"
      >
        <TenantMark size={30} />
        <span className="text-sm font-semibold">{tenant.shortName[locale]}</span>
      </span>
      <GlobalSearch className="hidden w-[18rem] shrink @min-[72rem]/topbar:flex @min-[100rem]/topbar:w-[21.5rem] @min-[116rem]/topbar:w-[26rem]" />
      {/* Narrow bars (a Demo Wall pane in a small window) drop what the
          palette or the Wall header also offers: theme, language, the
          event stream and the demo panel. */}
      <div className="flex shrink-0 items-center gap-1.5 @min-[60rem]/topbar:gap-2">
        <SearchButton className="@min-[72rem]/topbar:hidden" />
        <LocationSwitcher user={user} className="hidden @min-[34rem]/topbar:flex" />
        <ClockChip />
        <span className="hidden @min-[36rem]/topbar:contents">
          <DemoPanelTrigger />
        </span>
        <ApprovalsBell />
        <span className="hidden @min-[36rem]/topbar:contents">
          <EventStreamTrigger />
        </span>
        <LanguageToggle className="hidden @min-[40rem]/topbar:flex" />
        <ThemeToggle className="hidden @min-[44rem]/topbar:flex" />
        <UserMenu user={user} />
      </div>
    </header>
  )
}
