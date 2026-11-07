"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { CircleCheck, CircleX, Gauge, KeyRound, ShieldCheck } from "lucide-react"

import { locations } from "@/config/brand.config"
import { AppChip } from "@/components/shared/app-frame"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { SearchPicker, searchKey } from "@/components/shared/pickers"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText } from "@/components/shared/status"
import { UserAvatar } from "@/components/shared/avatars"
import { TableSearch } from "@/components/motion/data-table"
import type { UserRow } from "@/core/db/schema"
import { PERMISSIONS } from "@/core/security/registry"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { Field, Mono, OptionSelect } from "@/modules/sac/components/kit"
import { locationName, personName, roleName } from "@/modules/sac/queries"

import { explainPermission, limitSources } from "../effective"
import { useRbacFormat } from "../format"
import { MATRIX_APPS, appOfKey } from "../matrix"
import { useRbacData } from "../queries"

const KEYS = PERMISSIONS.map((p) => ({ key: p.key }))

/**
 * /rbac/effective: "why can or can't this user do this?" The user's roles,
 * the granting role and scope of a key, the location check, the account
 * status, and the approval limits with the role behind each, computed the
 * way the engine decides (core/security/resolve.ts).
 */
export function EffectiveScreen() {
  const { t, tk, num, locale } = useLocale()
  const params = useSearchParams()
  const data = useRbacData()
  const { keyLabel, appName, limitText } = useRbacFormat()
  const [userId, setUserId] = React.useState<string | null>(null)
  const [key, setKey] = React.useState<string | null>(params.get("key"))
  const [location, setLocation] = React.useState("any")
  const [filter, setFilter] = React.useState("")

  const wanted = params.get("user")
  const preset = wanted && data ? (data.users.find((u) => u.username === wanted)?.id ?? null) : null
  const selectedId = userId ?? preset
  const user = selectedId ? data?.userById.get(selectedId) : undefined
  const held = user ? (data?.rolesByUser.get(user.id) ?? []) : []

  const explanation =
    user && key && data
      ? explainPermission({
          user,
          heldRoleIds: held,
          roles: data.roles,
          rolePermissions: data.rolePermissions,
          key,
          locationId: location === "any" ? null : location,
        })
      : null
  const limits = user && data ? limitSources({ heldRoleIds: held, roles: data.roles, limits: data.limits }) : []

  const granted: { key: string; scope: "all" | "own-location"; roles: string[] }[] = []
  if (user && data) {
    const q = searchKey(filter)
    for (const p of PERMISSIONS) {
      const ex = explainPermission({ user, heldRoleIds: held, roles: data.roles, rolePermissions: data.rolePermissions, key: p.key })
      if (!ex.granted || !ex.scope) continue
      if (q && !searchKey(`${p.key} ${keyLabel(p.key)}`).includes(q)) continue
      granted.push({ key: p.key, scope: ex.scope, roles: ex.sources.map((s) => s.roleId) })
    }
  }

  const name = personName(user, locale)
  const roleNames = (ids: string[]) => ids.map((id) => roleName(data?.roleById.get(id), locale)).join(", ")

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("rbac.effective.title")} subtitle={t("rbac.effective.subtitle")} />
      <section className="surface-card grid gap-3 p-4 md:p-5 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_0.8fr]">
        <Field label={t("rbac.effective.user")}>
          <SearchPicker<UserRow>
            items={data?.users}
            value={selectedId}
            onChange={(id) => setUserId(id)}
            getId={(u) => u.id}
            searchText={(u) => `${u.nameEn} ${u.nameBn} ${u.username}`}
            renderValue={(u) => personName(u, locale)}
            renderItem={(u) => (
              <span className="flex items-center justify-between gap-2">
                {personName(u, locale)}
                <Mono className="text-muted-foreground">{u.username}</Mono>
              </span>
            )}
            placeholder={t("rbac.effective.pickUser")}
            testId="effective-user"
          />
        </Field>
        <Field label={t("rbac.effective.key")}>
          <SearchPicker
            items={KEYS}
            value={key}
            onChange={(id) => setKey(id)}
            getId={(i) => i.key}
            searchText={(i) => `${i.key} ${keyLabel(i.key)} ${appName(appOfKey(i.key))}`}
            renderValue={(i) => (
              <span className="flex items-center gap-2">
                <AppChip app={appOfKey(i.key)} />
                {keyLabel(i.key)}
              </span>
            )}
            renderItem={(i) => (
              <span className="flex items-center gap-2">
                <AppChip app={appOfKey(i.key)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{keyLabel(i.key)}</span>
                  <Mono className="block text-muted-foreground">{i.key}</Mono>
                </span>
              </span>
            )}
            placeholder={t("rbac.effective.pickKey")}
            testId="effective-key"
            limit={200}
          />
        </Field>
        <Field label={t("rbac.effective.location")}>
          <OptionSelect
            value={location}
            onChange={setLocation}
            label={t("rbac.effective.location")}
            className="w-full"
            testId="effective-location"
            options={[
              { value: "any", label: t("rbac.effective.anyLocation") },
              ...locations.map((l) => ({ value: l.id, label: l.name[locale] })),
            ]}
          />
        </Field>
      </section>

      {!user ? (
        <EmptyState icon={KeyRound} title={t("rbac.effective.empty")} />
      ) : (
        <>
          {explanation && key ? (
            <section
              className={cn(
                "surface-card flex flex-col gap-3 border-l-4 p-5",
                explanation.allowed ? "border-success" : "border-destructive"
              )}
              data-testid="effective-result"
              data-allowed={explanation.allowed ? "true" : "false"}
              data-key={key}
            >
              <p className={cn("flex items-start gap-2 text-[1.0625rem] font-semibold", explanation.allowed ? "text-success" : "text-destructive")}>
                {explanation.allowed ? <CircleCheck className="mt-0.5 size-5 shrink-0" /> : <CircleX className="mt-0.5 size-5 shrink-0" />}
                <span>{t(explanation.allowed ? "rbac.effective.yes" : "rbac.effective.no", { name, action: keyLabel(key) })}</span>
              </p>
              <Mono className="text-muted-foreground">{key}</Mono>
              <ul className="flex flex-col gap-1.5 text-[0.8125rem]">
                {explanation.sources.map((s) => (
                  <li key={s.roleId} className="flex items-center gap-2" data-testid="effective-source" data-role={data?.roleById.get(s.roleId)?.code}>
                    <ShieldCheck className="size-4 text-success" />
                    <Link href={`/rbac/roles/${s.roleId}`} className="hover:underline">
                      {t("rbac.effective.grantedBy", { role: roleName(data?.roleById.get(s.roleId), locale), scope: tk(`rbac.scope.${s.scope}`) })}
                    </Link>
                  </li>
                ))}
                {explanation.inactiveSources.map((s) => (
                  <li key={s.roleId} className="text-muted-foreground">
                    {t("rbac.effective.inactiveRole", { role: roleName(data?.roleById.get(s.roleId), locale) })}
                  </li>
                ))}
                {!explanation.granted ? (
                  <li>{held.length ? t("rbac.effective.notGranted", { name }) : t("rbac.effective.noRolesHeld", { name })}</li>
                ) : null}
                {explanation.inScope === false && explanation.granted ? (
                  <li className="text-destructive">
                    {t("rbac.effective.outOfScope", { location: locationName(location, locale), name })}
                  </li>
                ) : explanation.inScope === true ? (
                  <li className="text-muted-foreground">{t("rbac.effective.inScope", { location: locationName(location, locale) })}</li>
                ) : null}
                {explanation.granted && explanation.status === "locked" ? <li className="text-destructive">{t("rbac.effective.locked")}</li> : null}
                {explanation.granted && explanation.status === "disabled" ? <li className="text-destructive">{t("rbac.effective.disabled")}</li> : null}
                {!explanation.granted ? (
                  <li className="text-muted-foreground">
                    {explanation.otherRoles.length
                      ? t("rbac.effective.otherRoles", { roles: roleNames(explanation.otherRoles) })
                      : t("rbac.effective.nobody")}
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-5">
              <SectionCard title={t("rbac.effective.roles")} icon={ShieldCheck} size="sm">
                <div className="mb-3 flex items-center gap-3">
                  <UserAvatar user={user} role={data?.roleById.get(held[0] ?? "")?.code} size={40} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{name}</p>
                    <Mono className="text-muted-foreground">{user.username}</Mono>
                  </div>
                  <StatusText tone={user.status === "active" ? "success" : user.status === "locked" ? "destructive" : "muted"} className="ml-auto">
                    {tk(`sac.status.${user.status}`)}
                  </StatusText>
                </div>
                <ul className="flex flex-wrap gap-1.5" data-testid="effective-roles">
                  {held.map((id) => (
                    <li key={id}>
                      <Link href={`/rbac/roles/${id}`} className="inline-flex rounded-full bg-surface-raised px-2.5 py-1 text-xs hover:bg-primary-soft">
                        {roleName(data?.roleById.get(id), locale)}
                      </Link>
                    </li>
                  ))}
                  {!held.length ? <li className="text-sm text-muted-foreground">{t("rbac.effective.none")}</li> : null}
                </ul>
              </SectionCard>
              <SectionCard title={t("rbac.effective.limits")} icon={Gauge} size="sm">
                <dl className="flex flex-col divide-y divide-hairline text-[0.8125rem]">
                  {limits.map((l) => (
                    <div key={l.kind} className="flex items-baseline justify-between gap-3 py-2" data-testid="effective-limit" data-kind={l.kind}>
                      <dt className="text-muted-foreground">{tk(`rbac.kinds.${l.kind}`)}</dt>
                      <dd className="text-right">
                        <span className="nums font-medium">{limitText(l.kind, l.value)}</span>
                        {l.roleId ? (
                          <span className="block text-[0.6875rem] text-muted-foreground">
                            {t("rbac.effective.limitFrom", { role: roleName(data?.roleById.get(l.roleId), locale) })}
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </SectionCard>
            </div>
            <SectionCard
              title={t("rbac.effective.all", { name })}
              icon={KeyRound}
              size="sm"
              action={<span className="text-xs text-muted-foreground">{t("rbac.effective.count", { count: num(granted.length) })}</span>}
            >
              <TableSearch value={filter} onChange={setFilter} placeholder={t("rbac.effective.filter")} className="mb-3 max-w-none" />
              <div className="flex flex-col gap-3">
                {MATRIX_APPS.map((app) => {
                  const list = granted.filter((g) => appOfKey(g.key) === app)
                  if (!list.length) return null
                  return (
                    <div key={app} className="flex flex-col gap-1">
                      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <AppChip app={app} />
                        {appName(app)}
                      </p>
                      <ul className="flex flex-col">
                        {list.map((g) => (
                          <li key={g.key}>
                            <button
                              type="button"
                              onClick={() => setKey(g.key)}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-[0.8125rem] hover:bg-surface-raised",
                                g.key === key && "bg-primary-soft"
                              )}
                              data-testid="effective-granted"
                              data-key={g.key}
                            >
                              <span className="min-w-0 flex-1 truncate">{keyLabel(g.key)}</span>
                              <Mono className="hidden text-muted-foreground sm:inline">{g.key}</Mono>
                              <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{tk(`rbac.scope.${g.scope}`)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          </div>
        </>
      )}
    </div>
  )
}
