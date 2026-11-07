"use client"

import * as React from "react"
import type { Collection } from "dexie"
import { useLiveQuery } from "dexie-react-hooks"
import { useSearchParams } from "next/navigation"
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Search,
  ShieldCheck,
  ShieldX,
  X,
} from "lucide-react"

import { AppChip } from "@/components/shared/app-frame"
import { DateField } from "@/components/shared/date-field"
import { PageHeader } from "@/components/shared/page-header"
import { SearchPicker } from "@/components/shared/pickers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { verifyChain, type ChainStatus } from "@/core/audit/verify"
import { DAY, startOfDhakaDay } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { OmniflowDb } from "@/core/db/database"
import type { AuditAction, AuditRow, UserRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { actorName, userNameById } from "@/modules/demo/components/labels"
import {
  DiffList,
  MONO_DATA,
  diffLines,
} from "@/modules/demo/components/audit/diff"

import { locationName, personName, useUserDirectory } from "../../queries"
import { Field, Mono, OptionSelect } from "../kit"

const PAGE_SIZE = 50
const ACTIONS: AuditAction[] = [
  "insert",
  "update",
  "delete",
  "blocked",
  "system",
]
const ACTION_TEXT: Record<AuditAction, string> = {
  insert: "text-success",
  update: "text-info",
  delete: "text-destructive",
  blocked: "text-warning",
  system: "text-muted-foreground",
}
/** Fields never shown in clear in the diff (simulated password hashes). */
const SECRET_FIELDS = new Set(["passwordHash"])

type Filters = {
  user: string
  app: string
  action: "all" | AuditAction
  entity: string
  /** Document number or record id (contains) */
  doc: string
  from: string
  to: string
}
const NO_FILTERS: Filters = {
  user: "all",
  app: "all",
  action: "all",
  entity: "all",
  doc: "",
  from: "",
  to: "",
}

/**
 * Newest-first rows for the filters. The most selective indexed filter picks
 * the index; the rest are applied while iterating, and offsets keep a page
 * cheap even with thousands of rows.
 */
function auditCollection(
  db: OmniflowDb,
  f: Filters
): Collection<AuditRow, number> {
  const lo = f.from ? startOfDhakaDay(f.from) : null
  const hi = f.to ? startOfDhakaDay(f.to) + DAY - 1 : null
  let collection: Collection<AuditRow, number>
  const used = new Set<string>()
  if (f.entity !== "all") {
    collection = db.audit.where("entity").equals(f.entity).reverse()
    used.add("entity")
  } else if (f.user !== "all") {
    collection = db.audit.where("actor.userId").equals(f.user).reverse()
    used.add("user")
  } else if (lo !== null || hi !== null) {
    collection = db.audit
      .where("at")
      .between(lo ?? 0, hi ?? Number.MAX_SAFE_INTEGER, true, true)
      .reverse()
    used.add("date")
  } else if (f.app !== "all") {
    collection = db.audit.where("app").equals(f.app).reverse()
    used.add("app")
  } else if (f.action !== "all") {
    collection = db.audit.where("action").equals(f.action).reverse()
    used.add("action")
  } else {
    collection = db.audit.orderBy("seq").reverse()
  }
  const checks: ((row: AuditRow) => boolean)[] = []
  if (f.user !== "all" && !used.has("user"))
    checks.push((row) => (row.actor?.userId ?? "system") === f.user)
  if (f.app !== "all" && !used.has("app"))
    checks.push((row) => row.app === f.app)
  if (f.action !== "all" && !used.has("action"))
    checks.push((row) => row.action === f.action)
  if ((lo !== null || hi !== null) && !used.has("date")) {
    checks.push(
      (row) => row.at >= (lo ?? 0) && row.at <= (hi ?? Number.MAX_SAFE_INTEGER)
    )
  }
  const doc = f.doc.trim().toLowerCase()
  if (doc) {
    checks.push(
      (row) =>
        (!!row.docNo && row.docNo.toLowerCase().includes(doc)) ||
        row.entityId.toLowerCase().includes(doc)
    )
  }
  return checks.length
    ? collection.filter((row) => checks.every((check) => check(row)))
    : collection
}

/**
 * The audit trail (plan §3.11, /sac/audit, `sac.audit.view`): every audit
 * row newest first with its old → new diff; filters by user, app, action,
 * record type, document or record and date; the hash-chain indicator and
 * "Verify chain". The auditor reaches it without the rest of SAC.
 */
export function AuditViewer() {
  const { t, tk, num, locale } = useLocale()
  const db = useDb()
  const params = useSearchParams()
  const directory = useUserDirectory()
  const [filters, setFilters] = React.useState<Filters>(() => ({
    ...NO_FILTERS,
    doc: params.get("record") ?? params.get("doc") ?? "",
  }))
  const [page, setPage] = React.useState(0)
  const [expanded, setExpanded] = React.useState<number | null>(null)
  const [chain, setChain] = React.useState<ChainStatus | null>(null)
  const [verifying, setVerifying] = React.useState(true)

  React.useEffect(() => {
    let alive = true
    verifyChain(db)
      .then((status) => {
        if (alive) setChain(status)
      })
      .catch((error) => console.error("verify chain", error))
      .finally(() => {
        if (alive) setVerifying(false)
      })
    return () => {
      alive = false
    }
  }, [db])

  const verify = async () => {
    setVerifying(true)
    try {
      setChain(await verifyChain(db))
    } catch (error) {
      console.error("verify chain", error)
    } finally {
      setVerifying(false)
    }
  }

  const data = useLiveQuery(async () => {
    const total = await auditCollection(db, filters).count()
    const rows = await auditCollection(db, filters)
      .offset(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .toArray()
    return { total, rows }
  }, [db, filters, page])

  const facets = useLiveQuery(async () => {
    const [entities, apps] = await Promise.all([
      db.audit.orderBy("entity").uniqueKeys(),
      db.audit.orderBy("app").uniqueKeys(),
    ])
    return { entities: entities.map(String), apps: apps.map(String) }
  }, [db])
  const maxSeq = useLiveQuery(
    async () => (await db.audit.orderBy("seq").last())?.seq ?? 0,
    [db]
  )

  const update = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setPage(0)
    setExpanded(null)
  }
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS)
  const broken = chain && !chain.ok ? (chain.brokenAt ?? null) : null
  const jumpTo = (seq: number) => {
    setFilters(NO_FILTERS)
    setPage(Math.floor(Math.max(0, (maxSeq ?? seq) - seq) / PAGE_SIZE))
    setExpanded(seq)
  }

  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const from = total ? page * PAGE_SIZE + 1 : 0
  const to = Math.min(total, (page + 1) * PAGE_SIZE)
  const chainState = verifying
    ? "verifying"
    : chain
      ? chain.ok
        ? "intact"
        : "broken"
      : "unknown"

  const users: (
    UserRow | { id: "system"; nameEn: string; nameBn: string; username: string }
  )[] = [
    {
      id: "system",
      nameEn: t("sac.audit.system"),
      nameBn: t("sac.audit.system"),
      username: "system",
    },
    ...(directory?.users ?? []),
  ]

  return (
    <div className="flex flex-col gap-4" data-testid="audit-viewer">
      <PageHeader
        title={t("sac.audit.title")}
        subtitle={t("sac.audit.subtitle")}
        actions={
          <>
            <div
              role="status"
              data-testid="audit-chain"
              data-state={chainState}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium",
                verifying || !chain
                  ? "bg-surface-raised text-muted-foreground"
                  : chain.ok
                    ? "bg-success/15 text-success"
                    : "bg-destructive/15 text-destructive"
              )}
            >
              {verifying ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : chain?.ok ? (
                <ShieldCheck className="size-3.5" />
              ) : (
                <ShieldX className="size-3.5" />
              )}
              {verifying
                ? t("sac.audit.verifying")
                : chain?.ok
                  ? t("sac.audit.intact", { count: num(chain.count) })
                  : broken !== null
                    ? t("sac.audit.broken", { seq: num(broken) })
                    : null}
            </div>
            {broken !== null && !verifying ? (
              <Button variant="link" size="sm" onClick={() => jumpTo(broken)}>
                {t("sac.audit.jump", { seq: num(broken) })}
              </Button>
            ) : null}
            <Button
              onClick={verify}
              disabled={verifying}
              data-testid="audit-verify"
            >
              <ShieldCheck />
              {t("sac.audit.verify")}
            </Button>
          </>
        }
      />

      <div className="surface-card @container flex min-w-0 flex-col gap-3 p-3 md:p-4">
        <div className="grid grid-cols-1 gap-2 @min-[34rem]:grid-cols-2 @min-[44rem]:grid-cols-4 @min-[84rem]:grid-cols-8">
          <Field
            label={t("sac.audit.filters.user")}
            className="@min-[84rem]:col-span-2"
          >
            <SearchPicker
              items={users}
              value={filters.user === "all" ? null : filters.user}
              onChange={(id) => update({ user: id ?? "all" })}
              getId={(u) => u.id}
              searchText={(u) => `${u.nameEn} ${u.nameBn} ${u.username}`}
              renderValue={(u) => personName(u, locale)}
              renderItem={(u) => (
                <span className="flex items-center justify-between gap-2">
                  {personName(u, locale)}{" "}
                  <Mono className="text-muted-foreground">{u.username}</Mono>
                </span>
              )}
              placeholder={t("sac.audit.filters.allUsers")}
              testId="audit-user"
            />
          </Field>
          <Field label={t("sac.audit.filters.app")}>
            <OptionSelect
              value={filters.app}
              onChange={(app) => update({ app })}
              label={t("sac.audit.filters.app")}
              testId="audit-app"
              className="w-full"
              options={[
                { value: "all", label: t("sac.audit.filters.allApps") },
                ...(facets?.apps ?? []).map((app) => ({
                  value: app,
                  label: <AppChip app={app} />,
                })),
              ]}
            />
          </Field>
          <Field label={t("sac.audit.filters.action")}>
            <OptionSelect
              value={filters.action}
              onChange={(action) =>
                update({ action: action as Filters["action"] })
              }
              label={t("sac.audit.filters.action")}
              testId="audit-action"
              className="w-full"
              options={[
                { value: "all", label: t("sac.audit.filters.allActions") },
                ...ACTIONS.map((a) => ({
                  value: a,
                  label: tk(`sac.audit.actions.${a}`),
                })),
              ]}
            />
          </Field>
          <Field label={t("sac.audit.filters.entity")}>
            <OptionSelect
              value={filters.entity}
              onChange={(entity) => update({ entity })}
              label={t("sac.audit.filters.entity")}
              testId="audit-entity"
              className="w-full"
              options={[
                { value: "all", label: t("sac.audit.filters.allEntities") },
                ...(facets?.entities ?? []).map((e) => ({
                  value: e,
                  label: <Mono>{e}</Mono>,
                })),
              ]}
            />
          </Field>
          <Field
            label={t("sac.audit.filters.doc")}
            className="@min-[84rem]:col-span-1"
          >
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                lang="en"
                value={filters.doc}
                onChange={(e) => update({ doc: e.target.value })}
                aria-label={t("sac.audit.filters.doc")}
                className="pl-8 font-mono"
                data-testid="audit-doc"
              />
            </div>
          </Field>
          <Field label={t("sac.audit.filters.from")}>
            <DateField
              value={filters.from}
              onChange={(from) => update({ from })}
              data-testid="audit-from"
            />
          </Field>
          <Field label={t("sac.audit.filters.to")}>
            <DateField
              value={filters.to}
              onChange={(to) => update({ to })}
              data-testid="audit-to"
            />
          </Field>
        </div>
        {filtered ? (
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => update(NO_FILTERS)}
              data-testid="audit-clear"
            >
              <X />
              {t("sac.audit.filters.clear")}
            </Button>
          </div>
        ) : null}

        <div className="min-w-0 overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <Th className="w-12 rounded-l-md">
                  {t("sac.audit.columns.seq")}
                </Th>
                <Th>{t("sac.audit.columns.at")}</Th>
                <Th>{t("sac.audit.columns.user")}</Th>
                <Th>{t("sac.audit.columns.action")}</Th>
                <Th>{t("sac.audit.columns.record")}</Th>
                <Th className="hidden @[64rem]:table-cell">
                  {t("sac.audit.columns.doc")}
                </Th>
                <Th>{t("sac.audit.columns.changes")}</Th>
                <Th className="hidden @[72rem]:table-cell">
                  {t("sac.audit.columns.reason")}
                </Th>
                <Th className="hidden @[56rem]:table-cell">
                  {t("sac.audit.columns.app")}
                </Th>
                <Th className="hidden rounded-r-md @[60rem]:table-cell">
                  {t("sac.audit.columns.hash")}
                </Th>
              </tr>
            </thead>
            <tbody>
              {data === undefined ? (
                <tr>
                  <td
                    colSpan={10}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {t("common.loading")}
                  </td>
                </tr>
              ) : data.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {t("sac.audit.empty")}
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => (
                  <AuditTableRow
                    key={row.seq}
                    row={row}
                    broken={row.seq === broken}
                    expanded={expanded === row.seq}
                    onToggle={() =>
                      setExpanded((current) =>
                        current === row.seq ? null : row.seq
                      )
                    }
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        <footer className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span data-testid="audit-range">
            {t("sac.audit.range", {
              from: num(from),
              to: num(to),
              total: num(total),
            })}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page === 0}
            onClick={() => {
              setPage(page - 1)
              setExpanded(null)
            }}
            aria-label={t("sac.audit.prev")}
            title={t("sac.audit.prev")}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page >= pages - 1}
            onClick={() => {
              setPage(page + 1)
              setExpanded(null)
            }}
            aria-label={t("sac.audit.next")}
            title={t("sac.audit.next")}
          >
            <ChevronRight />
          </Button>
        </footer>
      </div>
    </div>
  )
}

