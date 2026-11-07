"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { addDaysISO, dhakaDate, startOfDhakaDay } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { Id, ItemRow } from "@/core/db/schema"
import { nameOf, userName } from "@/core/security/users"
import { roundQty } from "@/core/stock/value"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { ExportCsvButton, HIDE, ItemCell, LinesTable, ListToolbar, LocationSelect, OptionSelect, QtyText, useScmLookups } from "./scm-ui"

type Group = {
  key: string
  label: string
  item?: ItemRow
  jobs: Set<Id>
  standard: number
  actual: number
  valueP: number
  standardValueP: number
}

/**
 * /ic/consumption: consumption variance per service (or technician) and
 * item, the recipe's standard quantity against what was actually used, from
 * job consumption (STL records it when tasks finish and on extras/returns).
 */
export function ConsumptionVariance() {
  const db = useDb()
  const { t, locale, num, pct } = useLocale()
  const lookups = useScmLookups()
  const nowMs = useNow(60_000)
  const today = dhakaDate(nowMs)
  const [by, setBy] = React.useState<"service" | "technician">("service")
  const [days, setDays] = React.useState("30")
  const [location, setLocation] = React.useState("all")

  const groups = useLiveQuery(async () => {
    if (!lookups) return []
    const since = startOfDhakaDay(addDaysISO(today, -Number(days) + 1))
    const rows = (await db.jobConsumptions.where("at").aboveOrEqual(since).toArray()).filter((r) => location === "all" || r.locationId === location)
    const lineIds = [...new Set(rows.map((r) => r.orderLineId).filter(Boolean) as Id[])]
    const taskIds = [...new Set(rows.map((r) => r.taskId).filter(Boolean) as Id[])]
    const [lines, tasks, services] = await Promise.all([db.salesOrderLines.bulkGet(lineIds), db.jobTasks.bulkGet(taskIds), db.services.toArray()])
    const lineById = new Map(lines.filter(Boolean).map((l) => [l!.id, l!]))
    const taskById = new Map(tasks.filter(Boolean).map((tk) => [tk!.id, tk!]))
    const serviceById = new Map(services.map((sv) => [sv.id, sv]))
    const out = new Map<string, Group>()
    for (const r of rows) {
      let groupId: string
      let label: string
      if (by === "service") {
        const line = r.orderLineId ? lineById.get(r.orderLineId) : undefined
        const service = line?.kind === "service" ? serviceById.get(line.refId) : undefined
        groupId = service?.id ?? "other"
        label = service ? nameOf(service, locale) : line ? (locale === "bn" ? line.descriptionBn : line.descriptionEn) : t("ic.consumption.unknownService")
      } else {
        const task = r.taskId ? taskById.get(r.taskId) : undefined
        const userId = task?.technicianId ?? r.by
        groupId = userId
        label = userName(lookups.users.get(userId), locale) || userId
      }
      const key = `${groupId}:${r.itemId}`
      const g = out.get(key) ?? { key, label, item: lookups.items.get(r.itemId), jobs: new Set<Id>(), standard: 0, actual: 0, valueP: 0, standardValueP: 0 }
      g.jobs.add(r.orderId)
      g.standard = roundQty(g.standard + r.standardQty)
      g.actual = roundQty(g.actual + r.actualQty)
      g.valueP += r.valueP
      g.standardValueP += r.actualQty !== 0 ? Math.round((r.valueP * r.standardQty) / r.actualQty) : 0
      out.set(key, g)
    }
    return [...out.values()].sort((a, b) => Math.abs(b.valueP - b.standardValueP) - Math.abs(a.valueP - a.standardValueP) || a.label.localeCompare(b.label))
  }, [db, lookups, by, days, location, today, locale])

  const rows = groups ?? []

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("ic.consumption.title")} subtitle={t("ic.consumption.subtitle")} />
      <SectionCard title={t("ic.consumption.title")}>
        <div className="flex flex-col gap-4">
          <ListToolbar
            actions={
              <ExportCsvButton
                permission="ic.export"
                fileName="consumption-variance"
                columns={[
                  { key: "group", label: by === "service" ? t("ic.consumption.service") : t("ic.consumption.technician") },
                  { key: "sku", label: "SKU" },
                  { key: "jobs", label: t("ic.consumption.jobs") },
                  { key: "standard", label: t("ic.consumption.standard") },
                  { key: "actual", label: t("ic.consumption.actual") },
                  { key: "variance", label: t("ic.consumption.variance") },
                  { key: "varianceP", label: t("ic.consumption.varianceValue") },
                ]}
                rows={() =>
                  rows.map((g) => ({
                    group: g.label,
                    sku: g.item?.sku ?? "",
                    jobs: g.jobs.size,
                    standard: g.standard,
                    actual: g.actual,
                    variance: roundQty(g.actual - g.standard),
                    varianceP: g.valueP - g.standardValueP,
                  }))
                }
              />
            }
          >
            <OptionSelect
              value={by}
              onChange={setBy}
              label={t("ic.consumption.by")}
              testId="consumption-by"
              options={[
                { value: "service", label: `${t("ic.consumption.by")}: ${t("ic.consumption.byService")}` },
                { value: "technician", label: `${t("ic.consumption.by")}: ${t("ic.consumption.byTechnician")}` },
              ]}
            />
            <OptionSelect
              value={days}
              onChange={setDays}
              label={t("ic.consumption.period")}
              options={["7", "30"].map((d) => ({ value: d, label: t("ic.consumption.lastDays", { count: num(Number(d)) }) }))}
            />
            <LocationSelect value={location} onChange={setLocation} locations={(lookups?.stockLocations ?? []).filter((l) => l.kind === "studio")} />
          </ListToolbar>
          {rows.length ? (
            <LinesTable
              head={[
                { label: by === "service" ? t("ic.consumption.service") : t("ic.consumption.technician") },
                { label: t("ic.consumption.item") },
                { label: t("ic.consumption.jobs"), align: "right", hide: "lg" },
                { label: t("ic.consumption.standard"), align: "right", hide: "sm" },
                { label: t("ic.consumption.actual"), align: "right" },
                { label: t("ic.consumption.variance"), align: "right" },
                { label: t("ic.consumption.variancePct"), align: "right", hide: "md" },
                { label: t("ic.consumption.varianceValue"), align: "right", hide: "sm" },
              ]}
            >
              {rows.map((g) => {
                const variance = roundQty(g.actual - g.standard)
                const varianceP = g.valueP - g.standardValueP
                return (
                  <tr key={g.key} data-testid="consumption-row">
                    <td className="max-w-48 truncate">{g.label}</td>
                    <td>
                      <ItemCell item={g.item} />
                    </td>
                    <td className={cn("text-right nums", HIDE.lg)}>{num(g.jobs.size)}</td>
                    <td className={cn("text-right", HIDE.sm)}>
                      <QtyText value={g.standard} uom={g.item?.baseUom} />
                    </td>
                    <td className="text-right">
                      <QtyText value={g.actual} uom={g.item?.baseUom} />
                    </td>
                    <td className={cn("text-right", variance > 0 ? "text-destructive" : variance < 0 ? "text-success" : "text-muted-foreground")}>
                      {variance ? <QtyText value={variance} signed /> : "0"}
                    </td>
                    <td className={cn("text-right nums", HIDE.md)}>{g.standard ? pct((variance / g.standard) * 100) : "-"}</td>
                    <td className={cn("text-right", HIDE.sm)}>{varianceP ? <MoneyText poisha={varianceP} signed colorize /> : "-"}</td>
                  </tr>
                )
              })}
            </LinesTable>
          ) : (
            <p className="py-8 text-center text-[0.8125rem] text-muted-foreground">{t("ic.consumption.empty")}</p>
          )}
        </div>
      </SectionCard>
    </div>
  )
}
