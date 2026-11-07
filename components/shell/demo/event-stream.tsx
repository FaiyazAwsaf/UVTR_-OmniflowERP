"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Activity, Inbox } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { EventRow } from "@/core/db/schema"
import { useSession } from "@/core/session/session"
import { subscribe } from "@/core/events/bus"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import {
  actorName,
  consumerLabel,
  eventDef,
  eventLabel,
  locationCode,
  SEVERITY_DOT,
} from "@/modules/demo/components/labels"

import { EventDetail } from "./event-detail"
import { FilterPills } from "./filter-pills"
import { useDemoUi } from "./store"

/** Right-hand drawer width (about 420px, ui_guidelines §4), narrower on phones. */
export const DRAWER_CLASS =
  "gap-0 p-0 data-[side=right]:w-[26.25rem] data-[side=right]:max-w-[calc(100vw-1rem)] data-[side=right]:sm:max-w-[26.25rem]"

/**
 * The sheet title primitive sets a Latin-only heading face; titles inherit the
 * window's face instead so Bangla renders (html[lang="bn"] switches it).
 */
export const INHERIT_FONT = { fontFamily: "inherit" } as const

const LIMIT = 200

type StreamFilter = "all" | "location" | "mine"

/**
 * Top-bar button for the live event stream (plan §3.4). Shows how many events
 * were committed since the drawer was last opened in this window.
 */
export function EventStreamTrigger() {
  const { t, num } = useLocale()
  const db = useDb()
  const open = useDemoUi((s) => s.streamOpen)
  const setOpen = useDemoUi((s) => s.setStreamOpen)
  const seen = useDemoUi((s) => s.seen[db.name])
  const markSeen = useDemoUi((s) => s.markSeen)
  const maxSeq = useLiveQuery(
    async () => (await db.events.orderBy("seq").last())?.seq ?? 0,
    [db]
  )

  React.useEffect(() => {
    if (maxSeq === undefined) return
    // First sight of this database, drawer open, or a reset restarted the log.
    if (seen === undefined || open || seen > maxSeq) markSeen(db.name, maxSeq)
  }, [db.name, maxSeq, seen, open, markSeen])

  const unread =
    !open && maxSeq !== undefined && seen !== undefined
      ? Math.max(0, maxSeq - seen)
      : 0
  const label = unread
    ? `${t("demo.stream.open")} (${t("demo.stream.unread", { count: num(unread) })})`
    : t("demo.stream.open")

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={label}
            title={label}
            data-testid="event-stream-trigger"
          />
        }
      >
        <Activity />
        {unread > 0 ? (
          <span
            key={unread}
            aria-hidden
            className="count-badge absolute -top-1 -right-1 flex h-4 min-w-4 animate-in items-center justify-center px-1 text-[0.625rem] leading-none font-semibold zoom-in-50"
          >
            {unread > 99 ? `${num(99)}+` : num(unread)}
          </span>
        ) : null}
      </SheetTrigger>
      <SheetContent
        side="right"
        className={DRAWER_CLASS}
        data-testid="event-stream"
      >
        <EventStreamPanel />
      </SheetContent>
    </Sheet>
  )
}

/** Event seqs that just arrived over the bus; they flash turquoise for about 1.2s. */
function useFreshSeqs(dbName: string): ReadonlySet<number> {
  const [fresh, setFresh] = React.useState<ReadonlySet<number>>(() => new Set())
  React.useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const off = subscribe((message) => {
      // Offline filter (plan §3.6): notices from another database are not ours.
      if (message.kind !== "commit" || message.db !== dbName) return
      const seqs = message.events.map((e) => e.seq)
      if (!seqs.length) return
      setFresh((prev) => new Set([...prev, ...seqs]))
      const timer = setTimeout(() => {
        timers.delete(timer)
        setFresh((prev) => {
          const next = new Set(prev)
          for (const seq of seqs) next.delete(seq)
          return next
        })
      }, 1600)
      timers.add(timer)
    })
    return () => {
      off()
      timers.forEach(clearTimeout)
    }
  }, [dbName])
  return fresh
}

