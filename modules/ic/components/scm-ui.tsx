"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { Download, FileQuestion, Printer } from "lucide-react"
import { toast } from "sonner"

import { DocStatus } from "@/components/shared/doc-status"
import { EmptyState } from "@/components/shared/empty-state"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { sendToPrinter } from "@/core/connectors/printer"
import { useDb } from "@/core/db/DbProvider"
import { newId } from "@/core/db/ids"
import type { Id, ItemCategoryRow, ItemRow, LocationRow, PartyRow, UserRow } from "@/core/db/schema"
import { toCsv, downloadCsv } from "@/core/reports/csv"
import type { DatasetRow } from "@/core/reports/types"
import { usePermissions } from "@/core/security/useCan"
import { nameOf, userName } from "@/core/security/users"
import { roundQty } from "@/core/stock/value"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

/**
 * UI building blocks shared by the SCM screens (PTL, PM, GRN, ST, IC):
 * live lookups, the location filter, CSV export gated by the app's export
 * key, quantities with their unit, the document header, print preview and
 * "not found". Everything reads through `useDb()` + `useLiveQuery`.
 */

export type ScmLookups = {
  items: Map<Id, ItemRow>
  itemList: ItemRow[]
  categories: Map<Id, ItemCategoryRow>
  locations: Map<Id, LocationRow>
  stockLocations: LocationRow[]
  vendors: Map<Id, PartyRow>
  vendorList: PartyRow[]
  users: Map<Id, UserRow>
}

/** Live maps of items, categories, locations, vendors and users (small tables). */
export function useScmLookups(): ScmLookups | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const [items, categories, locations, vendors, users] = await Promise.all([
      db.items.toArray(),
      db.itemCategories.toArray(),
      db.locations.toArray(),
      db.parties.filter((p) => p.isVendor).toArray(),
      db.users.toArray(),
    ])
    const itemList = items.sort((a, b) => a.sku.localeCompare(b.sku))
    return {
      items: new Map(itemList.map((i) => [i.id, i])),
      itemList,
      categories: new Map(categories.map((c) => [c.id, c])),
      locations: new Map(locations.map((l) => [l.id, l])),
      stockLocations: locations.filter((l) => l.isStockLocation && l.active).sort((a, b) => (a.kind === "store" ? -1 : b.kind === "store" ? 1 : a.code.localeCompare(b.code))),
      vendors: new Map(vendors.map((v) => [v.id, v])),
      vendorList: vendors.filter((v) => v.segment === "supplier").sort((a, b) => a.nameEn.localeCompare(b.nameEn)),
      users: new Map(users.map((u) => [u.id, u])),
    }
  }, [db])
}

/** A fresh idempotency key per user action (money and stock actions, plan §18). */
export function freshKey(): string {
  return newId("idk")
}

/** Quantity with its unit: "1,250 ml", "0.5 pc" (Bangla digits in Bangla). */
export function QtyText({ value, uom, className, signed = false }: { value: number; uom?: string; className?: string; signed?: boolean }) {
  const { num } = useLocale()
  const v = roundQty(value)
  return (
    <span className={cn("nums whitespace-nowrap tabular-nums", className)}>
      {signed && v > 0 ? "+" : ""}
      {num(v, { maximumFractionDigits: 3 })}
      {uom ? (
        <span lang="en" className="ml-1 text-xs text-muted-foreground">
          {uom}
        </span>
      ) : null}
    </span>
  )
}

/** Item name in the window's language with its SKU below (mono, Latin). */
export function ItemCell({ item, href, className }: { item: ItemRow | undefined; href?: string; className?: string }) {
  const { locale } = useLocale()
  if (!item) return <span className="text-muted-foreground">-</span>
  const name = nameOf(item, locale)
  return (
    <span className={cn("flex min-w-0 flex-col", className)}>
      {href ? (
        <Link href={href} className="truncate font-medium text-link hover:underline">
          {name}
        </Link>
      ) : (
        <span className="truncate font-medium">{name}</span>
      )}
      <span lang="en" className="truncate font-mono text-[0.6875rem] text-muted-foreground">
        {item.sku}
      </span>
    </span>
  )
}

