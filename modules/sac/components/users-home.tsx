"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Lock, LockOpen, MonitorSmartphone, Plus, ShieldAlert, Users } from "lucide-react"
import { toast } from "sonner"

import { locations } from "@/config/brand.config"
import { DateText } from "@/components/shared/date-text"
import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { PageHeader } from "@/components/shared/page-header"
import { StatusText } from "@/components/shared/status"
import { UserAvatar } from "@/components/shared/avatars"
import { TableSearch } from "@/components/motion/data-table"
import { Button } from "@/components/ui/button"
import { startOfDhakaDay, dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import type { UserRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { searchKey } from "@/components/shared/pickers"
import { useLocale } from "@/lib/i18n/provider"

import { unlockUser } from "../commands"
import {
  USER_STATUS_TONE,
  locationName,
  personName,
  roleName,
  useLoginEventsSince,
  useOpenSessions,
  useUserDirectory,
} from "../queries"
import { ListTable, Mono, OptionSelect, type ListColumn } from "./kit"
import { TempPasswordDialog } from "./temp-password-dialog"
import { UserFormDialog } from "./user-form-dialog"

/** /sac: the users list with sign-in status, lockouts and quick unlock (plan §9). */
export function UsersHome() {
  const { t, tk, num, locale } = useLocale()
  const router = useRouter()
  const directory = useUserDirectory()
  const sessions = useOpenSessions()
  const nowMs = useNow(60_000)
  const dayStart = nowMs ? startOfDhakaDay(dhakaDate(nowMs)) : null
  const today = useLoginEventsSince(dayStart)
  const canCreate = useCan("sac.user.create")
  const canEdit = useCan("sac.user.edit")
  const unlock = useCommand(unlockUser)

  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [role, setRole] = React.useState("all")
  const [location, setLocation] = React.useState("all")
  const [creating, setCreating] = React.useState(false)
  const [temp, setTemp] = React.useState<{ name: string; password: string } | null>(null)

  const users = directory?.users
  const rows = React.useMemo(() => {
    if (!directory) return undefined
    const q = searchKey(query)
    return directory.users.filter((u) => {
      if (status !== "all" && u.status !== status) return false
      if (location !== "all" && !u.locationIds.includes(location)) return false
      if (role !== "all" && !(directory.rolesByUser.get(u.id) ?? []).some((r) => r.id === role)) return false
      if (!q) return true
      return searchKey(`${u.nameEn} ${u.nameBn} ${u.username} ${u.phone} ${u.employeeNo}`).includes(q)
    })
  }, [directory, query, status, role, location])

  const openCount = new Set((sessions ?? []).map((s) => s.userId)).size
  const failedToday = (today ?? []).filter((e) => e.result !== "success").length

  const doUnlock = async (user: UserRow) => {
    const result = await unlock.run({ userId: user.id, expectedVersion: user.version })
    if (result) toast.success(t("sac.users.unlocked", { name: personName(user, locale) }))
  }

  const columns: ListColumn<UserRow>[] = [
    {
      id: "user",
      header: t("sac.users.columns.user"),
      cell: (u) => (
        <Link href={`/sac/users/${u.id}`} className="flex min-w-0 items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
          <UserAvatar user={u} role={directory?.rolesByUser.get(u.id)?.[0]?.code} size={32} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{personName(u, locale)}</span>
            <Mono className="block truncate text-muted-foreground">{u.username}</Mono>
          </span>
        </Link>
      ),
    },
    {
      id: "roles",
      header: t("sac.users.columns.roles"),
      hideBelow: "sm",
      cell: (u) => {
        const list = directory?.rolesByUser.get(u.id) ?? []
        return list.length ? (
          <span className="flex flex-wrap gap-1">
            {list.map((r) => (
              <span key={r.id} className="rounded-full bg-surface-raised px-2 py-0.5 text-xs whitespace-nowrap">
                {roleName(r, locale)}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t("sac.common.noRoles")}</span>
        )
      },
    },
    {
      id: "home",
      header: t("sac.users.columns.home"),
      hideBelow: "lg",
      cell: (u) => <span className="whitespace-nowrap">{locationName(u.homeLocationId, locale)}</span>,
    },
    {
      id: "status",
      header: t("sac.users.columns.status"),
      cell: (u) => (
        <StatusText tone={USER_STATUS_TONE[u.status]} dot data-testid="user-status">
          {tk(`sac.status.${u.status}`)}
        </StatusText>
      ),
    },
    {
      id: "last",
      header: t("sac.users.columns.lastLogin"),
      hideBelow: "md",
      cell: (u) =>
        u.lastLoginAt ? (
          <DateText value={u.lastLoginAt} variant="dmyTime" className="text-muted-foreground" />
        ) : (
          <span className="text-muted-foreground">{t("sac.common.never")}</span>
        ),
    },
    {
      id: "failed",
      header: t("sac.users.columns.failed"),
      align: "right",
      hideBelow: "xl",
      cell: (u) => <span className={u.failedAttempts ? "text-warning" : "text-muted-foreground"}>{num(u.failedAttempts)}</span>,
    },
    {
      id: "mfa",
      header: t("sac.users.columns.mfa"),
      hideBelow: "xl",
      cell: (u) => (
        <span className={u.mfaEnabled ? "text-success" : "text-muted-foreground"}>
          {u.mfaEnabled ? t("sac.common.on") : t("sac.common.off")}
        </span>
      ),
    },
    {
      id: "action",
      header: "",
      align: "right",
      cell: (u) =>
        u.status === "locked" && canEdit ? (
          <Button
            variant="outline"
            size="xs"
            onClick={(e) => {
              e.stopPropagation()
              void doUnlock(u)
            }}
            disabled={unlock.pending}
            data-testid="user-unlock"
          >
            <LockOpen />
            {t("sac.users.unlock")}
          </Button>
        ) : (
          <Link href={`/sac/users/${u.id}`} className="text-[0.8125rem] font-medium text-link hover:underline" onClick={(e) => e.stopPropagation()}>
            {t("sac.users.open")}
          </Link>
        ),
    },
  ]

  const total = users?.length ?? 0
  const active = users?.filter((u) => u.status === "active").length ?? 0
  const locked = users?.filter((u) => u.status === "locked").length ?? 0

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("sac.users.title")}
        subtitle={t("sac.users.subtitle")}
        actions={
          canCreate ? (
            <Button onClick={() => setCreating(true)} data-testid="user-new">
              <Plus />
              {t("sac.users.new")}
            </Button>
          ) : null
        }
      />
      <KpiGrid>
        <KpiCard
          variant="cyan"
          icon={Users}
          title={t("sac.users.kpi.active")}
          value={num(active)}
          caption={t("sac.users.kpi.activeCaption", { count: num(total) })}
        />
        <KpiCard
          variant="pink"
          icon={Lock}
          title={t("sac.users.kpi.locked")}
          value={num(locked)}
          caption={t("sac.users.kpi.lockedCaption")}
          onClick={() => setStatus("locked")}
        />
        <KpiCard
          variant="yellow"
          icon={MonitorSmartphone}
          title={t("sac.users.kpi.sessions")}
          value={num(openCount)}
          caption={t("sac.users.kpi.sessionsCaption")}
          href="/sac/sessions"
        />
        <KpiCard
          variant="purple"
          icon={ShieldAlert}
          title={t("sac.users.kpi.failed")}
          value={num(failedToday)}
          caption={t("sac.users.kpi.failedCaption")}
          href="/sac/login-history"
        />
      </KpiGrid>

      <section className="surface-card flex min-w-0 flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <TableSearch value={query} onChange={setQuery} placeholder={t("sac.users.search")} />
          <OptionSelect
            value={status}
            onChange={setStatus}
            label={t("sac.users.columns.status")}
            testId="user-filter-status"
            options={[
              { value: "all", label: t("sac.common.allStatuses") },
              ...(["active", "locked", "disabled"] as const).map((s) => ({ value: s, label: t(`sac.status.${s}`) })),
            ]}
          />
          <OptionSelect
            value={role}
            onChange={setRole}
            label={t("sac.users.columns.roles")}
            options={[
              { value: "all", label: t("sac.common.allRoles") },
              ...(directory?.roles ?? []).map((r) => ({ value: r.id, label: roleName(r, locale) })),
            ]}
          />
          <OptionSelect
            value={location}
            onChange={setLocation}
            label={t("sac.users.columns.home")}
            options={[
              { value: "all", label: t("sac.common.allLocations") },
              ...locations.map((l) => ({ value: l.id, label: l.name[locale] })),
            ]}
          />
        </div>
        <ListTable
          rows={rows}
          columns={columns}
          rowKey={(u) => u.id}
          rowProps={(u) => ({ "data-testid": "user-row", "data-username": u.username, "data-status": u.status })}
          onRowClick={(u) => router.push(`/sac/users/${u.id}`)}
          empty={<p className="py-8 text-center text-sm text-muted-foreground">{t("sac.users.empty")}</p>}
        />
      </section>

      <UserFormDialog
        open={creating}
        onOpenChange={setCreating}
        user={null}
        onCreated={(created) => setTemp({ name: created.name, password: created.tempPassword })}
      />
      <TempPasswordDialog value={temp} onClose={() => setTemp(null)} />
    </div>
  )
}
