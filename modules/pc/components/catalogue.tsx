"use client"

import * as React from "react"
import Link from "next/link"
import { Boxes, Layers, PlusCircle, Tag } from "lucide-react"

import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { VEHICLE_CLASSES, type ServiceCategory } from "@/core/db/schema"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { effectiveList, listInForce, promotionApplies, servicePrice, serviceDuration } from "../pricing"
import { useCatalogue } from "../queries"

export const CATEGORIES: ServiceCategory[] = ["wash", "interior", "paint", "protection", "glass", "wheel", "engine", "restoration"]
const LIST_CODES = ["RETAIL", "FLEET", "DEALER"] as const

/**
 * /pc: the service catalogue by category with the price matrix by vehicle
 * class on the chosen list (RETAIL, FLEET or DEALER, as in force today),
 * durations and warranties; add-ons below. Each service opens its detail.
 */
export function CataloguePage() {
  const { t, tk, locale, num } = useLocale()
  const catalogue = useCatalogue()
  const today = dhakaDate(now())
  const [code, setCode] = React.useState<(typeof LIST_CODES)[number]>("RETAIL")
  const listRow = catalogue?.priceLists.find((l) => l.code === code && listInForce(l, today))
  const list = catalogue ? effectiveList(catalogue, listRow?.id, today) : undefined
  const services = [...(catalogue?.services.values() ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)
  const activePromos = [...(catalogue?.promotions.values() ?? [])].filter((p) => promotionApplies(p, today, Number.MAX_SAFE_INTEGER)).length

  return (
    <div className="flex flex-col gap-4" data-testid="pc-catalogue">
      <PageHeader
        title={t("pc.pages.home")}
        subtitle={t("pc.catalogue.subtitle")}
        actions={
          <Select value={code} onValueChange={(v) => v && setCode(v as typeof code)}>
            <SelectTrigger className="min-w-48" data-testid="matrix-list">
              <SelectValue>{() => (list ? nameOf(list, locale) : code)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {LIST_CODES.map((c) => (
                <SelectItem key={c} value={c}>
                  <span lang="en" className="font-mono">{c}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <KpiGrid>
        <KpiCard variant="cyan" icon={Boxes} title={t("pc.catalogue.kpiServices")} value={num(services.filter((s) => s.active).length)} />
        <KpiCard variant="yellow" icon={Layers} title={t("pc.catalogue.kpiPackages")} value={num([...(catalogue?.packages.values() ?? [])].filter((p) => p.active).length)} href="/pc/packages" />
        <KpiCard variant="pink" icon={PlusCircle} title={t("pc.catalogue.kpiAddOns")} value={num([...(catalogue?.addOns.values() ?? [])].filter((a) => a.active).length)} href="/pc/packages" />
        <KpiCard variant="purple" icon={Tag} title={t("pc.catalogue.kpiPromotions")} value={num(activePromos)} href="/pc/promotions" />
      </KpiGrid>
      <section className="surface-card @container/matrix flex flex-col gap-4 p-4" data-testid="price-matrix" data-list={code}>
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[1.0625rem] font-semibold">{t("pc.catalogue.matrix")}</h2>
          <span className="text-xs text-muted-foreground">{t("pc.catalogue.matrixHint")}</span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-[0.8125rem]">
            <thead>
              <tr className="text-left">
                <th className="rounded-l-md bg-surface-raised px-3 py-2 font-medium">{t("common.service")}</th>
                <th className="hidden bg-surface-raised px-3 py-2 font-medium @min-[52rem]/matrix:table-cell">{t("pc.catalogue.duration")}</th>
                <th className="hidden bg-surface-raised px-3 py-2 font-medium @min-[44rem]/matrix:table-cell">{t("pc.catalogue.warranty")}</th>
                {VEHICLE_CLASSES.map((c, i) => (
                  <th key={c} className={cn("bg-surface-raised px-3 py-2 text-right font-medium", i === VEHICLE_CLASSES.length - 1 && "rounded-r-md")} title={tk(`reports.enum.vehicleClass.${c}`)}>
                    <span lang="en" className="font-mono">{c}</span>
                  </th>
                ))}
              </tr>
            </thead>
            {CATEGORIES.map((cat) => {
              const rows = services.filter((s) => s.category === cat)
              if (!rows.length) return null
              return (
                <tbody key={cat}>
                  <tr>
                    <td colSpan={8} className="px-3 pt-4 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {tk(`reports.enum.category.${cat}`)}
                    </td>
                  </tr>
                  {rows.map((s) => (
                    <tr key={s.id} className={cn("hover:bg-primary-soft", !s.active && "opacity-50")} data-testid="matrix-row" data-code={s.code}>
                      <td className="border-b border-hairline px-3 py-2">
                        <Link href={`/pc/services/${s.id}`} className="font-medium text-link hover:underline">
                          {nameOf(s, locale)}
                        </Link>
                        <div lang="en" className="font-mono text-xs text-muted-foreground">{s.code}</div>
                      </td>
                      <td className="hidden border-b border-hairline px-3 py-2 nums text-muted-foreground @min-[52rem]/matrix:table-cell">
                        {catalogue ? t("stl.quote.minutes", { min: num(serviceDuration(catalogue, s.id, "SD")) }) : null}
                      </td>
                      <td className="hidden border-b border-hairline px-3 py-2 text-muted-foreground @min-[44rem]/matrix:table-cell">
                        {s.warrantyMonths ? t("pc.catalogue.months", { count: num(s.warrantyMonths) }) : "-"}
                      </td>
                      {VEHICLE_CLASSES.map((c) => (
                        <td key={c} className="border-b border-hairline px-3 py-2 text-right font-mono" data-testid="matrix-price" data-class={c}>
                          {catalogue ? <MoneyText poisha={servicePrice(catalogue, list, s.id, c)} /> : null}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              )
            })}
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{t("pc.catalogue.vatNote")}</p>
      </section>
      <SectionCard title={t("pc.catalogue.addOns")} icon={PlusCircle} size="sm">
        <ul className="grid gap-2 sm:grid-cols-2">
          {[...(catalogue?.addOns.values() ?? [])].map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 rounded-md bg-surface-raised/60 px-3 py-2 text-[0.8125rem]">
              <span className="min-w-0">
                <span className="block truncate font-medium">{nameOf(a, locale)}</span>
                <span className="text-xs text-muted-foreground">{a.appliesTo.map((c) => tk(`reports.enum.category.${c}`)).join(", ")}</span>
              </span>
              <MoneyText poisha={a.priceP} className="font-mono" />
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  )
}
