"use client"

import * as React from "react"
import Link from "next/link"
import { Gauge, Lock, Pencil, ShieldCheck, ShieldQuestion, Users } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { SectionCard } from "@/components/shared/section-card"
import { StatusPill, StatusText } from "@/components/shared/status"
import { UserAvatar } from "@/components/shared/avatars"
import { Button } from "@/components/ui/button"
import type { Id } from "@/core/db/schema"
import { APPROVAL_KINDS } from "@/core/security/types"
import { usePermissions } from "@/core/security/useCan"
import { useLocale } from "@/lib/i18n/provider"
import { Mono } from "@/modules/sac/components/kit"
import { personName, roleName } from "@/modules/sac/queries"

import { useRbacFormat } from "../format"
import { useRbacData } from "../queries"
import { PermissionMatrix } from "./permission-matrix"
import { RoleFormDialog } from "./role-form-dialog"

/** /rbac/roles/[id]: the role, who holds it, its limits, and the permission matrix. */
export function RoleDetail({ roleId }: { roleId: Id }) {
  const { t, tk, num, locale } = useLocale()
  const data = useRbacData()
  const { can, security } = usePermissions()
  const { limitText } = useRbacFormat()
  const [editing, setEditing] = React.useState(false)

  const role = data?.roleById.get(roleId)
  if (data && !role) {
    return <EmptyState icon={ShieldQuestion} title={t("rbac.role.notFound")} action={{ label: t("rbac.role.back"), href: "/rbac" }} />
  }
  if (!data || !role) return <p className="py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</p>

  const holds = !!security?.roleIds.includes(role.id)
  const canEdit = can("rbac.role.edit")
  const editable = canEdit && !holds
  const holders = (data.usersByRole.get(role.id) ?? []).map((id) => data.userById.get(id)).filter((u) => !!u)
  const limits = data.limits.filter((l) => l.roleId === role.id)

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="role-detail" data-code={role.code}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="truncate text-[1.375rem] leading-tight font-semibold">{roleName(role, locale)}</h1>
            <Mono className="rounded-full bg-surface-raised px-2 py-0.5">{role.code}</Mono>
            <StatusPill tone={role.isSystem ? "muted" : "primary"}>
              {role.isSystem ? t("rbac.common.system") : t("rbac.common.custom")}
            </StatusPill>
            <StatusText tone={role.active ? "success" : "muted"} dot>
              {role.active ? t("rbac.common.active") : t("rbac.common.inactive")}
            </StatusText>
          </div>
          <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">
            {locale === "bn" ? role.descriptionBn || role.descriptionEn : role.descriptionEn}
          </p>
        </div>
        {editable ? (
          <Button variant="outline" onClick={() => setEditing(true)} data-testid="role-edit">
            <Pencil />
            {t("rbac.role.edit")}
          </Button>
        ) : null}
      </header>

      {holds || !canEdit ? (
        <p className="flex items-center gap-2 rounded-md bg-surface-raised px-4 py-3 text-sm text-muted-foreground" data-testid="matrix-readonly">
          <Lock className="size-4" />
          {holds ? t("rbac.common.readOnlyOwn") : t("rbac.common.readOnlyPerm", { permission: "rbac.role.edit" })}
        </p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          title={t("rbac.role.holders")}
          icon={Users}
          size="sm"
          action={<StatusPill tone="muted">{num(holders.length)}</StatusPill>}
          seeAllHref="/rbac/assignments"
        >
          {holders.length ? (
            <ul className="flex flex-wrap gap-2" data-testid="role-holders">
              {holders.map((u) => (
                <li key={u.id}>
                  <Link
                    href={`/sac/users/${u.id}`}
                    className="flex items-center gap-2 rounded-full bg-surface-raised py-1 pr-3 pl-1 text-[0.8125rem] hover:bg-primary-soft"
                  >
                    <UserAvatar user={u} role={role.code} size={24} />
                    {personName(u, locale)}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("rbac.role.noHolders")}</p>
          )}
        </SectionCard>
        <SectionCard title={t("rbac.role.limits")} icon={Gauge} size="sm" seeAllHref="/rbac/limits" seeAllLabel={t("rbac.role.allLimits")}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[0.8125rem] @container sm:grid-cols-4">
            {APPROVAL_KINDS.map((kind) => {
              const value = limits.find((l) => l.kind === kind)?.value ?? 0
              return (
                <div key={kind} className="flex min-w-0 flex-col">
                  <dt className="truncate text-xs text-muted-foreground">{tk(`rbac.kinds.${kind}`)}</dt>
                  <dd className="nums truncate font-medium">{limitText(kind, value)}</dd>
                </div>
              )
            })}
          </dl>
        </SectionCard>
      </div>

      <SectionCard title={t("rbac.role.matrix")} subtitle={t("rbac.role.matrixHint")} icon={ShieldCheck} size="sm">
        <PermissionMatrix role={role} data={data} editable={editable} />
      </SectionCard>

      <RoleFormDialog open={editing} onOpenChange={setEditing} role={role} roles={data.roles} />
    </div>
  )
}
