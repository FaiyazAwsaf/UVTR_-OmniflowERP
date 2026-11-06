"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "motion/react"
import { LayoutGrid, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react"

import { ScrollFade } from "@/components/motion/scroll-fade"
import { activeHref, groupLabelKey, groupNav, navFor } from "@/components/shell/nav"
import { useNavCounts } from "@/components/shell/nav-counts"
import { useHomeRoute } from "@/components/shell/access"
import { useSignOut } from "@/components/shell/user-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { usePermissions } from "@/core/security/useCan"
import type { NavItem } from "@/core/security/types"
import { useSyncFlash } from "@/components/shell/use-sync-flash"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useModKey } from "@/hooks/use-mod-key"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { SIDEBAR_RAIL_BELOW_PX, useUi } from "@/lib/store"

/** Expanded and rail widths (rem, so they follow the UI scale). */
export const SIDEBAR_WIDTH = "14.5rem"
export const SIDEBAR_RAIL_WIDTH = "4rem"

/** Whether this window's sidebar is currently the icon rail. */
export function useSidebarCollapsed(): boolean {
  const narrow = useMediaQuery(`(max-width: ${SIDEBAR_RAIL_BELOW_PX - 0.02}px)`)
  const choice = useUi((state) => state.sidebarCollapsed)
  return choice ?? narrow
}

/**
 * "UVTR_" in white and "OmniflowERP" in turquoise (D15), with the outlined
 * package chip "SME" (ui_guidelines.md §3).
 */
export function Wordmark({ className, chip = true }: { className?: string; chip?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-baseline text-[1.25rem] leading-none font-bold tracking-tight whitespace-nowrap",
          className
        )}
        translate="no"
      >
        <span className="text-sidebar-foreground">UVTR_</span>
        <span className="text-primary">OmniflowERP</span>
      </span>
      {chip ? (
        <span
          translate="no"
          className="rounded-full border border-primary/60 px-1.5 py-px font-mono text-[0.625rem] leading-tight font-semibold text-primary"
        >
          SME
        </span>
      ) : null}
    </span>
  )
}

/**
 * The ERP sidebar (ui_guidelines.md §3): wordmark, the Workspace group and
 * the four suites with each app's code chip, filtered LIVE by the user's
 * permissions (an RBAC revoke removes an app at once), a filled turquoise pill
 * on the active entry, yellow count badges, and "Switch user / Launcher" and
 * "Sign out" at the bottom. It becomes a 64px icon rail below 1100px or on
 * Cmd/Ctrl+B; the choice is per window.
 */
export function AppSidebar() {
  const pathname = usePathname()
  const { t, tk } = useLocale()
  const collapsed = useSidebarCollapsed()
  const toggleSidebar = useUi((state) => state.toggleSidebar)
  const mod = useModKey()
  const { can } = usePermissions()
  const items = React.useMemo(() => navFor((key) => can(key)), [can])
  const groups = React.useMemo(() => groupNav(items), [items])
  const active = activeHref(items, pathname)
  const counts = useNavCounts()
  const home = useHomeRoute()
  const doSignOut = useSignOut()
  const pillId = React.useId()

  const toggleLabel = collapsed ? t("shell.sidebar.expand") : t("shell.sidebar.collapse")

  return (
    <motion.aside
      data-slot="app-sidebar"
      data-collapsed={collapsed}
      aria-label={t("shell.sidebar.navigation")}
      initial={false}
      animate={{ width: collapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH }}
      transition={{ type: "spring", stiffness: 420, damping: 42 }}
      className="relative z-30 flex h-svh shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground print:hidden"
    >
      <div
        className={cn(
          "flex h-18 shrink-0 items-center",
          collapsed ? "justify-center" : "px-5"
        )}
      >
        <Link
          href={home}
          className="min-w-0 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          aria-label="UVTR_OmniflowERP"
        >
          {collapsed ? (
            <span
              translate="no"
              className="flex size-10 items-center justify-center rounded-md bg-sidebar-accent text-base leading-none font-bold"
            >
              <span>U</span>
              <span className="text-primary">O</span>
            </span>
          ) : (
            // Sized so the wordmark and its SME chip fit the 232px sidebar.
            <Wordmark className="text-[1.0625rem]" />
          )}
        </Link>
      </div>

      <ScrollFade className="min-h-0 flex-1 px-3 pb-3" fade={24}>
        <nav className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.group}>
              {collapsed ? (
                <div aria-hidden className="mx-auto mb-2 h-px w-6 bg-sidebar-border" />
              ) : (
                <div
                  className="truncate px-2.5 pb-1.5 text-[0.8125rem] text-muted-foreground"
                  title={group.group === "workspace" ? undefined : tk(`suites.${group.group}.name`)}
                >
                  {tk(groupLabelKey(group.group))}
                </div>
              )}
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <NavRow
                    key={item.href}
                    item={item}
                    label={tk(item.labelKey)}
                    active={item.href === active}
                    collapsed={collapsed}
                    count={counts ? (counts[item.href] ?? 0) : undefined}
                    pillId={pillId}
                  />
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </ScrollFade>

      <div className="flex shrink-0 flex-col gap-1 border-t border-sidebar-border p-3">
        <RailTip label={`${toggleLabel} (${mod} B)`} enabled>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={toggleLabel}
            className={cn(
              "flex h-10 items-center gap-3 rounded-md text-[0.875rem] text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
              collapsed ? "w-10 justify-center self-center" : "px-3"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5 shrink-0" />
            ) : (
              <PanelLeftClose className="size-5 shrink-0" />
            )}
            {collapsed ? null : (
              <span className="flex-1 truncate text-left">{toggleLabel}</span>
            )}
          </button>
        </RailTip>
        <RailTip label={t("shell.sidebar.launcher")} enabled={collapsed}>
          <Link
            href="/"
            className={cn(
              "flex h-10 items-center gap-3 rounded-md text-[0.875rem] text-sidebar-foreground/90 transition-colors outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
              collapsed ? "w-10 justify-center self-center" : "px-3"
            )}
          >
            <LayoutGrid className="size-5 shrink-0" />
            {collapsed ? (
              <span className="sr-only">{t("shell.sidebar.launcher")}</span>
            ) : (
              <span className="truncate">{t("shell.sidebar.launcher")}</span>
            )}
          </Link>
        </RailTip>
        <RailTip label={t("shell.sidebar.signOut")} enabled={collapsed}>
          <button
            type="button"
            data-testid="sidebar-sign-out"
            onClick={() => void doSignOut()}
            className={cn(
              "flex h-10 items-center gap-3 rounded-md text-[0.875rem] font-medium text-sidebar-foreground/90 transition-colors outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
              collapsed ? "w-10 justify-center self-center" : "px-3"
            )}
          >
            <LogOut className="size-5 shrink-0" />
            {collapsed ? (
              <span className="sr-only">{t("shell.sidebar.signOut")}</span>
            ) : (
              <span className="truncate">{t("shell.sidebar.signOut")}</span>
            )}
          </button>
        </RailTip>
      </div>
    </motion.aside>
  )
}

