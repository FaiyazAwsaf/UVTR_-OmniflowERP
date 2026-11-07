"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import { StockBadge } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText } from "@/components/shared/status"
import { rules } from "@/config/rules.config"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { BatchRow, ItemRow, LocationRow } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { HIDE, ItemCell, LinesTable, ListToolbar, LocationSelect, OptionSelect, QtyText, RowLink, useScmLookups } from "./scm-ui"

type ExpiryRow = { key: string; batch: BatchRow; item: ItemRow; location: LocationRow; qty: number; quarantined: number; valueP: number; days: number }

/** /ic/expiry: the FEFO watch, batches with stock by expiry; expired batches are unusable and written off by adjustment. */
export function ExpiryWatch() {
  const db = useDb()
  const { t, tk, locale, dmy, num } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const nowMs = useNow(60_000)
  const today = dhakaDate(nowMs)
  const [location, setLocation] = React.useState("all")
  const [span, setSpan] = React.useState(String(rules.expiryWarnDays))

  const rows = useLiveQuery(async () => {
    if (!lookups) return []
    const cutoff = span === "all" ? "9999-12-31" : addDaysISO(today, Number(span))
    const batches = (await db.batches.where("expiry").belowOrEqual(cutoff).toArray()).filter((b) => b.expiry)
    const out: ExpiryRow[] = []
    for (const batch of batches) {
      for (const balance of await db.stockBalances.where("batchId").equals(batch.id).toArray()) {
        const qty = balance.qtyBase + balance.quarantinedQty
        if (qty <= 0) continue
        const item = lookups.items.get(balance.itemId)
        const loc = lookups.locations.get(balance.locationId)
        if (!item || !loc) continue
        const value = await db.stockValues.get(`sv:${item.id}:${loc.id}`)
        out.push({
          key: balance.id,
          batch,
          item,
          location: loc,
          qty: balance.qtyBase,
          quarantined: balance.quarantinedQty,
          valueP: value && value.qtyBase > 0 ? Math.round((balance.qtyBase * value.valueP) / value.qtyBase) : 0,
          days: Math.round((Date.parse(batch.expiry!) - Date.parse(today)) / 86_400_000),
        })
      }
    }
    return out.sort((a, b) => a.batch.expiry!.localeCompare(b.batch.expiry!))
  }, [db, lookups, span, today])

  const shown = (rows ?? []).filter((r) => location === "all" || r.location.id === location)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("ic.expiry.title")} subtitle={t("ic.expiry.subtitle")} />
      <SectionCard title={t("ic.expiry.title")}>
        <div className="flex flex-col gap-4">
          <ListToolbar>
            <LocationSelect value={location} onChange={setLocation} locations={lookups?.stockLocations ?? []} />
            <OptionSelect
              value={span}
              onChange={setSpan}
              label={t("ic.expiry.window")}
              testId="expiry-window"
              options={[
                ...["30", "60", "90", "180"].map((d) => ({ value: d, label: `${t("ic.expiry.window")} ${t("ic.expiry.within", { count: num(Number(d)) })}` })),
                { value: "all", label: t("ic.expiry.allBatches") },
              ]}
            />
          </ListToolbar>
          {shown.length ? (
            <LinesTable
              head={[
                { label: t("ic.expiry.item") },
                { label: t("ic.expiry.batch") },
                { label: t("ic.expiry.location"), hide: "md" },
                { label: t("ic.expiry.qty"), align: "right" },
                { label: t("ic.ui.value"), align: "right", hide: "lg" },
                { label: t("ic.expiry.expiry") },
                { label: t("ic.expiry.daysLeft"), align: "right", hide: "sm" },
                { label: t("ic.expiry.status") },
                { label: "" },
              ]}
            >
              {shown.map((r) => {
                const expired = r.days < 0 || r.batch.status === "expired"
                return (
                  <tr key={r.key} data-testid="expiry-row" data-sku={r.item.sku} data-batch={r.batch.batchNo}>
                    <td>
                      <ItemCell item={r.item} href={`/ic/items/${r.item.id}?location=${r.location.id}`} />
                    </td>
                    <td lang="en" className="font-mono text-xs whitespace-nowrap">
                      {r.batch.batchNo}
                    </td>
                    <td className={HIDE.md}>{nameOf(r.location, locale)}</td>
                    <td className="text-right">
                      <QtyText value={r.qty} uom={r.item.baseUom} />
                      {r.quarantined > 0 ? <span className="block text-[0.6875rem] text-muted-foreground">+{num(r.quarantined)}</span> : null}
                    </td>
                    <td className={cn("text-right", HIDE.lg)}>
                      <MoneyText poisha={r.valueP} />
                    </td>
                    <td className="nums">{dmy(r.batch.expiry!)}</td>
                    <td className={cn("text-right nums", HIDE.sm, expired ? "text-destructive" : r.days <= 30 ? "text-warning" : "")}>
                      {expired ? t("ic.expiry.expiredDays", { count: num(Math.abs(r.days)) }) : num(r.days)}
                    </td>
                    <td>
                      {expired ? (
                        <StatusText tone="destructive" dot>
                          {tk("shared.status.expired")}
                        </StatusText>
                      ) : r.quarantined > 0 && r.qty <= 0 ? (
                        <StockBadge status="quarantine" />
                      ) : r.days <= rules.expiryWarnDays ? (
                        <StockBadge status="expiring" />
                      ) : (
                        <StockBadge status="ok" />
                      )}
                    </td>
                    <td className="text-right">
                      {r.qty > 0 && can("st.adjust.create", r.location.id) ? (
                        <RowLink href={`/st/adjustments?new=expiry&location=${r.location.id}&item=${r.item.id}&batch=${r.batch.id}&qty=${r.qty}`} testId="expiry-write-off">
                          {t("ic.expiry.writeOff")}
                        </RowLink>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </LinesTable>
          ) : (
            <p className="py-8 text-center text-[0.8125rem] text-muted-foreground">{t("ic.expiry.empty")}</p>
          )}
        </div>
      </SectionCard>
    </div>
  )
}
