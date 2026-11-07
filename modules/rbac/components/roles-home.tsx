"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { KeyRound, Plus, ShieldAlert, ShieldCheck, Users } from "lucide-react"

import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill, StatusText } from "@/components/shared/status"
import { TableSearch } from "@/components/motion/data-table"
import { Button } from "@/components/ui/button"
import type { RoleRow } from "@/core/db/schema"
import { PERMISSION_BY_KEY } from "@/core/security/registry"
import { useCan } from "@/core/security/useCan"
import { searchKey } from "@/components/shared/pickers"
import { useLocale } from "@/lib/i18n/provider"
import { ListTable, Mono, type ListColumn } from "@/modules/sac/components/kit"
import { roleName } from "@/modules/sac/queries"

import { keySets, useRbacData } from "../queries"
import { conflictsReport } from "../sod"
import { RoleFormDialog } from "./role-form-dialog"

/** /rbac: the roles, with users, permissions and approve keys per role (plan §9). */
export function RolesHome() {
  const { t, num, locale } = useLocale()
  const router = useRouter()
  const data = useRbacData()
  const canEdit = useCan("rbac.role.edit")
  const [query, setQuery] = React.useState("")
  const [creating, setCreating] = React.useState(false)

  const rows = React.useMemo(() => {
    if (!data) return undefined
    const q = searchKey(query)
    return data.roles.filter((r) => !q || searchKey(`${r.code} ${r.nameEn} ${r.nameBn}`).includes(q))
  }, [data, query])

  const conflicts = React.useMemo(
    () =>
      data
        ? conflictsReport({
            rules: data.rules,
            roles: data.roles,
            keysByRole: keySets(data),
            rolesByUser: data.rolesByUser,
          })
        : [],
    [data]
  )

  const columns: ListColumn<RoleRow>[] = [
    {
      id: "role",
      header: t("rbac.roles.columns.role"),
      cell: (r) => (
        <Link href={`/rbac/roles/${r.id}`} className="flex min-w-0 flex-col" onClick={(e) => e.stopPropagation()}>
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{roleName(r, locale)}</span>
            <StatusPill tone={r.isSystem ? "muted" : "primary"} className="h-5 px-2 text-[0.6875rem]">
              {r.isSystem ? t("rbac.common.system") : t("rbac.common.custom")}
            </StatusPill>
          </span>
          <Mono className="text-muted-foreground">{r.code}</Mono>
        </Link>
      ),
    },
    {
      id: "description",
      header: t("rbac.roles.columns.description"),
      hideBelow: "xl",
      className: "max-w-[28rem] whitespace-normal text-muted-foreground",
      cell: (r) => (locale === "bn" ? r.descriptionBn || r.descriptionEn : r.descriptionEn),
    },
    {
      id: "users",
      header: t("rbac.roles.columns.users"),
      align: "right",
      cell: (r) => num(data?.usersByRole.get(r.id)?.length ?? 0),
    },
    {
      id: "keys",
      header: t("rbac.roles.columns.keys"),
      align: "right",
      hideBelow: "sm",
      cell: (r) => num(data?.grantsByRole.get(r.id)?.size ?? 0),
    },
    {
      id: "approves",
      header: t("rbac.roles.columns.approves"),
      align: "right",
      hideBelow: "md",
      cell: (r) =>
        num([...(data?.grantsByRole.get(r.id)?.keys() ?? [])].filter((k) => PERMISSION_BY_KEY.get(k)?.column === "approve").length),
    },
    {
      id: "status",
      header: t("rbac.roles.columns.status"),
      cell: (r) => (
        <StatusText tone={r.active ? "success" : "muted"} dot>
          {r.active ? t("rbac.common.active") : t("rbac.common.inactive")}
        </StatusText>
      ),
    },
    {
      id: "open",
      header: "",
      align: "right",
      cell: (r) => (
        <Link href={`/rbac/roles/${r.id}`} className="text-[0.8125rem] font-medium text-link hover:underline" onClick={(e) => e.stopPropagation()}>
          {t("rbac.roles.open")}
        </Link>
      ),
    },
  ]

  const activeRoles = data?.roles.filter((r) => r.active) ?? []
  const custom = data?.roles.filter((r) => !r.isSystem).length ?? 0
  const usersWithRoles = data ? data.users.filter((u) => (data.rolesByUser.get(u.id) ?? []).length > 0).length : 0

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("rbac.roles.title")}
        subtitle={t("rbac.roles.subtitle")}
        actions={
          canEdit ? (
            <Button onClick={() => setCreating(true)} data-testid="role-new">
              <Plus />
              {t("rbac.roles.new")}
            </Button>
          ) : null
        }
      />
      <KpiGrid>
        <KpiCard
          variant="cyan"
          icon={ShieldCheck}
          title={t("rbac.roles.kpi.roles")}
          value={num(activeRoles.length)}
          caption={t("rbac.roles.kpi.rolesCaption", { count: num(custom) })}
        />
        <KpiCard
          variant="yellow"
          icon={KeyRound}
          title={t("rbac.roles.kpi.grants")}
          value={num(data?.rolePermissions.length ?? 0)}
          caption={t("rbac.roles.kpi.grantsCaption")}
          href="/rbac/effective"
        />
        <KpiCard
          variant="pink"
          icon={Users}
          title={t("rbac.roles.kpi.users")}
          value={num(usersWithRoles)}
          caption={t("rbac.roles.kpi.usersCaption", { count: num(data?.users.length ?? 0) })}
          href="/rbac/assignments"
        />
        <KpiCard
          variant="purple"
          icon={ShieldAlert}
          title={t("rbac.roles.kpi.conflicts")}
          value={num(conflicts.length)}
          caption={t("rbac.roles.kpi.conflictsCaption")}
          href="/rbac/sod"
        />
      </KpiGrid>
      <section className="surface-card flex min-w-0 flex-col gap-4 p-4 md:p-5">
        <TableSearch value={query} onChange={setQuery} placeholder={t("rbac.roles.search")} />
        <ListTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          rowProps={(r) => ({ "data-testid": "role-row", "data-code": r.code })}
          onRowClick={(r) => router.push(`/rbac/roles/${r.id}`)}
          empty={<p className="py-8 text-center text-sm text-muted-foreground">{t("rbac.roles.empty")}</p>}
        />
      </section>
      <RoleFormDialog open={creating} onOpenChange={setCreating} role={null} roles={data?.roles ?? []} />
    </div>
  )
}
