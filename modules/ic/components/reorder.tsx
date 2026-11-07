"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { ArrowLeftRight, FilePlus2 } from "lucide-react"
import { toast } from "sonner"

import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useDb } from "@/core/db/DbProvider"
import { useCommand } from "@/core/engine/useCommand"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { requestTransfer } from "@/modules/st/commands"

import { raiseReorderPr } from "../commands"
import { loadReorderSuggestions } from "../queries"
import { HIDE, ItemCell, LinesTable, ListToolbar, LocationSelect, QtyText, freshKey, useScmLookups } from "./scm-ui"

/** /ic/reorder: suggestions per location to a requisition (ic.raiseReorderPr) or, for a studio, a transfer request from the Central Store. */
export function ReorderScreen() {
  const db = useDb()
  const router = useRouter()
  const { t, locale, num } = useLocale()
  const { can } = usePermissions()
  const lookups = useScmLookups()
  const raise = useCommand(raiseReorderPr)
  const request = useCommand(requestTransfer)
  const [location, setLocation] = React.useState("all")
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const suggestions = useLiveQuery(() => loadReorderSuggestions(db), [db])
  const rows = (suggestions ?? []).filter((s) => location === "all" || s.location.id === location)
  const picked = rows.filter((r) => selected.has(r.key))
  const pickedLocations = [...new Set(picked.map((r) => r.location.id))]
  const one = pickedLocations.length === 1 ? pickedLocations[0] : null
  const oneLocation = one ? lookups?.locations.get(one) : undefined
  const central = lookups?.stockLocations.find((l) => l.kind === "store")

  const toggle = (key: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("ic.reorder.title")} subtitle={t("ic.reorder.subtitle")} />
      <SectionCard
        title={t("ic.reorder.title")}
        action={picked.length ? <span className="nums text-xs text-muted-foreground">{t("ic.reorder.selected", { count: num(picked.length) })}</span> : undefined}
      >
        <div className="flex flex-col gap-4">
          <ListToolbar
            actions={
              <>
                {oneLocation && oneLocation.kind === "studio" && central && can("st.transfer.request", oneLocation.id) ? (
                  <Button
                    variant="outline"
                    disabled={request.pending}
                    data-testid="reorder-request-transfer"
                    onClick={async () => {
                      const out = await request.run({
                        fromLocationId: central.id,
                        toLocationId: oneLocation.id,
                        lines: picked.map((r) => ({ itemId: r.item.id, qtyBase: r.needBase })),
                        idempotencyKey: freshKey(),
                      })
                      if (out) {
                        toast.success(t("ic.reorder.requested", { no: out.transferNo }))
                        router.push(`/st/transfers/${out.id}`)
                      }
                    }}
                  >
                    <ArrowLeftRight />
                    {t("ic.reorder.requestTransfer")}
                  </Button>
                ) : null}
                {one && can("ptl.pr.create", one) ? (
                  <Button
                    disabled={raise.pending}
                    data-testid="reorder-raise-pr"
                    onClick={async () => {
                      const out = await raise.run({
                        locationId: one,
                        lines: picked.map((r) => ({ itemId: r.item.id, qty: r.suggestQty, estUnitCostP: r.estUnitCostP, suggestedVendorId: r.vendorId })),
                        idempotencyKey: freshKey(),
                      })
                      if (out) {
                        toast.success(t("ic.reorder.raised", { no: out.prNo }))
                        router.push(`/ptl/requisitions/${out.id}`)
                      }
                    }}
                  >
                    <FilePlus2 />
                    {t("ic.reorder.raisePr")}
                  </Button>
                ) : pickedLocations.length > 1 ? (
                  <span className="text-xs text-warning">{t("ic.reorder.onlyOneLocation")}</span>
                ) : null}
              </>
            }
          >
            <LocationSelect
              value={location}
              onChange={(v) => {
                setLocation(v)
                setSelected(new Set())
              }}
              locations={lookups?.stockLocations ?? []}
            />
          </ListToolbar>
          {rows.length ? (
            <LinesTable
              head={[
                { label: "", className: "w-10" },
                { label: t("ic.reorder.item") },
                { label: t("ic.reorder.location"), hide: "md" },
                { label: t("ic.reorder.onHand"), align: "right" },
                { label: t("ic.reorder.coming"), align: "right", hide: "lg" },
                { label: t("ic.reorder.min"), align: "right", hide: "sm" },
                { label: t("ic.reorder.max"), align: "right", hide: "lg" },
                { label: t("ic.reorder.suggest"), align: "right" },
                { label: t("ic.reorder.estCost"), align: "right", hide: "md" },
                { label: t("ic.reorder.vendor"), hide: "lg" },
              ]}
            >
              {rows.map((r) => (
                <tr key={r.key} data-testid="reorder-suggestion" data-sku={r.item.sku} data-location={r.location.code} className={cn(selected.has(r.key) && "bg-primary-soft")}>
                  <td>
                    <Checkbox checked={selected.has(r.key)} onCheckedChange={(v) => toggle(r.key, !!v)} aria-label={r.item.sku} data-testid="reorder-select" />
                  </td>
                  <td>
                    <ItemCell item={r.item} href={`/ic/items/${r.item.id}?location=${r.location.id}`} />
                  </td>
                  <td className={HIDE.md}>{nameOf(r.location, locale)}</td>
                  <td className="text-right">
                    <QtyText value={r.qtyBase} uom={r.item.baseUom} className={r.qtyBase <= 0 ? "text-destructive" : "text-warning"} />
                  </td>
                  <td className={cn("text-right", HIDE.lg)}>{r.inTransitQty + r.onOrderQty > 0 ? <QtyText value={r.inTransitQty + r.onOrderQty} /> : "-"}</td>
                  <td className={cn("text-right", HIDE.sm)}>
                    <QtyText value={r.minQty} />
                  </td>
                  <td className={cn("text-right", HIDE.lg)}>
                    <QtyText value={r.maxQty} />
                  </td>
                  <td className="text-right font-semibold">
                    <QtyText value={r.suggestQty} uom={r.item.purchaseUom} />
                  </td>
                  <td className={cn("text-right", HIDE.md)}>
                    <MoneyText poisha={Math.round(r.suggestQty * r.estUnitCostP)} />
                  </td>
                  <td className={HIDE.lg}>{r.vendorId ? nameOf(lookups?.vendors.get(r.vendorId), locale) : <span className="text-muted-foreground">{t("ic.reorder.noVendor")}</span>}</td>
                </tr>
              ))}
            </LinesTable>
          ) : (
            <p className="py-8 text-center text-[0.8125rem] text-muted-foreground">{t("ic.reorder.empty")}</p>
          )}
        </div>
      </SectionCard>
    </div>
  )
}
