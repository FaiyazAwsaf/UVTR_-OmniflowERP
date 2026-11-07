"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowLeft,
  ExternalLink,
  House,
  Maximize2,
  Minimize2,
} from "lucide-react"

import { DemoPanelTrigger } from "@/components/shell/demo/demo-panel"
import { EventStreamTrigger } from "@/components/shell/demo/event-stream"
import { LangToggle } from "@/components/shell/demo/lang-toggle"
import { Wordmark } from "@/components/shell/demo/wordmark"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  findSeedUser,
  ROLE_DESIGNATION,
  ROLE_ORDER,
  SEED_USERS,
  type SeedUser,
} from "@/core/security/seed-users"
import { windowKey } from "@/core/session/windowId"
import { useSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import {
  DEMO_LAYOUT,
  openWindow,
  userUrl,
  WALL_COMPANION,
  windowNameFor,
  type WallCompanionMessage,
} from "../launcher/windows"
import { ROLE_ICONS } from "../role-icons"

/** Default panes: Advisor (GUL), Technician (GUL), Cashier (GUL), Accountant (plan §9). */
const DEFAULT_PANES = DEMO_LAYOUT

const storageKey = () => `of:wall:${windowKey()}`

const userName = (u: SeedUser, locale: "en" | "bn") =>
  locale === "bn" ? u.nameBn : u.nameEn

/**
 * Pane users: `/wall?users=farzana,mahbub` (launchers; missing panes keep
 * the default layout), else the ones chosen in this Wall tab (kept across
 * reloads), else Advisor, Technician, Cashier and Accountant.
 */
function readPanes(): string[] {
  if (typeof window === "undefined") return DEFAULT_PANES
  const fromUrl = new URL(window.location.href).searchParams.get("users")
  if (fromUrl) {
    const wanted = fromUrl
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter((name) => findSeedUser(name))
      .slice(0, DEFAULT_PANES.length)
    if (wanted.length) {
      const panes = DEFAULT_PANES.map((fallback, i) => wanted[i] ?? fallback)
      writePanes(panes)
      return panes
    }
  }
  try {
    const saved = JSON.parse(
      window.sessionStorage.getItem(storageKey()) ?? "null"
    ) as unknown
    if (
      Array.isArray(saved) &&
      saved.length === DEFAULT_PANES.length &&
      saved.every((id) => typeof id === "string" && findSeedUser(id))
    ) {
      return saved as string[]
    }
  } catch {
    // Unreadable storage: fall back to the default layout.
  }
  return DEFAULT_PANES
}

function writePanes(panes: string[]): void {
  try {
    window.sessionStorage.setItem(storageKey(), JSON.stringify(panes))
  } catch {
    // The layout still applies for this page.
  }
}

/**
 * The Demo Wall (plan §9, "/wall"): four users side by side in one tab.
 * Each pane is a same-origin iframe named `of-wall-<n>`, so it has its own
 * per-window session while sharing IndexedDB and the BroadcastChannel bus:
 * live sync works exactly as between separate windows.
 */
export function DemoWall() {
  const { t } = useLocale()
  const [panes, setPanes] = React.useState<string[]>(readPanes)
  const [reloads, setReloads] = React.useState<number[]>(() =>
    DEFAULT_PANES.map(() => 0)
  )
  const [expanded, setExpanded] = React.useState<number | null>(null)
  // A pane opened on a scenario's screen (companion) instead of its landing route.
  const [routes, setRoutes] = React.useState<(string | undefined)[]>(() =>
    DEFAULT_PANES.map(() => undefined)
  )

  const choose = (index: number, username: string) => {
    const next = panes.map((id, i) => (i === index ? username : id))
    setPanes(next)
    writePanes(next)
    setRoutes((current) => current.map((r, i) => (i === index ? undefined : r)))
  }
  const reload = (index: number) => {
    setRoutes((current) => current.map((r, i) => (i === index ? undefined : r)))
    setReloads((current) => current.map((n, i) => (i === index ? n + 1 : n)))
  }

  // A launcher with a companion (E13, E15) run in one pane signs the next pane
  // in as the companion user on its screen (plan §10).
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as WallCompanionMessage | undefined
      if (data?.type !== WALL_COMPANION || !findSeedUser(data.user)) return
      const from = /^of-wall-(\d)$/.exec(data.from ?? "")
      const source = from ? Number(from[1]) - 1 : 0
      const target = (source + 1) % DEFAULT_PANES.length
      setPanes((current) => {
        const next = current.map((id, i) => (i === target ? data.user : id))
        writePanes(next)
        return next
      })
      setRoutes((current) =>
        current.map((r, i) => (i === target ? data.route : r))
      )
      setReloads((current) => current.map((n, i) => (i === target ? n + 1 : n)))
      setExpanded(null)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  return (
    <div className="flex h-svh flex-col bg-background" data-testid="demo-wall">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-hairline px-3">
        <Wordmark className="text-base" />
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {t("demo.wall.title")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-1"
          nativeButton={false}
          render={<Link href="/" />}
          data-testid="wall-launcher"
        >
          <ArrowLeft />
          {t("demo.wall.launcher")}
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <LangToggle />
          <EventStreamTrigger />
          <DemoPanelTrigger />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1.5 p-1.5">
        {panes.map((username, index) => (
          <WallPane
            key={index}
            index={index}
            username={username}
            route={routes[index]}
            reload={reloads[index]}
            expanded={expanded === index}
            hidden={expanded !== null && expanded !== index}
            onChoose={(id) => choose(index, id)}
            onReload={() => reload(index)}
            onToggle={() =>
              setExpanded((current) => (current === index ? null : index))
            }
          />
        ))}
      </main>
    </div>
  )
}

function WallPane({
  index,
  username,
  route,
  reload,
  expanded,
  hidden,
  onChoose,
  onReload,
  onToggle,
}: {
  index: number
  username: string
  route?: string
  reload: number
  expanded: boolean
  hidden: boolean
  onChoose: (username: string) => void
  onReload: () => void
  onToggle: () => void
}) {
  const { t, num, locale } = useLocale()
  const user: SeedUser = findSeedUser(username) ?? SEED_USERS[0]
  const Icon = ROLE_ICONS[user.role]
  const n = num(index + 1)
  const name = userName(user, locale)
  const role = ROLE_DESIGNATION[user.role][locale]
  // A pane opens in the wall's language and theme (each pane can switch its own afterwards); read once,
  // so switching the wall later does not reload the panes and lose their work.
  const { theme } = useSession()
  const [look] = React.useState(() => ({ lang: locale, theme }))
  const src = userUrl(
    user.username,
    { scale: "0.9", lang: look.lang, theme: look.theme },
    route
  )
  const toggleLabel = expanded ? t("demo.wall.restore") : t("demo.wall.expand")

  return (
    <section
      aria-label={t("demo.wall.pane", { n })}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-card ring-1 ring-border/70",
        expanded && "col-span-2 row-span-2",
        hidden && "hidden"
      )}
      data-testid={`wall-pane-${index + 1}`}
    >
      <div
        className="flex h-9 shrink-0 items-center gap-1.5 border-b border-hairline px-2"
        onDoubleClick={onToggle}
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-raised text-[0.625rem] font-semibold">
          {n}
        </span>
        <Icon className="size-3.5 shrink-0 text-primary" />
        <Select
          value={user.username}
          onValueChange={(value) => value && onChoose(value)}
        >
          <SelectTrigger
            size="sm"
            className="h-7 max-w-[18rem] min-w-0 border-transparent bg-transparent px-1.5 font-medium dark:bg-transparent"
            aria-label={t("demo.wall.chooseUser", { n })}
            data-testid={`wall-user-${index + 1}`}
          >
            <SelectValue>
              {() => (
                <span className="truncate">
                  {name}
                  <span className="ml-1.5 text-muted-foreground">
                    {role} · {user.home}
                  </span>
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            alignItemWithTrigger={false}
            align="start"
            className="min-w-64"
          >
            {ROLE_ORDER.map((code) => {
              const options = SEED_USERS.filter((u) => u.role === code)
              if (!options.length) return null
              return (
                <SelectGroup key={code}>
                  <SelectLabel>{ROLE_DESIGNATION[code][locale]}</SelectLabel>
                  {options.map((u) => (
                    <SelectItem
                      key={u.username}
                      value={u.username}
                      className="pr-8"
                    >
                      <span className="truncate">{userName(u, locale)}</span>
                      <span className="ml-auto pl-3 font-mono text-[0.625rem] text-muted-foreground">
                        {u.home}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )
            })}
          </SelectContent>
        </Select>
        <div className="ml-auto flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onReload}
            aria-label={t("demo.wall.home")}
            title={t("demo.wall.home")}
            data-testid={`wall-reload-${index + 1}`}
          >
            <House />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() =>
              openWindow(userUrl(user.username), windowNameFor(user.username))
            }
            aria-label={t("demo.wall.openWindow")}
            title={t("demo.wall.openWindow")}
            data-testid={`wall-window-${index + 1}`}
          >
            <ExternalLink />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggle}
            aria-pressed={expanded}
            aria-label={toggleLabel}
            title={toggleLabel}
            data-testid={`wall-expand-${index + 1}`}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>
      </div>
      <iframe
        key={`${user.username}:${reload}:${route ?? ""}`}
        name={`of-wall-${index + 1}`}
        src={src}
        title={t("demo.wall.frameTitle", { name, role })}
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
    </section>
  )
}
