"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Download, Printer } from "lucide-react"
import { toast } from "sonner"

import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { RegPlate } from "@/components/shared/reg-plate"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { sendToPrinter } from "@/core/connectors/printer"
import { useDb } from "@/core/db/DbProvider"
import { newId } from "@/core/db/ids"
import type { Id, LocationRow, UserRow, VehicleClass, VehicleRow } from "@/core/db/schema"
import { downloadCsv, toCsv } from "@/core/reports/csv"
import type { DatasetRow } from "@/core/reports/types"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

/**
 * Small building blocks shared by the SDM screens (STL, SI, PC, SD): the
 * studio a screen works at, vehicle and class cells, document headers,
 * status filter pills, CSV export and the print preview dialog.
 */

/** A fresh idempotency key for one user action (plan §18). */
export const newKey = () => newId("ik")

/** Studios the signed-in user may work at, and the one this screen shows. */
export function useStudio(): {
  locationId: Id | null
  setLocationId: (id: Id) => void
  studios: LocationRow[]
} {
  const db = useDb()
  const { locationId: current } = useSession()
  const { locationIds, user } = usePermissions()
  const studios = useLiveQuery(
    async () => (await db.locations.toArray()).filter((l) => l.kind === "studio" && l.active),
    [db]
  )
  const mine = React.useMemo(
    () => (studios ?? []).filter((s) => locationIds.includes(s.id)),
    [studios, locationIds]
  )
  const [picked, setPicked] = React.useState<Id | null>(null)
  const fallback = mine.find((s) => s.id === current)?.id ?? mine.find((s) => s.id === user?.homeLocationId)?.id ?? mine[0]?.id ?? null
  const locationId = picked && mine.some((s) => s.id === picked) ? picked : fallback
  return { locationId, setLocationId: setPicked, studios: mine }
}

