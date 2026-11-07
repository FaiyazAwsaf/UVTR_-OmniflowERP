"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { History, KeyRound, LockOpen, MonitorSmartphone, Pencil, ShieldCheck, UserCheck, UserX, UserRoundSearch } from "lucide-react"
import { toast } from "sonner"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { KeyValueGrid } from "@/components/shared/key-value"
import { SectionCard } from "@/components/shared/section-card"
import { StatusPill, StatusText } from "@/components/shared/status"
import { UserAvatar } from "@/components/shared/avatars"
import { Button } from "@/components/ui/button"
import { useNow } from "@/core/clock/useNow"
import { readSetting } from "@/core/db/settings"
import { useDb } from "@/core/db/DbProvider"
import type { AuditRow, Id } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { useSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { resetPassword, setUserStatus, unlockUser } from "../commands"
import {
  LOGIN_RESULT_TONE,
  USER_STATUS_TONE,
  locationName,
  personName,
  roleName,
  useUserDirectory,
} from "../queries"
import { actorName } from "@/modules/demo/components/labels"

import { ConfirmDialog, Mono } from "./kit"
import { TempPasswordDialog } from "./temp-password-dialog"
import { UserFormDialog } from "./user-form-dialog"

type Pending = "reset" | "disable" | "enable" | "unlock" | null

/** /sac/users/[id]: profile, roles (link to RBAC), locations, sessions, login history and account changes. */
export function UserDetail({ userId }: { userId: Id }) {
  const { t, tk, num, locale } = useLocale()
  const db = useDb()
  const directory = useUserDirectory()
  const { userId: me } = useSession()
  const canEdit = useCan("sac.user.edit")
  const nowMs = useNow(60_000)
  const [editing, setEditing] = React.useState(false)
  const [pending, setPending] = React.useState<Pending>(null)
  const [temp, setTemp] = React.useState<{ name: string; password: string } | null>(null)
  const reset = useCommand(resetPassword)
  const status = useCommand(setUserStatus)
  const unlock = useCommand(unlockUser)

  const data = useLiveQuery(async () => {
    const [sessions, logins, audit, policy] = await Promise.all([
      db.sessions.where("userId").equals(userId).toArray(),
      db.loginEvents.where("userId").equals(userId).reverse().sortBy("at"),
      db.audit.where("entityId").equals(userId).reverse().sortBy("seq"),
      readSetting(db, "security"),
    ])
    sessions.sort((a, b) => b.startedAt - a.startedAt)
    return { sessions: sessions.slice(0, 12), logins: logins.slice(0, 15), audit: audit.slice(0, 12), policy }
  }, [db, userId])

  const user = directory?.userById.get(userId)
  if (directory && !user) {
    return (
      <EmptyState
        icon={UserRoundSearch}
        title={t("sac.user.notFound")}
        action={{ label: t("sac.user.back"), href: "/sac" }}
      />
    )
  }
  if (!user || !directory) return <p className="py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</p>

  const name = personName(user, locale)
  const roles = directory.rolesByUser.get(user.id) ?? []
  const own = user.id === me
  const ageDays = nowMs ? Math.floor((nowMs - user.passwordSetAt) / 86_400_000) : 0
  const expiry = data?.policy.passwordExpiryDays ?? 0

  const confirm = async (reason: string) => {
    if (pending === "reset") {
      const result = await reset.run({ userId: user.id, reason: reason || undefined })
      if (result) setTemp({ name, password: result.tempPassword })
    } else if (pending === "disable" || pending === "enable") {
      const result = await status.run({
        userId: user.id,
        status: pending === "disable" ? "disabled" : "active",
        reason: reason || undefined,
        expectedVersion: user.version,
      })
      if (result) {
        toast.success(t(pending === "disable" ? "sac.user.disabled" : "sac.user.enabled", { name }))
        if (result.sessionsEnded) toast.info(t("sac.user.sessionsEnded", { count: num(result.sessionsEnded) }))
      }
    } else if (pending === "unlock") {
      const result = await unlock.run({ userId: user.id, reason: reason || undefined, expectedVersion: user.version })
      if (result) toast.success(t("sac.users.unlocked", { name }))
    }
    setPending(null)
  }

  const dialog: Record<Exclude<Pending, null>, { title: string; body: string; confirm: string; destructive: boolean }> = {
    reset: {
      title: t("sac.user.resetTitle", { name }),
      body: t("sac.user.resetBody", { name }),
      confirm: t("sac.user.resetConfirm"),
      destructive: false,
    },
    disable: {
      title: t("sac.user.disableTitle", { name }),
      body: t("sac.user.disableBody", { name }),
      confirm: t("sac.user.disableConfirm"),
      destructive: true,
    },
    enable: {
      title: t("sac.user.enableTitle", { name }),
      body: t("sac.user.enableBody", { name }),
      confirm: t("sac.user.enableConfirm"),
      destructive: false,
    },
    unlock: {
      title: t("sac.user.unlockTitle", { name }),
      body: t("sac.user.unlockBody", { name }),
      confirm: t("sac.user.unlockConfirm"),
      destructive: false,
    },
  }

  return (
    <div className="flex flex-col gap-5" data-testid="user-detail" data-username={user.username}>
      <header className="surface-card flex flex-wrap items-start gap-4 p-5">
        <UserAvatar user={user} role={roles[0]?.code} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="truncate text-[1.375rem] leading-tight font-semibold">{name}</h1>
            <StatusText tone={USER_STATUS_TONE[user.status]} dot data-testid="user-status">
              {tk(`sac.status.${user.status}`)}
            </StatusText>
            {own ? <StatusPill tone="primary">{t("sac.common.you")}</StatusPill> : null}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <Mono>{user.username}</Mono>
            <span>·</span>
            <span>{locale === "bn" ? user.designationBn || user.designationEn : user.designationEn}</span>
            <span>·</span>
            <span>{locationName(user.homeLocationId, locale)}</span>
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            {user.status === "locked" ? (
              <Button onClick={() => setPending("unlock")} data-testid="user-unlock">
                <LockOpen />
                {t("sac.user.unlock")}
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setEditing(true)} data-testid="user-edit">
              <Pencil />
              {t("sac.user.edit")}
            </Button>
            <Button
              variant="neutral"
              onClick={() => setPending("reset")}
              disabled={own || user.status === "disabled"}
              data-testid="user-reset"
            >
              <KeyRound />
              {t("sac.user.reset")}
            </Button>
            {user.status === "disabled" ? (
              <Button variant="neutral" onClick={() => setPending("enable")} disabled={own} data-testid="user-disable" data-action="enable">
                <UserCheck />
                {t("sac.user.enable")}
              </Button>
            ) : (
              <Button
                variant="destructive-outline"
                onClick={() => setPending("disable")}
                disabled={own}
                data-testid="user-disable"
                data-action="disable"
              >
                <UserX />
                {t("sac.user.disable")}
              </Button>
            )}
          </div>
        ) : null}
      </header>

      {user.status === "locked" ? (
        <div role="status" className="rounded-md bg-destructive/12 px-4 py-3 text-sm text-destructive">
          {t("sac.user.lockedBanner", { count: num(user.failedAttempts), name })}
        </div>
      ) : user.status === "disabled" ? (
        <div role="status" className="rounded-md bg-surface-raised px-4 py-3 text-sm text-muted-foreground">
          {t("sac.user.disabledBanner", { name })}
        </div>
      ) : null}
      {user.mustChangePassword ? (
        <div role="status" className="rounded-md bg-info/12 px-4 py-3 text-sm text-info" data-testid="must-change">
          {t("sac.user.mustChange")}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionCard title={t("sac.user.profile")} icon={UserRoundSearch} size="sm">
          <KeyValueGrid
            columns={3}
            items={[
              { label: t("sac.user.employeeNo"), value: <Mono>{user.employeeNo || "-"}</Mono> },
              { label: t("sac.user.email"), value: <Mono>{user.email || "-"}</Mono> },
              { label: t("sac.user.phone"), value: <Mono>{user.phone || "-"}</Mono> },
              { label: t("sac.user.home"), value: locationName(user.homeLocationId, locale) },
              {
                label: t("sac.user.locations"),
                value: user.locationIds.map((id) => locationName(id, locale)).join(", "),
                wide: true,
              },
              {
                label: t("sac.user.mfa"),
                value: (
                  <span className={user.mfaEnabled ? "text-success" : "text-muted-foreground"}>
                    {user.mfaEnabled ? t("sac.common.on") : t("sac.common.off")}
                  </span>
                ),
              },
              {
                label: t("sac.user.passwordSet"),
                value: (
                  <span className={cn(expiry > 0 && ageDays > expiry && "text-warning")}>
                    {t("sac.user.passwordAge", { count: num(Math.max(0, ageDays)) })}
                  </span>
                ),
              },
              {
                label: t("sac.user.lastLogin"),
                value: user.lastLoginAt ? <DateText value={user.lastLoginAt} variant="dmyTime" /> : t("sac.common.never"),
              },
              { label: t("sac.user.failed"), value: num(user.failedAttempts) },
            ]}
          />
          {expiry > 0 && ageDays > expiry ? (
            <p className="mt-3 text-xs text-warning">{t("sac.user.passwordExpired", { count: num(expiry) })}</p>
          ) : null}
        </SectionCard>

        <SectionCard
          title={t("sac.user.roles")}
          icon={ShieldCheck}
          size="sm"
          seeAllHref={`/rbac/assignments?user=${user.username}`}
          seeAllLabel={t("sac.user.manageRoles")}
        >
          {roles.length ? (
            <ul className="flex flex-col divide-y divide-hairline" data-testid="user-roles">
              {roles.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  <Mono className="rounded-full bg-surface-raised px-2 py-0.5">{r.code}</Mono>
                  <Link href={`/rbac/roles/${r.id}`} className="min-w-0 flex-1 truncate font-medium text-link hover:underline">
                    {roleName(r, locale)}
                  </Link>
                  {!r.active ? <StatusText tone="muted">{t("sac.status.disabled")}</StatusText> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("sac.user.noRoles")}</p>
          )}
        </SectionCard>

        <SectionCard title={t("sac.user.sessions")} icon={MonitorSmartphone} size="sm" seeAllHref="/sac/sessions">
          {data?.sessions.length ? (
            <ul className="flex flex-col divide-y divide-hairline text-[0.8125rem]">
              {data.sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
                  <DateText value={s.startedAt} variant="dmyTime" />
                  <span className="text-muted-foreground">{locationName(s.locationId, locale)}</span>
                  <span className="text-muted-foreground">{tk(`sac.sessions.method.${s.method}`)}</span>
                  <span className="ml-auto">
                    {s.endedAt === undefined ? (
                      <StatusText tone="success" dot>
                        {t("sac.user.open")}
                      </StatusText>
                    ) : (
                      <StatusText tone="muted">{tk(`sac.sessions.endedReason.${s.endedReason ?? "sign-out"}`)}</StatusText>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("sac.user.noSessions")}</p>
          )}
        </SectionCard>

        <SectionCard
          title={t("sac.user.loginHistory")}
          icon={History}
          size="sm"
          seeAllHref={`/sac/login-history?user=${user.username}`}
        >
          {data?.logins.length ? (
            <ul className="flex flex-col divide-y divide-hairline text-[0.8125rem]">
              {data.logins.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2" data-testid="login-row" data-result={e.result}>
                  <DateText value={e.at} variant="dmyTime" />
                  <span className="text-muted-foreground">{tk(`sac.logins.method.${e.method}`)}</span>
                  <StatusText tone={LOGIN_RESULT_TONE[e.result]} className="ml-auto">
                    {tk(`reports.enum.loginResult.${e.result}`)}
                  </StatusText>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("sac.user.noLogins")}</p>
          )}
        </SectionCard>

        <SectionCard
          title={t("sac.user.activity")}
          icon={ShieldCheck}
          size="sm"
          className="xl:col-span-2"
          seeAllHref={`/sac/audit?record=${user.id}`}
        >
          {data?.audit.length ? <AccountChanges rows={data.audit} /> : <p className="text-sm text-muted-foreground">{t("sac.user.noActivity")}</p>}
        </SectionCard>
      </div>

      <UserFormDialog open={editing} onOpenChange={setEditing} user={user} />
      {pending ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title={dialog[pending].title}
          description={dialog[pending].body}
          confirmLabel={dialog[pending].confirm}
          destructive={dialog[pending].destructive}
          withReason
          pending={reset.pending || status.pending || unlock.pending}
          onConfirm={confirm}
          testId="user-confirm"
        />
      ) : null}
      <TempPasswordDialog value={temp} onClose={() => setTemp(null)} />
    </div>
  )
}

/** The account's audit rows: who changed what, old → new. */
function AccountChanges({ rows }: { rows: AuditRow[] }) {
  const { tk, locale } = useLocale()
  const hidden = new Set(["passwordHash"])
  return (
    <ul className="flex flex-col divide-y divide-hairline text-[0.8125rem]">
      {rows.map((row) => {
        const fields = Object.keys({ ...(row.before ?? {}), ...(row.after ?? {}) }).filter((f) => !hidden.has(f))
        return (
          <li key={row.seq} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
            <DateText value={row.at} variant="dmyTime" className="text-muted-foreground" />
            <span className="font-medium">
              {actorName(row.actor, locale, tk)}
            </span>
            <span>{tk(`sac.audit.actions.${row.action}`)}</span>
            <Mono className="text-muted-foreground">{row.command}</Mono>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {fields
                .slice(0, 4)
                .map((f) => {
                  const after = row.after?.[f]
                  return row.action === "update" ? `${f}: ${short(row.before?.[f])} → ${short(after)}` : f
                })
                .join(" · ")}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function short(value: unknown): string {
  if (value === undefined || value === null) return "∅"
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return text.length > 24 ? `${text.slice(0, 23)}…` : text
}
