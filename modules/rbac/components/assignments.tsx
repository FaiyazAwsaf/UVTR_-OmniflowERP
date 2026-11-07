"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Plus, TriangleAlert, X } from "lucide-react"
import { toast } from "sonner"

import { locations } from "@/config/brand.config"
import { PageHeader } from "@/components/shared/page-header"
import { StatusPill } from "@/components/shared/status"
import { UserAvatar } from "@/components/shared/avatars"
import { TableSearch } from "@/components/motion/data-table"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { RoleRow, UserRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { useSession } from "@/core/session/session"
import { searchKey } from "@/components/shared/pickers"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { ListTable, Mono, OptionSelect, type ListColumn } from "@/modules/sac/components/kit"
import { locationName, personName, roleName } from "@/modules/sac/queries"

import { assignRole } from "../commands"
import { keySets, useRbacData } from "../queries"
import { keysOfRoles, sodHits } from "../sod"

/**
 * /rbac/assignments: who holds which role (`rbac.assignRole`). Nobody changes
 * their own roles; a block-mode SoD rule refuses an assignment, a warn rule
 * flags it.
 */
export function Assignments() {
  const { t, locale } = useLocale()
  const params = useSearchParams()
  const data = useRbacData()
  const { userId: me } = useSession()
  const canEdit = useCan("rbac.assign.edit")
  const command = useCommand(assignRole)
  const [query, setQuery] = React.useState(params.get("user") ?? "")
  const [role, setRole] = React.useState("all")
  const [location, setLocation] = React.useState("all")

  const keys = React.useMemo(() => (data ? keySets(data) : new Map<string, Set<string>>()), [data])
  const active = React.useMemo(() => new Set((data?.roles ?? []).filter((r) => r.active).map((r) => r.id)), [data])

  const rows = React.useMemo(() => {
    if (!data) return undefined
    const q = searchKey(query)
    return data.users.filter((u) => {
      if (location !== "all" && !u.locationIds.includes(location)) return false
      if (role !== "all" && !(data.rolesByUser.get(u.id) ?? []).includes(role)) return false
      return !q || searchKey(`${u.nameEn} ${u.nameBn} ${u.username}`).includes(q)
    })
  }, [data, query, role, location])

  const change = async (user: UserRow, target: RoleRow, assign: boolean) => {
    const result = await command.run({ userId: user.id, roleId: target.id, assign })
    if (!result) return
    const params = { role: roleName(target, locale), user: personName(user, locale) }
    if (result.changed) toast.success(t(assign ? "rbac.assignments.assigned" : "rbac.assignments.removed", params))
    if (result.flagged.length) toast.warning(t("rbac.matrix.flagged", { rules: result.flagged.join(", ") }))
  }

  const columns: ListColumn<UserRow>[] = [
    {
      id: "user",
      header: t("rbac.assignments.columns.user"),
      cell: (u) => (
        <Link href={`/sac/users/${u.id}`} className="flex min-w-0 items-center gap-2.5">
          <UserAvatar user={u} role={data?.roleById.get(data.rolesByUser.get(u.id)?.[0] ?? "")?.code} size={30} />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{personName(u, locale)}</span>
              {u.id === me ? <StatusPill tone="primary">{t("rbac.common.you")}</StatusPill> : null}
            </span>
            <Mono className="block truncate text-muted-foreground">{u.username}</Mono>
          </span>
        </Link>
      ),
    },
    {
      id: "home",
      header: t("rbac.assignments.columns.home"),
      hideBelow: "lg",
      cell: (u) => <span className="whitespace-nowrap">{locationName(u.homeLocationId, locale)}</span>,
    },
    {
      id: "roles",
      header: t("rbac.assignments.columns.roles"),
      className: "whitespace-normal py-2",
      cell: (u) => {
        const held = (data?.rolesByUser.get(u.id) ?? []).map((id) => data?.roleById.get(id)).filter((r) => !!r)
        const editable = canEdit && u.id !== me
        const available = (data?.roles ?? []).filter((r) => r.active && !held.some((h) => h.id === r.id))
        return (
          <span className="flex flex-wrap items-center gap-1.5" title={u.id === me ? t("rbac.assignments.own") : undefined}>
            {held.length === 0 ? <span className="text-xs text-muted-foreground">{t("rbac.assignments.none")}</span> : null}
            {held.map((r) => (
              <span
                key={r.id}
                data-testid="assignment-role"
                data-role={r.code}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-full bg-surface-raised pr-1 pl-2.5 text-xs",
                  !r.active && "opacity-60",
                  !editable && "pr-2.5"
                )}
              >
                <Link href={`/rbac/roles/${r.id}`} className="hover:underline">
                  {roleName(r, locale)}
                </Link>
                {editable ? (
                  <button
                    type="button"
                    onClick={() => void change(u, r, false)}
                    disabled={command.pending}
                    aria-label={t("rbac.assignments.remove", { role: roleName(r, locale) })}
                    data-testid="assignment-remove"
                    data-role={r.code}
                    className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </span>
            ))}
            {editable && available.length ? (
              <Popover>
                <PopoverTrigger
                  data-testid="assignment-add"
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-primary/60 px-2.5 text-xs font-medium text-link outline-none hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <Plus className="size-3" />
                  {t("rbac.assignments.add")}
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 gap-1 p-1.5">
                  {available.map((r) => {
                    const projected = keysOfRoles([...held.map((h) => h.id), r.id], keys, active)
                    const hits = sodHits(projected, data?.rules ?? []).filter(
                      (h) => !sodHits(keysOfRoles(held.map((x) => x.id), keys, active), data?.rules ?? []).some((b) => b.rule.code === h.rule.code)
                    )
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => void change(u, r, true)}
                        disabled={command.pending}
                        data-testid="assignment-role-option"
                        data-role={r.code}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.8125rem] hover:bg-surface-raised"
                      >
                        <span className="min-w-0 flex-1 truncate">{roleName(r, locale)}</span>
                        {hits.length ? (
                          <span
                            className={cn("flex items-center gap-1 text-[0.6875rem]", hits.some((h) => h.rule.mode === "block") ? "text-destructive" : "text-warning")}
                            title={hits.map((h) => h.rule.code).join(", ")}
                          >
                            <TriangleAlert className="size-3" />
                            {hits.map((h) => h.rule.code).join(", ")}
                          </span>
                        ) : (
                          <Mono className="text-muted-foreground">{r.code}</Mono>
                        )}
                      </button>
                    )
                  })}
                </PopoverContent>
              </Popover>
            ) : null}
          </span>
        )
      },
    },
    {
      id: "sod",
      header: t("rbac.assignments.columns.sod"),
      hideBelow: "md",
      cell: (u) => {
        const held = data?.rolesByUser.get(u.id) ?? []
        if (held.length < 2) return null
        const hits = sodHits(keysOfRoles(held, keys, active), data?.rules ?? [])
        const own = new Set(held.flatMap((id) => sodHits(keys.get(id) ?? [], data?.rules ?? []).map((h) => h.rule.code)))
        const combined = hits.filter((h) => !own.has(h.rule.code))
        return combined.length ? (
          <span className="flex items-center gap-1 text-xs text-warning" title={t("rbac.assignments.conflict", { rules: combined.map((h) => h.rule.code).join(", ") })}>
            <TriangleAlert className="size-3.5" />
            {combined.map((h) => h.rule.code).join(", ")}
          </span>
        ) : null
      },
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("rbac.assignments.title")} subtitle={t("rbac.assignments.subtitle")} />
      <section className="surface-card flex min-w-0 flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <TableSearch value={query} onChange={setQuery} placeholder={t("rbac.assignments.search")} />
          <OptionSelect
            value={role}
            onChange={setRole}
            label={t("rbac.assignments.columns.roles")}
            options={[
              { value: "all", label: t("rbac.common.allRoles") },
              ...(data?.roles ?? []).map((r) => ({ value: r.id, label: roleName(r, locale) })),
            ]}
          />
          <OptionSelect
            value={location}
            onChange={setLocation}
            label={t("rbac.assignments.columns.home")}
            options={[
              { value: "all", label: t("rbac.common.allLocations") },
              ...locations.map((l) => ({ value: l.id, label: l.name[locale] })),
            ]}
          />
        </div>
        <ListTable
          rows={rows}
          columns={columns}
          rowKey={(u) => u.id}
          rowProps={(u) => ({ "data-testid": "assignment-row", "data-username": u.username, "data-own": u.id === me ? "true" : "false" })}
          empty={<p className="py-8 text-center text-sm text-muted-foreground">{t("rbac.assignments.empty")}</p>}
        />
      </section>
    </div>
  )
}