/** Studio switcher for users who work at more than one studio. */
export function StudioSelect({
  value,
  onChange,
  studios,
  className,
}: {
  value: Id | null
  onChange: (id: Id) => void
  studios: LocationRow[]
  className?: string
}) {
  const { locale, t } = useLocale()
  if (studios.length < 2) return null
  const current = studios.find((s) => s.id === value)
  return (
    <Select value={value ?? ""} onValueChange={(v) => v && onChange(v as Id)}>
      <SelectTrigger className={cn("min-w-40", className)} data-testid="studio-select" aria-label={t("common.location")}>
        <SelectValue>{() => (current ? nameOf(current, locale) : t("common.location"))}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {studios.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {nameOf(s, locale)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Vehicle class as a small mono chip with its full name on hover. */
export function ClassTag({ cls, className }: { cls?: VehicleClass | null; className?: string }) {
  const { tk } = useLocale()
  if (!cls) return null
  return (
    <span
      lang="en"
      title={tk(`reports.enum.vehicleClass.${cls}`)}
      className={cn("inline-flex h-5 items-center rounded-full bg-surface-raised px-1.5 font-mono text-[0.625rem] font-semibold", className)}
    >
      {cls}
    </span>
  )
}

/** Registration plate with make and model. */
export function VehicleCell({ vehicle, compact = false }: { vehicle?: VehicleRow; compact?: boolean }) {
  if (!vehicle) return <span className="text-muted-foreground">-</span>
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <RegPlate regNo={vehicle.regNo} />
      {!compact ? (
        <span className="min-w-0 truncate text-[0.8125rem]">
          {vehicle.make} {vehicle.model}
        </span>
      ) : null}
    </span>
  )
}

/** Live map of users (names, avatars, technicians). */
export function useUserMap(): Map<Id, UserRow> {
  const db = useDb()
  const users = useLiveQuery(() => db.users.toArray(), [db])
  return React.useMemo(() => new Map((users ?? []).map((u) => [u.id, u])), [users])
}

/** Technicians (users holding stl.job.work through the TECHNICIAN role) at a studio. */
export function useTechnicians(locationId: Id | null): UserRow[] {
  const db = useDb()
  const rows = useLiveQuery(async () => {
    if (!locationId) return []
    const role = await db.roles.where("code").equals("TECHNICIAN").first()
    if (!role) return []
    const links = await db.userRoles.where("roleId").equals(role.id).toArray()
    const users = (await db.users.bulkGet(links.map((l) => l.userId))).filter((u): u is UserRow => !!u)
    return users.filter((u) => u.status === "active" && u.locationIds.includes(locationId)).sort((a, b) => a.nameEn.localeCompare(b.nameEn))
  }, [db, locationId])
  return rows ?? []
}

/** A row of status pills to filter a list (All plus each status). */
export function StatusPills({
  value,
  onChange,
  options,
  counts,
  testId = "status-pills",
}: {
  value: string
  onChange: (value: string) => void
  options: string[]
  counts?: Record<string, number>
  testId?: string
}) {
  const { t, tk, num } = useLocale()
  return (
    <div className="flex flex-wrap gap-1" data-testid={testId}>
      {["all", ...options].map((o) => {
        const label = o === "all" ? t("common.all") : tk(`shared.status.${o}`)
        const count = counts?.[o]
        return (
          <button
            key={o}
            type="button"
            data-value={o}
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] whitespace-nowrap transition-colors",
              value === o ? "bg-primary text-primary-foreground" : "bg-surface-raised text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
            {count !== undefined ? <span className="nums text-xs opacity-80">{num(count)}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/** CSV export button (only for holders of the app's export key). */
export function ExportButton({
  permission,
  fileName,
  rows,
  columns,
}: {
  permission: string
  fileName: string
  rows: DatasetRow[]
  columns: { key: string; label: string }[]
}) {
  const { t } = useLocale()
  const { can } = usePermissions()
  if (!can(permission)) return null
  return (
    <Button variant="neutral" size="sm" data-testid="export-csv" onClick={() => downloadCsv(fileName, toCsv(rows, columns))}>
      <Download data-icon="inline-start" />
      {t("common.exportCsv")}
    </Button>
  )
}

/**
 * The document header (ui_guidelines.md §4): number, status, party and
 * date on the left; amounts on the right; the action bar below.
 */
export function DocHeader({
  docNo,
  status,
  title,
  lines,
  amounts,
  actions,
  testId,
}: {
  docNo: string
  status?: string
  title?: React.ReactNode
  lines?: React.ReactNode[]
  amounts?: { label: React.ReactNode; valueP: number; tone?: "destructive" | "success" | "muted"; strong?: boolean; testId?: string }[]
  actions?: React.ReactNode
  testId?: string
}) {
  return (
    <section className="surface-card @container/doc flex flex-col gap-4 p-5" data-testid={testId}>
      <div className="flex flex-col gap-4 @min-[40rem]/doc:flex-row @min-[40rem]/doc:items-start @min-[40rem]/doc:justify-between">
        <div className="min-w-0">
          {title ? <div className="text-xs text-muted-foreground">{title}</div> : null}
          <div className="flex flex-wrap items-center gap-3">
            <h1 lang="en" className="font-mono text-xl font-semibold tracking-tight" data-testid="doc-no">
              {docNo}
            </h1>
            {status ? <DocStatus status={status} /> : null}
          </div>
          {lines?.length ? (
            <div className="mt-2 flex flex-col gap-1 text-[0.8125rem] text-muted-foreground">
              {lines.map((l, i) => (
                <div key={i} className="flex min-w-0 flex-wrap items-center gap-2">
                  {l}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {amounts?.length ? (
          <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1.5 @min-[40rem]/doc:grid-cols-1 @min-[40rem]/doc:text-right">
            {amounts.map((a, i) => (
              <div key={i} className="flex flex-col @min-[40rem]/doc:flex-row @min-[40rem]/doc:items-baseline @min-[40rem]/doc:justify-end @min-[40rem]/doc:gap-4">
                <dt className="text-xs text-muted-foreground">{a.label}</dt>
                <dd
                  data-testid={a.testId}
                  className={cn(
                    "font-mono text-sm tabular-nums",
                    a.strong && "text-base font-semibold",
                    a.tone === "destructive" && "text-destructive",
                    a.tone === "success" && "text-success",
                    a.tone === "muted" && "text-muted-foreground"
                  )}
                >
                  <MoneyText poisha={a.valueP} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">{actions}</div> : null}
    </section>
  )
}

/**
 * Print preview in a dialog: the white sheet (PrintLayout) with Print (the
 * browser's print of the sheet only) and "Send to printer" (simulated).
 */
export function PrintDialog({
  open,
  onOpenChange,
  title,
  docNo,
  children,
  wide = true,
  testId = "print-preview",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  docNo: string
  children: React.ReactNode
  wide?: boolean
  testId?: string
}) {
  const { t } = useLocale()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[calc(100svh-1rem)] bg-surface-raised p-4", wide ? "sm:max-w-[min(62rem,calc(100vw-2rem))]" : "sm:max-w-md")} data-testid={testId}>
        <DialogHeader className="flex-row flex-wrap items-center gap-2 pr-10">
          <DialogTitle className="mr-auto">{title}</DialogTitle>
          <SimulatedBadge />
          <Button
            size="sm"
            variant="neutral"
            onClick={() => toast.success(t("stl.print.sent", { doc: sendToPrinter(docNo).message }))}
          >
            {t("stl.print.send")}
          </Button>
          <Button size="sm" onClick={() => window.print()} data-testid="print-now">
            <Printer data-icon="inline-start" />
            {t("common.print")}
          </Button>
        </DialogHeader>
        <div className="overflow-auto rounded-md bg-[#d9d9d9] p-3 dark:bg-[#1c1b1d]">{children}</div>
      </DialogContent>
    </Dialog>
  )
}

/** A label above a control, for forms. */
export function Field({ label, children, className, hint }: { label: React.ReactNode; children: React.ReactNode; className?: string; hint?: React.ReactNode }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

/** Totals block (subtotal, discount, VAT, total) right-aligned in mono. */
export function TotalsBlock({
  rows,
  className,
}: {
  rows: { label: React.ReactNode; valueP: number; strong?: boolean; negative?: boolean; testId?: string }[]
  className?: string
}) {
  return (
    <dl className={cn("ml-auto flex w-full max-w-80 flex-col gap-1.5 text-[0.8125rem]", className)}>
      {rows.map((r, i) => (
        <div key={i} className={cn("flex items-baseline justify-between gap-4", r.strong && "border-t border-hairline pt-2 text-base font-semibold")}>
          <dt className={cn(!r.strong && "text-muted-foreground")}>{r.label}</dt>
          <dd className="font-mono tabular-nums" data-testid={r.testId}>
            <MoneyText poisha={r.negative ? -r.valueP : r.valueP} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Party name in the window's language (live), with a fallback. */
export function usePartyName(partyId: Id | null | undefined): string {
  const db = useDb()
  const { locale } = useLocale()
  const party = useLiveQuery(() => (partyId ? db.parties.get(partyId) : undefined), [db, partyId])
  return party ? nameOf(party, locale) : ""
}
