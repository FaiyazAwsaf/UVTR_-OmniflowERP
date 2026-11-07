"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { LogOut, MonitorSmartphone } from "lucide-react"
import { toast } from "sonner"

import { DateText } from "@/components/shared/date-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { StatusPill, StatusText } from "@/components/shared/status"
import { UserAvatar } from "@/components/shared/avatars"
import { Button } from "@/components/ui/button"
import { dhakaDate, startOfDhakaDay } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { SessionRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { endSession } from "@/core/security/signin"
import { useCan } from "@/core/security/useCan"
import { useSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"

import { locationName, personName, useOpenSessions, useUserDirectory, useWallNow } from "../queries"
import { ConfirmDialog, ListTable, Mono, type ListColumn } from "./kit"

/**
 * /sac/sessions: every signed-in window with FORCE SIGN-OUT (`sac.endSession`,
 * core/security/signin.ts). The target window watches its sessions row and
 * returns to /login with "You were signed out by an administrator" at once.
 */
export function SessionsScreen() {
  const { t, tk, num, locale } = useLocale()
  const db = useDb()
  const directory = useUserDirectory()
  const open = useOpenSessions()
  const { sessionId: mine } = useSession()
  const canEnd = useCan("sac.session.end")
  const end = useCommand(endSession)
  const wall = useWallNow()
  const nowMs = useNow(60_000)
  const dayStart = nowMs ? startOfDhakaDay(dhakaDate(nowMs)) : 0
  const [target, setTarget] = React.useState<SessionRow | null>(null)

  const ended = useLiveQuery(
    async () =>
      (await db.sessions.where("endedAt").aboveOrEqual(dayStart).toArray()).sort(
        (a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)
      ),
    [db, dayStart]
  )

  const nameOf = (s: SessionRow) => personName(directory?.userById.get(s.userId), locale) || s.userId
  const userOf = (s: SessionRow) => directory?.userById.get(s.userId)

  const columns: ListColumn<SessionRow>[] = [
    {
      id: "user",
      header: t("sac.sessions.columns.user"),
      cell: (s) => {
        const user = userOf(s)
        return (
          <Link href={`/sac/users/${s.userId}`} className="flex min-w-0 items-center gap-2.5">
            {user ? <UserAvatar user={user} role={directory?.rolesByUser.get(user.id)?.[0]?.code} size={30} /> : null}
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{nameOf(s)}</span>
                {s.id === mine ? <StatusPill tone="primary">{t("sac.common.thisWindow")}</StatusPill> : null}
              </span>
              <Mono className="block truncate text-muted-foreground">{user?.username}</Mono>
            </span>
          </Link>
        )
      },
    },
    {
      id: "location",
      header: t("sac.sessions.columns.location"),
      hideBelow: "sm",
      cell: (s) => <span className="whitespace-nowrap">{locationName(s.locationId, locale)}</span>,
    },
    {
      id: "method",
      header: t("sac.sessions.columns.method"),
      hideBelow: "lg",
      cell: (s) => <span className="text-muted-foreground">{tk(`sac.sessions.method.${s.method}`)}</span>,
    },
    {
      id: "window",
      header: t("sac.sessions.columns.window"),
      hideBelow: "xl",
      cell: (s) => <Mono className="text-muted-foreground">{s.windowId}</Mono>,
    },
    {
      id: "started",
      header: t("sac.sessions.columns.started"),
      hideBelow: "md",
      cell: (s) => <DateText value={s.startedAt} variant="dmyTime" />,
    },
    {
      id: "idle",
      header: t("sac.sessions.columns.idle"),
      align: "right",
      cell: (s) => (
        <span className="text-muted-foreground">
          {t("sac.common.minutes", { count: num(Math.max(0, Math.floor((wall - s.lastActivityRealAt) / 60_000))) })}
        </span>
      ),
    },
    {
      id: "action",
      header: "",
      align: "right",
      cell: (s) =>
        canEnd && s.id !== mine ? (
          <Button variant="destructive-outline" size="xs" onClick={() => setTarget(s)} data-testid="session-end">
            <LogOut />
            {t("sac.sessions.end")}
          </Button>
        ) : s.id === mine ? (
          <span className="text-xs text-muted-foreground" title={t("sac.sessions.ownHint")}>
            {t("sac.common.you")}
          </span>
        ) : null,
    },
  ]

  const endedColumns: ListColumn<SessionRow>[] = [
    { id: "user", header: t("sac.sessions.columns.user"), cell: (s) => <span className="font-medium">{nameOf(s)}</span> },
    {
      id: "location",
      header: t("sac.sessions.columns.location"),
      hideBelow: "sm",
      cell: (s) => locationName(s.locationId, locale),
    },
    {
      id: "started",
      header: t("sac.sessions.columns.started"),
      hideBelow: "md",
      cell: (s) => <DateText value={s.startedAt} variant="dmyTime" />,
    },
    {
      id: "ended",
      header: t("sac.sessions.columns.reason"),
      cell: (s) => (
        <span className="flex flex-wrap items-center gap-x-2">
          <StatusText tone={s.endedReason === "forced" ? "warning" : "muted"}>
            {tk(`sac.sessions.endedReason.${s.endedReason ?? "sign-out"}`)}
          </StatusText>
          {s.endedAt ? <DateText value={s.endedAt} variant="time" className="text-muted-foreground" /> : null}
        </span>
      ),
    },
  ]

  const confirm = async (reason: string) => {
    if (!target) return
    const result = await end.run({ sessionId: target.id, reason: reason || undefined })
    if (result) toast.success(t("sac.sessions.endedToast", { name: nameOf(target) }))
    setTarget(null)
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("sac.sessions.title")} subtitle={t("sac.sessions.subtitle")} />
      <SectionCard
        title={t("sac.sessions.title")}
        icon={MonitorSmartphone}
        size="sm"
        action={<StatusPill tone="success">{num(open?.length ?? 0)}</StatusPill>}
      >
        <p className="mb-3 text-xs text-muted-foreground">{t("sac.sessions.idleNote")}</p>
        <ListTable
          rows={open}
          columns={columns}
          rowKey={(s) => s.id}
          rowProps={(s) => ({
            "data-testid": "session-row",
            "data-username": userOf(s)?.username,
            "data-own": s.id === mine ? "true" : "false",
          })}
          empty={<p className="py-8 text-center text-sm text-muted-foreground">{t("sac.sessions.empty")}</p>}
        />
      </SectionCard>
      <SectionCard title={t("sac.sessions.recent")} size="sm">
        <ListTable
          rows={ended}
          columns={endedColumns}
          rowKey={(s) => s.id}
          dense
          pageSize={20}
          rowProps={(s) => ({ "data-testid": "session-ended-row", "data-username": userOf(s)?.username })}
          empty={<p className="py-6 text-center text-sm text-muted-foreground">{t("sac.sessions.recentEmpty")}</p>}
        />
      </SectionCard>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={target ? t("sac.sessions.endTitle", { name: nameOf(target) }) : ""}
        description={t("sac.sessions.endBody")}
        confirmLabel={t("sac.sessions.endConfirm")}
        destructive
        withReason
        pending={end.pending}
        onConfirm={confirm}
        testId="session-end-dialog"
      />
    </div>
  )
}
