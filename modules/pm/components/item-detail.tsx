"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import {
  Barcode as BarcodeIcon,
  Boxes,
  Layers,
  Pencil,
  Printer,
  Ruler,
  Tags,
} from "lucide-react"
import { toast } from "sonner"

import { Barcode } from "@/components/shared/barcode"
import { StockBadge } from "@/components/shared/doc-status"
import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { QtyInput } from "@/components/shared/money-input"
import { PrintLayout } from "@/components/shared/print-layout"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText } from "@/components/shared/status"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { tenant } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import type { Id, LocationRow, ReorderRuleRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import {
  Field,
  HIDE,
  LinesTable,
  NotFound,
  PrintPreview,
  QtyText,
} from "@/modules/ic/components/scm-ui"
import { stockStatus } from "@/modules/ic/queries"

import { saveReorderRule } from "../commands"
import { ItemFormDialog } from "./item-form"

/** /pm/items/[id]: units and conversions, batches and shelf life, reorder rules per location, costs, price, VAT, barcode labels, stock by location. */
export function ItemDetail({ id }: { id: string }) {
  const db = useDb()
  const { t, tk, locale, num, dmy, unit } = useLocale()
  const canEdit = useCan("pm.item.edit")
  const canRule = useCan("pm.reorder.edit")
  const [editing, setEditing] = React.useState(false)
  const [labels, setLabels] = React.useState(false)
  const [copies, setCopies] = React.useState<number | null>(12)
  const [rule, setRule] = React.useState<{
    location: LocationRow
    current?: ReorderRuleRow
  } | null>(null)

  const data = useLiveQuery(async () => {
    const item = await db.items.get(id)
    if (!item) return { item: undefined }
    const [category, locations, values, rules, balances] = await Promise.all([
      db.itemCategories.get(item.categoryId),
      db.locations.toArray(),
      db.stockValues.where("itemId").equals(id).toArray(),
      db.reorderRules.where("itemId").equals(id).toArray(),
      db.stockBalances.where("itemId").equals(id).toArray(),
    ])
    const batchIds = [
      ...new Set(balances.map((b) => b.batchId).filter(Boolean) as Id[]),
    ]
    const batches = new Map(
      (await db.batches.bulkGet(batchIds))
        .filter(Boolean)
        .map((b) => [b!.id, b!])
    )
    return { item, category, locations, values, rules, balances, batches }
  }, [db, id])

  if (data === undefined) return null
  if (!data.item)
    return (
      <NotFound
        title={t("pm.item.notFound")}
        backHref="/pm"
        backLabel={t("pm.item.back")}
      />
    )
  const { item, category, locations, values, rules, balances, batches } = data
  const stockLocations = locations
    .filter((l) => l.isStockLocation)
    .sort((a, b) =>
      a.kind === "store"
        ? -1
        : b.kind === "store"
          ? 1
          : a.code.localeCompare(b.code)
    )
  const locName = (lid: Id) =>
    nameOf(
      locations.find((l) => l.id === lid),
      locale
    )
  const onHandBatches = balances.filter(
    (b) => b.qtyBase > 0 || b.quarantinedQty > 0
  )

  return (
    <div className="flex flex-col gap-5" data-testid="item-detail">
      <section className="surface-card flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <span className="text-xs text-muted-foreground">
            {t("pm.item.kindLabel")}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">{nameOf(item, locale)}</h1>
            <StatusText
              tone={item.status === "active" ? "success" : "muted"}
              dot
            >
              {tk(`shared.status.${item.status}`)}
            </StatusText>
          </div>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            <span lang="en" className="font-mono">
              {item.sku}
            </span>{" "}
            · {nameOf(category, locale)} · {tk(`pm.kind.${item.kind}`)}
            {item.brand ? ` · ${item.brand}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <Button
              variant="outline"
              onClick={() => setEditing(true)}
              data-testid="item-edit"
            >
              <Pencil />
              {t("pm.item.edit")}
            </Button>
          ) : null}
          <Button
            variant="neutral"
            onClick={() => setLabels(true)}
            data-testid="barcode-print"
          >
            <Printer />
            {t("pm.item.printLabels")}
          </Button>
          <Link
            href={`/ic/items/${item.id}`}
            className={buttonVariants({ variant: "neutral" })}
          >
            <Layers />
            {t("pm.item.stockCard")}
          </Link>
        </div>
      </section>

      <div className="@container/cards">
        <div className="grid gap-5 @min-[52rem]/cards:grid-cols-2">
          <SectionCard title={t("pm.item.units")} icon={Ruler}>
            <KeyValueGrid
              items={[
                {
                  label: t("pm.item.baseUnit"),
                  value: item.baseUom,
                  mono: true,
                },
                {
                  label: t("pm.item.purchaseUnit"),
                  value: t("pm.item.conversion", {
                    unit: unit(item.purchaseUom),
                    qty: num(item.purchaseFactor),
                    base: unit(item.baseUom),
                  }),
                },
                {
                  label: t("pm.item.salesUnit"),
                  value: item.salesUom
                    ? t("pm.item.conversion", {
                        unit: unit(item.salesUom),
                        qty: num(item.salesFactor ?? 1),
                        base: unit(item.baseUom),
                      })
                    : t("pm.item.noSalesUnit"),
                  wide: true,
                },
                {
                  label: t("pm.item.trackBatch"),
                  value: item.trackBatch
                    ? t("pm.item.tracked")
                    : t("pm.item.notTracked"),
                },
                {
                  label: t("pm.item.shelfLife"),
                  value: item.shelfLifeDays
                    ? t("pm.item.days", { count: num(item.shelfLifeDays) })
                    : "-",
                },
              ]}
            />
          </SectionCard>
          <SectionCard
            title={t("pm.item.costs")}
            icon={Tags}
            action={
              <span className="text-xs text-muted-foreground">
                {t("pm.item.demoValues")}
              </span>
            }
          >
            <KeyValueGrid
              items={[
                {
                  label: t("pm.item.standardCost", {
                    unit: unit(item.purchaseUom),
                  }),
                  value: <MoneyText poisha={item.standardCostP} />,
                },
                {
                  label: t("pm.item.retailPrice", {
                    unit: unit(item.salesUom ?? item.baseUom),
                  }),
                  value:
                    item.retailPriceP !== undefined ? (
                      <MoneyText poisha={item.retailPriceP} />
                    ) : (
                      "-"
                    ),
                },
                {
                  label: t("pm.item.vatCategory"),
                  value: tk(`pm.vat.${item.vatCategory}`),
                },
                ...stockLocations.map((l) => {
                  const v = values.find((x) => x.locationId === l.id)
                  return {
                    label: t("pm.item.movingAverage", {
                      location: l.code,
                      unit: unit(item.purchaseUom),
                    }),
                    value:
                      v && v.qtyBase > 0 ? (
                        <MoneyText
                          poisha={Math.round(
                            (v.valueP / v.qtyBase) * item.purchaseFactor
                          )}
                        />
                      ) : (
                        t("pm.item.noStock")
                      ),
                  }
                }),
              ]}
            />
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title={t("pm.item.stockByLocation")}
        icon={Boxes}
        subtitle={t("pm.item.reorderRules")}
      >
        <LinesTable
          head={[
            { label: t("pm.item.location") },
            { label: t("pm.item.onHand"), align: "right" },
            { label: t("pm.item.value"), align: "right", hide: "sm" },
            { label: t("pm.item.min"), align: "right" },
            { label: t("pm.item.max"), align: "right", hide: "sm" },
            { label: t("pm.item.reorderQty"), align: "right", hide: "md" },
            { label: t("pm.item.status") },
            { label: "" },
          ]}
        >
          {stockLocations.map((l) => {
            const v = values.find((x) => x.locationId === l.id)
            const r = rules.find((x) => x.locationId === l.id)
            const qty = v?.qtyBase ?? 0
            return (
              <tr key={l.id} data-testid="reorder-rule" data-location={l.code}>
                <td>
                  {nameOf(l, locale)}{" "}
                  <span
                    lang="en"
                    className="font-mono text-xs text-muted-foreground"
                  >
                    {l.code}
                  </span>
                </td>
                <td className="text-right">
                  <QtyText value={qty} uom={item.baseUom} />
                </td>
                <td className={cn("text-right", HIDE.sm)}>
                  <MoneyText poisha={v?.valueP ?? 0} />
                </td>
                <td className="text-right">
                  {r ? (
                    <QtyText value={r.minQty} />
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td className={cn("text-right", HIDE.sm)}>
                  {r ? <QtyText value={r.maxQty} /> : "-"}
                </td>
                <td className={cn("text-right", HIDE.md)}>
                  {r ? <QtyText value={r.reorderQty} /> : "-"}
                </td>
                <td>
                  <StockBadge status={stockStatus(qty, r?.minQty)} />
                </td>
                <td className="text-right">
                  {canRule ? (
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => setRule({ location: l, current: r })}
                      data-testid="reorder-rule-edit"
                    >
                      {r ? t("pm.item.editRule") : t("pm.item.addRule")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </LinesTable>
      </SectionCard>

      <div className="@container/cards2">
        <div className="grid gap-5 @min-[52rem]/cards2:grid-cols-[minmax(0,1fr)_20rem]">
          <SectionCard title={t("pm.item.batchList")} icon={Layers}>
            {onHandBatches.length ? (
              <LinesTable
                head={[
                  { label: t("pm.item.batchNo") },
                  { label: t("pm.item.location") },
                  { label: t("pm.item.expiry"), hide: "sm" },
                  { label: t("pm.item.onHand"), align: "right" },
                  { label: t("pm.item.status") },
                ]}
              >
                {onHandBatches.map((b) => {
                  const batch = b.batchId ? batches.get(b.batchId) : undefined
                  const status =
                    b.quarantinedQty > 0
                      ? "quarantine"
                      : batch?.status === "expired"
                        ? "expired"
                        : "ok"
                  return (
                    <tr key={b.id}>
                      <td lang="en" className="font-mono text-xs">
                        {batch?.batchNo ?? t("ic.ui.noBatch")}
                      </td>
                      <td>{locName(b.locationId)}</td>
                      <td className={HIDE.sm}>
                        {batch?.expiry ? dmy(batch.expiry) : "-"}
                      </td>
                      <td className="text-right">
                        <QtyText
                          value={b.qtyBase + b.quarantinedQty}
                          uom={item.baseUom}
                        />
                      </td>
                      <td>
                        {status === "expired" ? (
                          <StatusText tone="destructive" dot>
                            {tk("shared.status.expired")}
                          </StatusText>
                        ) : (
                          <StockBadge
                            status={
                              status === "quarantine" ? "quarantine" : "ok"
                            }
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </LinesTable>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">
                {t("pm.item.noBatches")}
              </p>
            )}
          </SectionCard>
          <SectionCard title={t("pm.item.barcode")} icon={BarcodeIcon}>
            <div className="flex flex-col items-center gap-3">
              <Barcode value={item.barcode || item.sku} />
              <span
                lang="en"
                className="font-mono text-xs text-muted-foreground"
              >
                {item.sku}
              </span>
            </div>
          </SectionCard>
        </div>
      </div>

      <ItemFormDialog open={editing} onOpenChange={setEditing} item={item} />
      <RuleDialog
        itemId={item.id}
        unit={item.baseUom}
        target={rule}
        onClose={() => setRule(null)}
        sku={item.sku}
      />
      <PrintPreview
        open={labels}
        onOpenChange={setLabels}
        title={t("pm.item.labelsTitle", { sku: item.sku })}
        docNo={item.sku}
      >
        <div className="mb-3 flex items-center gap-3 rounded bg-white/80 p-2 text-[#111]">
          <span className="text-xs">{t("pm.item.copies")}</span>
          <QtyInput
            value={copies}
            onChange={(v) =>
              setCopies(
                v === null ? null : Math.min(40, Math.max(1, Math.round(v)))
              )
            }
            className="w-24"
          />
        </div>
        <PrintLayout showBrand={false} demoFooter={false}>
          <div className="grid grid-cols-3 gap-2" data-testid="barcode-labels">
            {Array.from({ length: copies ?? 1 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col items-center gap-0.5 rounded border border-dashed border-[#999] p-2 text-center"
              >
                <span className="text-[0.625rem] font-semibold">
                  {tenant.shortName.en}
                </span>
                <span className="line-clamp-1 text-[0.6875rem]">
                  {item.nameEn}
                </span>
                <Barcode
                  value={item.barcode || item.sku}
                  height={34}
                  barWidth={1.2}
                  fontSize={10}
                  plate={false}
                />
                <span lang="en" className="font-mono text-[0.625rem]">
                  {item.sku}
                  {item.retailPriceP !== undefined
                    ? ` · Tk ${(item.retailPriceP / 100).toFixed(2)}`
                    : ""}
                </span>
              </div>
            ))}
          </div>
        </PrintLayout>
      </PrintPreview>
    </div>
  )
}

/** Edit one location's reorder rule (pm.saveReorderRule). */
function RuleDialog(props: {
  itemId: Id
  sku: string
  unit: string
  target: { location: LocationRow; current?: ReorderRuleRow } | null
  onClose: () => void
}) {
  return (
    <Dialog
      open={!!props.target}
      onOpenChange={(open) => !open && props.onClose()}
    >
      <DialogContent data-testid="reorder-rule-dialog">
        {props.target ? <RuleForm {...props} target={props.target} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function RuleForm({
  itemId,
  sku,
  unit,
  target,
  onClose,
}: {
  itemId: Id
  sku: string
  unit: string
  target: { location: LocationRow; current?: ReorderRuleRow }
  onClose: () => void
}) {
  const { t, locale } = useLocale()
  const save = useCommand(saveReorderRule)
  const [min, setMin] = React.useState<number | null>(
    target.current?.minQty ?? null
  )
  const [max, setMax] = React.useState<number | null>(
    target.current?.maxQty ?? null
  )
  const [reorder, setReorder] = React.useState<number | null>(
    target.current?.reorderQty ?? null
  )
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        const out = await save.run({
          itemId,
          locationId: target.location.id,
          minQty: min ?? 0,
          maxQty: max ?? 0,
          reorderQty: reorder ?? undefined,
          expectedVersion: target.current?.version,
        })
        if (out) {
          toast.success(t("pm.item.ruleSaved"))
          onClose()
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {t("pm.item.ruleTitle", {
            location: nameOf(target.location, locale),
          })}
        </DialogTitle>
        <DialogDescription>
          <span lang="en" className="font-mono">
            {sku}
          </span>{" "}
          · {t("pm.item.ruleHint", { unit })}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("pm.item.min")}>
          <QtyInput
            value={min}
            onChange={setMin}
            unit={unit}
            data-testid="rule-min"
          />
        </Field>
        <Field label={t("pm.item.max")}>
          <QtyInput
            value={max}
            onChange={setMax}
            unit={unit}
            data-testid="rule-max"
          />
        </Field>
        <Field label={t("pm.item.reorderQty")}>
          <QtyInput value={reorder} onChange={setReorder} unit={unit} />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={save.pending} data-testid="rule-save">
          {t("pm.item.saveRule")}
        </Button>
      </DialogFooter>
    </form>
  )
}
