"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { BookOpenText, LogOut, MonitorSmartphone, ShieldMinus, ShieldPlus, Wrench } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useDb } from "@/core/db/DbProvider"
import type { SessionRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { endSession } from "@/core/security/signin"
import { APP_CODES } from "@/core/security/types"
import { usePermissions } from "@/core/security/useCan"
import { nameOf, useRoles, useUserMap } from "@/core/security/users"
import { useSession } from "@/core/session/session"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { devPostTestJournal, devSetGrant } from "@/modules/demo/commands"
import { locationCode } from "@/modules/demo/components/labels"

import { SectionTitle } from "./section-title"

const APP_OPTIONS = [...APP_CODES, "dashboard"] as const

/**
 * Checkpoint 1 dev controls (plan §12 P1 "Accept when" items 3 and 4) in the
 * demo panel's Data tab, all real, permission-checked, audited commands:
 * revoke or grant a role's `<app>.app.view` (`demo.devSetGrant`, needs
 * rbac.role.edit) so the app disappears live from another window; force a
 * session to end (`sac.endSession`, needs sac.session.end) so that window
 * returns to /login with the notice; post a small balanced test voucher
 * (`demo.devPostTestJournal`, needs fa.journal.create) that appears live in
 * every window. Until the RBAC, SAC and FA screens exist, these stand in.
 */
export function DevControls() {
  const { t } = useLocale()
  return (
    <section className="flex flex-col gap-3" data-testid="demo-dev">
      <SectionTitle icon={Wrench} title={t("demo.dev.title")} hint={t("demo.dev.hint")} />
      <GrantToggle />
      <ActiveSessions />
      <TestJournal />
    </section>
  )
}

const TEST_JOURNAL_P = 100_00

function TestJournal() {
  const { t, money } = useLocale()
  const { can } = usePermissions()
  const allowed = can("fa.journal.create")
  const command = useCommand(devPostTestJournal)

  const post = async () => {
    const result = await command.run({ amountP: TEST_JOURNAL_P })
    if (result) toast.success(t("demo.dev.journalPosted", { no: result.journalNo }))
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-card p-3" data-testid="dev-journal">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <BookOpenText className="size-3.5 text-primary" />
        {t("demo.dev.journalTitle")}
      </p>
      <p className="text-[0.6875rem] text-muted-foreground">
        {t("demo.dev.journalHint", { amount: money(TEST_JOURNAL_P) })}
      </p>
      <Button
        size="sm"
        className="self-start"
        disabled={!allowed || command.pending}
        onClick={() => void post()}
        data-testid="dev-test-journal"
      >
        <BookOpenText />
        {t("demo.dev.journalPost")}
      </Button>
      {!allowed ? <p className="text-[0.6875rem] text-warning">{t("demo.dev.journalNeeds")}</p> : null}
    </div>
  )
}

function GrantToggle() {
  const { t, tk, locale } = useLocale()
  const db = useDb()
  const roles = useRoles()
  const { can } = usePermissions()
  const allowed = can("rbac.role.edit")
  const [roleId, setRoleId] = React.useState("role_advisor")
  const [app, setApp] = React.useState<string>("par")
  const permission = `${app}.app.view`
  const command = useCommand(devSetGrant)
  const role = roles?.find((r) => r.id === roleId)

  const grant = useLiveQuery(
    () => db.rolePermissions.where("[roleId+permission]").equals([roleId, permission]).first(),
    [db, roleId, permission]
  )
  const granted = !!grant

  const toggle = async () => {
    const result = await command.run({ roleId, permission, granted: !granted })
    if (result) {
      toast.success(
        t(granted ? "demo.dev.revoked" : "demo.dev.granted", {
          permission,
          role: nameOf(role, locale),
        })
      )
    }
  }

  const appLabel = (code: string) =>
    code === "dashboard" ? tk("dashboard.name") : `${code.toUpperCase()} ${tk(`${code}.name`)}`

  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-card p-3">
      <p className="text-xs font-medium">{t("demo.dev.grantTitle")}</p>
      <div className="grid grid-cols-2 gap-2">
        <Select value={roleId} onValueChange={(value) => value && setRoleId(value)}>
          <SelectTrigger size="sm" className="w-full min-w-0" aria-label={t("demo.dev.role")} data-testid="dev-grant-role">
            <SelectValue>{() => <span className="truncate">{nameOf(role, locale) || roleId}</span>}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} className="max-h-72">
            {(roles ?? []).map((r) => (
              <SelectItem key={r.id} value={r.id} data-testid={`dev-role-${r.code}`}>
                {nameOf(r, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={app} onValueChange={(value) => value && setApp(value)}>
          <SelectTrigger size="sm" className="w-full min-w-0" aria-label={t("demo.dev.app")} data-testid="dev-grant-app">
            <SelectValue>{() => <span className="truncate">{appLabel(app)}</span>}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} className="max-h-72">
            {APP_OPTIONS.map((code) => (
              <SelectItem key={code} value={code} data-testid={`dev-app-${code}`}>
                {appLabel(code)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span lang="en" className="font-mono text-[0.6875rem] text-muted-foreground">
          {permission}
        </span>
        <span
          className={cn("text-xs font-semibold", granted ? "text-success" : "text-muted-foreground")}
          data-testid="dev-grant-state"
          data-granted={granted}
        >
          {grant === undefined && !roles ? "" : granted ? t("demo.dev.isGranted") : t("demo.dev.notGranted")}
        </span>
        <Button
          size="sm"
          variant={granted ? "destructive" : "default"}
          className="ml-auto"
          disabled={!allowed || command.pending}
          onClick={() => void toggle()}
          data-testid="dev-grant-toggle"
          data-granted={granted}
        >
          {granted ? <ShieldMinus /> : <ShieldPlus />}
          {granted ? t("demo.dev.revoke") : t("demo.dev.grant")}
        </Button>
      </div>
      {!allowed ? <p className="text-[0.6875rem] text-warning">{t("demo.dev.needsAdmin")}</p> : null}
    </div>
  )
}

/** Live sessions, the latest per window (older ones in a window were replaced by a later sign-in). */
function useActiveSessions(): SessionRow[] | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const open = await db.sessions.filter((s) => s.endedAt === undefined).toArray()
    const latest = new Map<string, SessionRow>()
    for (const s of open) {
      const prev = latest.get(s.windowId)
      if (!prev || s.startedAt > prev.startedAt) latest.set(s.windowId, s)
    }
    return [...latest.values()].sort((a, b) => b.startedAt - a.startedAt)
  }, [db])
}

function ActiveSessions() {
  const { t, locale, relative } = useLocale()
  const sessions = useActiveSessions()
  const users = useUserMap()
  const { sessionId } = useSession()
  const { can } = usePermissions()
  const allowed = can("sac.session.end")
  const command = useCommand(endSession)

  const end = async (session: SessionRow) => {
    const result = await command.run({ sessionId: session.id, reason: t("demo.dev.forceReason") })
    if (result) {
      const user = users.get(session.userId)
      toast.success(t("demo.dev.forced", { name: user ? (locale === "bn" ? user.nameBn : user.nameEn) : session.userId }))
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-card p-3" data-testid="dev-sessions">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <MonitorSmartphone className="size-3.5 text-primary" />
        {t("demo.dev.sessionsTitle")}
      </p>
      {!sessions?.length ? (
        <p className="text-xs text-muted-foreground">{t("demo.dev.noSessions")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {sessions.map((session) => {
            const user = users.get(session.userId)
            const own = session.id === sessionId
            return (
              <li
                key={session.id}
                className="flex items-center gap-2 py-1.5"
                data-testid="dev-session"
                data-username={user?.username}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-medium">
                    {user ? (locale === "bn" ? user.nameBn : user.nameEn) : session.userId}
                  </span>
                  <span className="block truncate text-[0.6875rem] text-muted-foreground">
                    <span lang="en" className="font-mono">
                      {[user?.username, locationCode(session.locationId)].filter(Boolean).join(" · ")}
                    </span>
                    {" · "}
                    {session.method === "demo-quick" ? t("demo.dev.quick") : t("demo.dev.password")}
                    {" · "}
                    {relative(session.startedAt)}
                  </span>
                </span>
                {own ? (
                  <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[0.6875rem] font-medium text-link">
                    {t("demo.dev.thisWindow")}
                  </span>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    className="shrink-0 border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={!allowed || command.pending}
                    onClick={() => void end(session)}
                    data-testid="dev-force-signout"
                    data-username={user?.username}
                  >
                    <LogOut />
                    {t("demo.dev.forceSignOut")}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!allowed ? <p className="text-[0.6875rem] text-warning">{t("demo.dev.needsAdmin")}</p> : null}
    </div>
  )
}