/** A tooltip to the right of a rail item (off when the sidebar is expanded). */
function RailTip({
  label,
  enabled,
  children,
}: {
  label: string
  enabled: boolean
  children: React.ReactElement
}) {
  if (!enabled) return children
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function NavRow({
  item,
  label,
  active,
  collapsed,
  count,
  pillId,
}: {
  item: NavItem
  label: string
  active: boolean
  collapsed: boolean
  count?: number
  pillId: string
}) {
  const { num } = useLocale()
  const Icon = item.icon
  const hasCount = count !== undefined && count > 0
  // A badge that moves because of another window's commit flashes the row.
  const flash = useSyncFlash(count)
  const slug = item.app ?? item.href.slice(1).replace(/\//g, "-")

  const link = (
    <Link
      href={item.href}
      data-testid={`nav-${slug}`}
      aria-current={active ? "page" : undefined}
      title={collapsed ? undefined : label}
      className={cn(
        "relative flex h-11 items-center gap-3 rounded-md text-[0.9375rem] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
        collapsed ? "w-10 justify-center self-center" : "px-2.5",
        active
          ? "text-primary-foreground"
          : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-foreground",
        !active && flash
      )}
    >
      {active ? (
        <motion.span
          layoutId={pillId}
          transition={{ type: "spring", stiffness: 520, damping: 42 }}
          className="absolute inset-0 rounded-md bg-primary"
        />
      ) : null}
      {collapsed && item.app ? (
        <span
          translate="no"
          className={cn(
            "relative z-10 font-mono text-[0.625rem] font-semibold uppercase",
            active ? "text-primary-foreground" : "text-sidebar-foreground/85"
          )}
        >
          {item.app}
        </span>
      ) : (
        <Icon className="relative z-10 size-5 shrink-0" />
      )}
      {!collapsed && item.app ? (
        <span
          translate="no"
          data-testid={`app-chip-${item.app}`}
          className={cn(
            "relative z-10 shrink-0 rounded-full px-1.5 py-px font-mono text-[0.6875rem] leading-tight font-semibold uppercase",
            active ? "bg-primary-foreground/15" : "bg-surface-raised text-sidebar-foreground/90"
          )}
        >
          {item.app}
        </span>
      ) : null}
      {collapsed ? (
        <>
          <span className="sr-only">{label}</span>
          {hasCount ? (
            <span
              data-testid={`nav-count-${slug}`}
              className="count-badge nums absolute -top-1 -right-1 z-10 flex h-4 min-w-4 items-center justify-center px-1 text-[0.625rem] font-semibold"
            >
              {num(count)}
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span className="relative z-10 min-w-0 flex-1 truncate">{label}</span>
          {hasCount ? (
            <span
              data-testid={`nav-count-${slug}`}
              className="count-badge nums relative z-10 flex h-5 min-w-5 items-center justify-center px-1.5 text-[0.6875rem] font-semibold"
            >
              {num(count)}
            </span>
          ) : null}
        </>
      )}
    </Link>
  )

  return (
    <li className={cn(collapsed && "flex justify-center")}>
      <RailTip label={label} enabled={collapsed}>
        {link}
      </RailTip>
    </li>
  )
}