function Th({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <th
      className={cn(
        "h-9 bg-surface-raised px-2 text-left font-medium whitespace-nowrap text-muted-foreground",
        className
      )}
    >
      {children}
    </th>
  )
}

/** The diff lines of a row without secret fields. */
function visibleDiff(row: AuditRow) {
  return diffLines(row).filter((line) => !SECRET_FIELDS.has(line.field))
}

function AuditTableRow({
  row,
  broken,
  expanded,
  onToggle,
}: {
  row: AuditRow
  broken: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const { t, tk, num, locale, dmy, time } = useLocale()
  const lines = visibleDiff(row)
  const approver = row.approvedBy
    ? userNameById(row.approvedBy, locale, tk)
    : null
  const cell = "border-b border-hairline px-2 py-2 align-top"
  return (
    <>
      <tr
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid="audit-row"
        data-seq={row.seq}
        data-action={row.action}
        className={cn(
          "cursor-pointer hover:bg-primary-soft",
          expanded && "bg-primary-soft",
          broken && "bg-destructive/10 hover:bg-destructive/15"
        )}
      >
        <td className={cn(cell, "font-mono text-muted-foreground")}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            className="inline-flex items-center gap-0.5 outline-none focus-visible:text-foreground"
          >
            <ChevronRight
              className={cn(
                "size-3 transition-transform",
                expanded && "rotate-90"
              )}
            />
            <span lang="en">{row.seq}</span>
          </button>
        </td>
        <td className={cn(cell, "nums whitespace-nowrap")}>
          <span className="block">{dmy(row.at)}</span>
          <span className="block text-muted-foreground">{time(row.at)}</span>
        </td>
        <td className={cn(cell, "max-w-44")}>
          <span className="block truncate font-medium">
            {actorName(row.actor, locale, tk)}
          </span>
          {row.actor && row.actor.userId !== "system" ? (
            <span
              lang="en"
              className="block truncate font-mono text-[0.6875rem] text-muted-foreground"
            >
              {row.actor.username}
            </span>
          ) : null}
        </td>
        <td className={cn(cell, "font-medium", ACTION_TEXT[row.action])}>
          {tk(`sac.audit.actions.${row.action}`)}
          {row.code ? (
            <span className="block font-mono text-[0.625rem]">{row.code}</span>
          ) : null}
        </td>
        <td className={cn(cell, "max-w-40")}>
          <span lang="en" className="block truncate font-mono">
            {row.entity}
          </span>
          <span className="block truncate font-mono text-[0.625rem] text-muted-foreground">
            {row.entityId}
          </span>
        </td>
        <td className={cn(cell, "hidden max-w-40 @[64rem]:table-cell")}>
          {row.docNo ? (
            <span lang="en" className="block truncate font-mono">
              {row.docNo}
            </span>
          ) : null}
        </td>
        <td className={cn(cell, "max-w-[22rem] min-w-40 whitespace-normal")}>
          <DiffList
            lines={lines}
            limit={3}
            max={28}
            moreLabel={(count) =>
              t("sac.audit.moreFields", { count: num(count) })
            }
          />
        </td>
        <td
          className={cn(
            cell,
            "hidden max-w-44 whitespace-normal @[72rem]:table-cell"
          )}
        >
          {row.reason ? <span className="block">{row.reason}</span> : null}
          {approver ? (
            <span className="block text-[0.6875rem] text-muted-foreground">
              {t("sac.audit.approvedBy", { name: approver })}
            </span>
          ) : null}
        </td>
        <td className={cn(cell, "hidden @[56rem]:table-cell")}>
          <AppChip app={row.app} />
        </td>
        <td
          className={cn(
            cell,
            "hidden font-mono text-[0.6875rem] text-muted-foreground @[60rem]:table-cell"
          )}
        >
          {row.hash.slice(0, 8)}
        </td>
      </tr>
      {expanded ? (
        <tr className="bg-card">
          <td
            colSpan={10}
            className="border-b border-hairline px-2 py-2 whitespace-normal"
          >
            <AuditDetails row={row} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

function Detail({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-all", className)}>{children}</dd>
    </>
  )
}

/** Before and after in full, with who, where, why, and the hash links. */
function AuditDetails({ row }: { row: AuditRow }) {
  const { t, tk, locale, dmy, time } = useLocale()
  const strip = (value: Record<string, unknown> | undefined) => {
    if (!value) return {}
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value))
      out[key] = SECRET_FIELDS.has(key) ? "••••••" : v
    return out
  }
  const pretty = (value: unknown) => JSON.stringify(value ?? {}, null, 2)
  return (
    <div
      className="grid gap-3 py-1 @[48rem]:grid-cols-2"
      data-testid="audit-details"
    >
      <div className="min-w-0">
        <p className="micro mb-1">{t("sac.audit.details.before")}</p>
        <pre
          className={cn(
            "max-h-56 overflow-auto rounded-md bg-surface-raised p-2 text-[0.6875rem] leading-relaxed",
            MONO_DATA
          )}
        >
          {pretty(strip(row.before))}
        </pre>
      </div>
      <div className="min-w-0">
        <p className="micro mb-1">{t("sac.audit.details.after")}</p>
        <pre
          className={cn(
            "max-h-56 overflow-auto rounded-md bg-surface-raised p-2 text-[0.6875rem] leading-relaxed",
            MONO_DATA
          )}
        >
          {pretty(strip(row.after))}
        </pre>
      </div>
      <dl className="grid min-w-0 grid-cols-[7rem_1fr] gap-x-2 gap-y-1 text-[0.6875rem] @[48rem]:col-span-2">
        <Detail
          label={t("sac.audit.columns.at")}
        >{`${dmy(row.at)}, ${time(row.at)}`}</Detail>
        <Detail label={t("sac.audit.columns.user")}>
          {actorName(row.actor, locale, tk)}
        </Detail>
        {row.actor?.sessionId ? (
          <Detail label={t("sac.audit.details.session")} className="font-mono">
            {row.actor.sessionId}
          </Detail>
        ) : null}
        {row.actor?.locationId ? (
          <Detail label={t("sac.audit.details.location")}>
            {locationName(row.actor.locationId, locale)}
          </Detail>
        ) : null}
        {row.docNo ? (
          <Detail label={t("sac.audit.columns.doc")} className="font-mono">
            {row.docNo}
          </Detail>
        ) : null}
        {row.reason ? (
          <Detail label={t("sac.audit.columns.reason")}>{row.reason}</Detail>
        ) : null}
        {row.approvedBy ? (
          <Detail label={t("sac.audit.details.approver")}>
            {userNameById(row.approvedBy, locale, tk)}
          </Detail>
        ) : null}
        <Detail
          label={t("sac.audit.columns.app")}
          className="font-mono uppercase"
        >
          {row.app}
        </Detail>
        <Detail label={t("sac.audit.details.command")} className="font-mono">
          {row.command}
        </Detail>
        <Detail label={t("sac.audit.details.commit")} className="font-mono">
          {row.commitId}
        </Detail>
        {row.code ? (
          <Detail label={t("sac.audit.details.code")} className="font-mono">
            {row.code}
          </Detail>
        ) : null}
        <Detail
          label={t("sac.audit.details.prevHash")}
          className="font-mono text-muted-foreground"
        >
          {row.prevHash}
        </Detail>
        <Detail label={t("sac.audit.details.hash")} className="font-mono">
          {row.hash}
        </Detail>
      </dl>
    </div>
  )
}