/** A user's name by id, in the window's language. */
export function useUserLabel() {
  const { locale } = useLocale()
  return (users: Map<Id, UserRow> | undefined, id: Id | undefined) => (id ? userName(users?.get(id), locale) || id : "")
}

/** Location filter: "All locations" plus the stock locations (or the given ones). */
export function LocationSelect({
  value,
  onChange,
  locations,
  includeAll = true,
  testId = "location-filter",
  className,
}: {
  value: Id | "all"
  onChange: (value: Id | "all") => void
  locations: LocationRow[]
  includeAll?: boolean
  testId?: string
  className?: string
}) {
  const { t, locale } = useLocale()
  const current = locations.find((l) => l.id === value)
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as Id | "all")}>
      <SelectTrigger className={cn("min-w-44", className)} data-testid={testId} aria-label={t("ic.ui.location")}>
        <SelectValue>{() => (current ? nameOf(current, locale) : t("ic.ui.allLocations"))}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {includeAll ? <SelectItem value="all">{t("ic.ui.allLocations")}</SelectItem> : null}
        {locations.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {nameOf(l, locale)}
            <span lang="en" className="ml-auto pl-3 font-mono text-xs text-muted-foreground">
              {l.code}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A small select over fixed options (status and kind filters). */
export function OptionSelect<T extends string>({
  value,
  onChange,
  options,
  label,
  testId,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  label: string
  testId?: string
  className?: string
}) {
  const current = options.find((o) => o.value === value)
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as T)}>
      <SelectTrigger className={cn("min-w-36", className)} data-testid={testId} aria-label={label}>
        <SelectValue>{() => current?.label ?? label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** CSV export of a list, shown only to users holding the app's export key. */
export function ExportCsvButton({
  permission,
  fileName,
  columns,
  rows,
}: {
  permission: string
  fileName: string
  columns: { key: string; label: string }[]
  rows: () => DatasetRow[]
}) {
  const { t } = useLocale()
  const { can } = usePermissions()
  if (!can(permission)) return null
  return (
    <Button
      variant="neutral"
      size="sm"
      data-testid="export-csv"
      onClick={() => downloadCsv(fileName, toCsv(rows(), columns))}
    >
      <Download />
      {t("common.exportCsv")}
    </Button>
  )
}

/** Toolbar row above a list: search and filters left, actions right; wraps at 960px. */
export function ListToolbar({ children, actions }: { children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      {children}
      {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** "Not found" inside the shell for an unknown document id. */
export function NotFound({ title, backHref, backLabel }: { title: string; backHref: string; backLabel: string }) {
  return (
    <EmptyState
      icon={FileQuestion}
      title={title}
      action={{ label: backLabel, href: backHref }}
      className="surface-card"
    />
  )
}

/**
 * The document header (ui_guidelines.md §4): number (mono, large), status,
 * party and date on the left, amounts on the right, the action bar below,
 * linked documents under it.
 */
export function DocHeader({
  kind,
  docNo,
  status,
  lines,
  amounts,
  actions,
  links,
  testId,
}: {
  kind: string
  docNo: string
  status?: string
  lines?: React.ReactNode[]
  amounts?: { label: string; value: React.ReactNode }[]
  actions?: React.ReactNode
  links?: React.ReactNode
  testId?: string
}) {
  return (
    <section data-testid={testId} className="surface-card flex flex-col gap-4 p-5 @container/doc">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-muted-foreground">{kind}</span>
          <div className="flex flex-wrap items-center gap-3">
            <h1 lang="en" className="font-mono text-xl font-semibold tracking-tight" data-testid="doc-no">
              {docNo}
            </h1>
            {status ? <DocStatus status={status} /> : null}
          </div>
          {lines?.filter(Boolean).map((line, i) => (
            <div key={i} className="text-[0.8125rem] text-muted-foreground">
              {line}
            </div>
          ))}
        </div>
        {amounts?.length ? (
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {amounts.map((a) => (
              <div key={a.label} className="flex flex-col items-end">
                <dt className="text-xs text-muted-foreground">{a.label}</dt>
                <dd className="font-mono text-base font-semibold">{a.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">{actions}</div> : null}
      {links ? <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.8125rem]">{links}</div> : null}
    </section>
  )
}

/** Print preview: the white sheet in a dialog; Print uses the browser, "Send to printer" is simulated. */
export function PrintPreview({
  open,
  onOpenChange,
  title,
  docNo,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  docNo: string
  children: React.ReactNode
}) {
  const { t } = useLocale()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[min(62rem,calc(100%-2rem))]" data-testid="print-preview">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="-mx-2 max-h-[calc(100svh-11rem)] overflow-auto rounded-md bg-[#d9d9d9] p-3">{children}</div>
        <DialogFooter className="items-center">
          <SimulatedBadge className="mr-auto" />
          <Button
            variant="neutral"
            onClick={() => {
              const out = sendToPrinter(docNo)
              toast.success(t("ic.ui.sentToPrinter", { doc: out.message }))
            }}
          >
            {t("ic.ui.sendToPrinter")}
          </Button>
          <Button onClick={() => window.print()} data-testid="print-now">
            <Printer />
            {t("common.print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A labelled form field. */
export function Field({ label, children, className, hint }: { label: React.ReactNode; children: React.ReactNode; className?: string; hint?: React.ReactNode }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5 text-[0.8125rem]", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

/** A turquoise text link used as a row action. */
export function RowLink({ href, children, testId }: { href: string; children: React.ReactNode; testId?: string }) {
  return (
    <Link href={href} data-testid={testId} className={cn(buttonVariants({ variant: "link" }), "text-[0.8125rem]")}>
      {children}
    </Link>
  )
}

/** Plain lines table for documents (dense, header band, figures right-aligned). */
export function LinesTable({
  head,
  children,
  foot,
  testId,
}: {
  head: { label: React.ReactNode; align?: "right"; hide?: "sm" | "md" | "lg"; className?: string }[]
  children: React.ReactNode
  foot?: React.ReactNode
  testId?: string
}) {
  return (
    <div className="@container/lines overflow-x-auto" data-testid={testId}>
      <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className={cn(
                  "h-9 bg-surface-raised px-3 font-medium whitespace-nowrap first:rounded-l-md last:rounded-r-md",
                  h.align === "right" ? "text-right" : "text-left",
                  h.hide && HIDE[h.hide],
                  h.className
                )}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:h-11 [&_td]:border-b [&_td]:border-hairline [&_td]:px-3">{children}</tbody>
        {foot ? <tfoot className="[&_td]:h-10 [&_td]:bg-surface-raised [&_td]:px-3 [&_td]:font-semibold">{foot}</tfoot> : null}
      </table>
    </div>
  )
}

/** Hide a lines-table cell below a container width (pair with LinesTable's head `hide`). */
export const HIDE = {
  sm: "hidden @min-[32rem]/lines:table-cell",
  md: "hidden @min-[42rem]/lines:table-cell",
  lg: "hidden @min-[52rem]/lines:table-cell",
} as const

/** Two-column (or one on narrow screens) page body with an optional right rail. */
export function PageGrid({ main, rail }: { main: React.ReactNode; rail?: React.ReactNode }) {
  return (
    <div className="@container/page">
      <div className={cn("grid gap-5", rail && "@min-[70rem]/page:grid-cols-[minmax(0,1fr)_20rem]")}>
        <div className="flex min-w-0 flex-col gap-5">{main}</div>
        {rail ? <aside className="flex min-w-0 flex-col gap-5">{rail}</aside> : null}
      </div>
    </div>
  )
}