function EventStreamPanel() {
  const { t, num, locale } = useLocale()
  const db = useDb()
  const { userId, locationId } = useSession()
  const [filter, setFilter] = React.useState<StreamFilter>("all")
  const [selectedSeq, setSelectedSeq] = React.useState<number | null>(null)
  const fresh = useFreshSeqs(db.name)
  // Re-render periodically so "2 minutes ago" stays true (and on clock moves).
  useNow(15_000)
  void locale

  const events = useLiveQuery(() => {
    if (filter === "location" && locationId) {
      return db.events
        .where("locationId")
        .equals(locationId)
        .reverse()
        .limit(LIMIT)
        .toArray()
    }
    if (filter === "mine" && userId) {
      return db.events
        .where("actor.userId")
        .equals(userId)
        .reverse()
        .limit(LIMIT)
        .toArray()
    }
    return db.events.orderBy("seq").reverse().limit(LIMIT).toArray()
  }, [db, filter, locationId, userId])

  const select = (event: EventRow) => setSelectedSeq(event.seq)

  return (
    <>
      <SheetHeader className="gap-1 border-b border-hairline p-4 pr-12">
        <div className="flex items-center gap-2">
          <SheetTitle className="text-base font-semibold" style={INHERIT_FONT}>
            {t("demo.stream.title")}
          </SheetTitle>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[0.625rem] font-medium text-primary">
            <span
              aria-hidden
              className="size-1.5 animate-pulse rounded-full bg-primary"
            />
            {t("demo.stream.live")}
          </span>
        </div>
        <SheetDescription>{t("demo.stream.subtitle")}</SheetDescription>
        <FilterPills<StreamFilter>
          className="mt-2"
          label={t("demo.stream.title")}
          value={filter}
          onChange={(next) => {
            setFilter(next)
            setSelectedSeq(null)
          }}
          options={[
            { value: "all", label: t("demo.stream.filters.all") },
            {
              value: "location",
              label: t("demo.stream.filters.myLocation"),
              disabled: !locationId,
            },
            {
              value: "mine",
              label: t("demo.stream.filters.mine"),
              disabled: !userId,
            },
          ]}
        />
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selectedSeq !== null ? (
          <EventDetail seq={selectedSeq} onBack={() => setSelectedSeq(null)} />
        ) : events === undefined ? (
          <p className="p-4 text-xs text-muted-foreground">
            {t("demo.common.loading")}
          </p>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <span className="icon-well flex size-10 items-center justify-center text-muted-foreground">
              <Inbox className="size-4" />
            </span>
            <p className="text-xs text-muted-foreground">
              {filter === "all"
                ? t("demo.stream.empty")
                : t("demo.stream.emptyFilter")}
            </p>
          </div>
        ) : (
          <>
            <ol className="divide-y divide-hairline" data-testid="event-list">
              {events.map((event) => (
                <EventListItem
                  key={event.seq}
                  event={event}
                  fresh={fresh.has(event.seq)}
                  onSelect={() => select(event)}
                />
              ))}
            </ol>
            {events.length >= LIMIT ? (
              <p className="px-4 py-3 text-center text-[0.6875rem] text-muted-foreground">
                {t("demo.stream.latest", { count: num(LIMIT) })}
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}

function EventListItem({
  event,
  fresh,
  onSelect,
}: {
  event: EventRow
  fresh: boolean
  onSelect: () => void
}) {
  const { tk, num, locale, relative, dateTime, dmy } = useLocale()
  const def = eventDef(event.type)
  const label = eventLabel(event, tk, num, locale, dmy)
  const consumers = (event.consumers ?? def?.consumers ?? []).map((key) =>
    consumerLabel(key, tk)
  )
  const who = [
    actorName(event.actor, locale, tk),
    locationCode(event.locationId),
    event.app?.toUpperCase(),
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        data-testid="event-row"
        data-event-type={event.type}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors outline-none hover:bg-primary-soft focus-visible:bg-primary-soft",
          fresh && "flash-sync"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            SEVERITY_DOT[def?.severity ?? "info"]
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[0.8125rem] font-medium",
                !label.known && "font-mono text-xs"
              )}
            >
              {label.text}
            </span>
            <span
              title={dateTime(event.at)}
              className="shrink-0 text-[0.6875rem] text-muted-foreground"
            >
              {relative(event.at)}
            </span>
          </span>
          <span className="truncate text-xs text-muted-foreground">{who}</span>
          {consumers.length ? (
            <span className="mt-0.5 flex flex-wrap items-center gap-1">
              {consumers.length ? (
                <>
                  <span aria-hidden className="text-[0.6875rem] text-link">
                    →
                  </span>
                  {consumers.map((consumer, i) => (
                    <span
                      key={`${consumer}-${i}`}
                      className="rounded-full bg-surface-raised px-1.5 py-px text-[0.625rem] text-foreground/85"
                    >
                      {consumer}
                    </span>
                  ))}
                </>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  )
}
