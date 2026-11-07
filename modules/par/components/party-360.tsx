"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  AlertTriangle,
  Car,
  FileText,
  Pencil,
  Plus,
  ShieldOff,
  ShieldCheck,
  UserX,
} from "lucide-react"
import { toast } from "sonner"

import { PartyAvatar } from "@/components/shared/avatars"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { EmptyState } from "@/components/shared/empty-state"
import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { RegPlate } from "@/components/shared/reg-plate"
import { SectionCard } from "@/components/shared/section-card"
import { useSyncFlash } from "@/components/shell/use-sync-flash"
import { Button } from "@/components/ui/button"
import { useDb } from "@/core/db/DbProvider"
import type { Id, PartyRow, VehicleRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { rules } from "@/config/rules.config"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { billOpenP, daysPastDue, invoiceOpenP } from "@/modules/ar/lib"
import { accountIdOfTag } from "@/modules/ar/queries"

import { setPartyStatus } from "../commands"
import {
  Banner,
  LinkButton,
  ListTable,
  Stat,
  useToday,
  type Column,
} from "./kit"
import { PartyForm } from "./party-form"
import { ReasonDialog } from "./reason-dialog"
import { VehicleDialog } from "./vehicle-dialog"

type Tx360 = {
  key: string
  date: string
  docType: string
  docId: Id
  docNo: string
  amountP: number
  status: string
}

/** Everything about one party, live (plan §9 party 360). */
export function usePartyData(partyId: Id) {
  const db = useDb()
  return useLiveQuery(async () => {
    const party = await db.parties.get(partyId)
    if (!party) return null
    const [
      vehicles,
      invoices,
      receipts,
      refunds,
      creditNotes,
      orders,
      bills,
      payments,
      debitNotes,
      cheques,
      advId,
      priceList,
    ] = await Promise.all([
      db.vehicles.where("partyId").equals(partyId).toArray(),
      db.salesInvoices.where("partyId").equals(partyId).toArray(),
      db.receipts.where("partyId").equals(partyId).toArray(),
      db.customerRefunds.where("partyId").equals(partyId).toArray(),
      db.creditNotes.where("partyId").equals(partyId).toArray(),
      db.salesOrders.where("partyId").equals(partyId).toArray(),
      db.vendorBills.where("partyId").equals(partyId).toArray(),
      db.vendorPayments.where("partyId").equals(partyId).toArray(),
      db.debitNotes.where("partyId").equals(partyId).toArray(),
      db.cheques.where("partyId").equals(partyId).toArray(),
      accountIdOfTag(db, "CUSTOMER_ADVANCE"),
      party.priceListId ? db.priceLists.get(party.priceListId) : undefined,
    ])
    let advanceP = 0
    if (advId) {
      const lines = await db.journalLines
        .where("partyId")
        .equals(partyId)
        .toArray()
      for (const l of lines)
        if (l.accountId === advId) advanceP += l.creditP - l.debitP
    }
    return {
      party,
      vehicles,
      invoices,
      receipts,
      refunds,
      creditNotes,
      orders,
      bills,
      payments,
      debitNotes,
      cheques,
      advanceP,
      priceList,
    }
  }, [db, partyId])
}

/** /par/[id]: the party 360 (profile, contacts, tax IDs, credit, vehicles, balances, every transaction). */
export function Party360({ partyId }: { partyId: Id }) {
  const { t, tk, locale, num, dmy, colour } = useLocale()
  const { can } = usePermissions()
  const today = useToday()
  const data = usePartyData(partyId)
  const [editing, setEditing] = React.useState(false)
  const [statusTo, setStatusTo] = React.useState<PartyRow["status"] | null>(
    null
  )
  const [vehicleOpen, setVehicleOpen] = React.useState(false)
  const [vehicleEdit, setVehicleEdit] = React.useState<VehicleRow | undefined>(
    undefined
  )
  const setStatus = useCommand(setPartyStatus)

  const balances = React.useMemo(() => {
    if (!data) return null
    let arOpen = 0
    let overdue = 0
    for (const i of data.invoices) {
      const open = invoiceOpenP(i)
      if (open <= 0) continue
      arOpen += open
      if (today && daysPastDue(i.dueDate, today) > 0) overdue += open
    }
    const apOpen = data.bills
      .filter((b) => b.status !== "on-hold")
      .reduce((s, b) => s + Math.max(0, billOpenP(b)), 0)
    return { arOpen, overdue, apOpen }
  }, [data, today])
  const flash = useSyncFlash(
    balances
      ? `${balances.arOpen}|${balances.apOpen}|${data?.advanceP}|${data?.party.status}`
      : undefined
  )

  const txs = React.useMemo<Tx360[]>(() => {
    if (!data) return []
    const out: Tx360[] = []
    for (const i of data.invoices)
      out.push({
        key: i.id,
        date: i.date,
        docType: "salesInvoices",
        docId: i.id,
        docNo: i.invoiceNo,
        amountP: i.totalP,
        status: i.status,
      })
    for (const r of data.receipts)
      out.push({
        key: r.id,
        date: r.date,
        docType: "receipts",
        docId: r.id,
        docNo: r.receiptNo,
        amountP: r.amountP,
        status: r.status,
      })
    for (const r of data.refunds)
      out.push({
        key: r.id,
        date: r.date,
        docType: "customerRefunds",
        docId: r.id,
        docNo: r.refundNo,
        amountP: r.amountP,
        status: "paid",
      })
    for (const c of data.creditNotes)
      out.push({
        key: c.id,
        date: c.date,
        docType: "creditNotes",
        docId: c.id,
        docNo: c.creditNoteNo,
        amountP: c.totalP,
        status: c.status,
      })
    for (const o of data.orders)
      out.push({
        key: o.id,
        date: o.bookedOn ?? "",
        docType: "salesOrders",
        docId: o.id,
        docNo: o.orderNo,
        amountP: o.totalP,
        status: o.status,
      })
    for (const b of data.bills)
      out.push({
        key: b.id,
        date: b.date,
        docType: "vendorBills",
        docId: b.id,
        docNo: b.billNo,
        amountP: b.totalP,
        status: b.status,
      })
    for (const p of data.payments)
      out.push({
        key: p.id,
        date: p.date,
        docType: "vendorPayments",
        docId: p.id,
        docNo: p.paymentNo,
        amountP: p.grossP,
        status: p.status,
      })
    for (const d of data.debitNotes)
      out.push({
        key: d.id,
        date: d.date,
        docType: "debitNotes",
        docId: d.id,
        docNo: d.debitNoteNo,
        amountP: d.totalP,
        status: "posted",
      })
    for (const c of data.cheques)
      out.push({
        key: c.id,
        date: c.chequeDate,
        docType: "cheques",
        docId: c.id,
        docNo: c.chequeNo,
        amountP: c.amountP,
        status: c.status,
      })
    return out.sort((a, b) =>
      a.date < b.date
        ? 1
        : a.date > b.date
          ? -1
          : b.docNo.localeCompare(a.docNo)
    )
  }, [data])

  if (data === undefined) return null
  if (data === null) {
    return (
      <EmptyState
        icon={UserX}
        title={t("par.v360.notFound")}
        description={t("par.v360.notFoundHint")}
        action={{ label: t("par.v360.backToList"), href: "/par" }}
      />
    )
  }
  const { party } = data
  const canEdit =
    (party.isCustomer && can("par.customer.edit")) ||
    (party.isVendor && can("par.vendor.edit"))
  const canHold = can("par.party.hold")
  const creditAvail =
    party.creditLimitP > 0 && balances
      ? party.creditLimitP - balances.arOpen
      : null
  const address = party.addresses[0]

  if (editing) {
    return (
      <div
        className="flex flex-col gap-4"
        data-testid="party-360"
        data-editing="true"
      >
        <div className="flex items-center gap-3">
          <PartyAvatar party={party} size={40} />
          <div className="min-w-0">
            <h1 className="truncate text-[1.375rem] font-semibold">
              {nameOf(party, locale)}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("par.form.subtitleEdit")}
            </p>
          </div>
        </div>
        <PartyForm party={party} onDone={() => setEditing(false)} />
      </div>
    )
  }

  const txColumns: Column<Tx360>[] = [
    {
      key: "date",
      header: t("par.v360.colDate"),
      sortValue: (r) => r.date,
      cell: (r) => (r.date ? <span className="nums">{dmy(r.date)}</span> : "-"),
    },
    {
      key: "type",
      header: t("par.v360.colType"),
      hide: "sm",
      cell: (r) => (
        <span className="text-muted-foreground">
          {tk(`par.v360.docTypes.${r.docType}`)}
        </span>
      ),
    },
    {
      key: "doc",
      header: t("par.v360.colDocument"),
      cell: (r) => (
        <DocLink docType={r.docType} docId={r.docId} docNo={r.docNo} />
      ),
    },
    {
      key: "amount",
      header: t("par.v360.colAmount"),
      align: "right",
      sortValue: (r) => r.amountP,
      cell: (r) => <MoneyText poisha={r.amountP} className="font-mono" />,
    },
    {
      key: "status",
      header: t("par.v360.colStatus"),
      hide: "md",
      cell: (r) => <DocStatus status={r.status} />,
    },
  ]

  const held = party.status !== "active"

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="party-360"
      data-party-id={party.id}
      data-status={party.status}
    >
      <section className="surface-card flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-start gap-4">
          <PartyAvatar party={party} size={52} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1
                className="truncate text-[1.375rem] leading-tight font-semibold"
                data-testid="party-name"
              >
                {nameOf(party, locale)}
              </h1>
              <DocStatus status={party.status} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span lang="en" className="font-mono">
                {party.code}
              </span>
              <span>·</span>
              <span>{tk(`reports.enum.segment.${party.segment}`)}</span>
              <span>·</span>
              <span>
                {party.isCustomer && party.isVendor
                  ? t("par.list.both")
                  : party.isCustomer
                    ? t("par.form.customer")
                    : t("par.form.vendor")}
              </span>
              <span>·</span>
              <span
                lang="en"
                className="font-mono"
                data-testid="party-phone-text"
              >
                {party.phone}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {party.isCustomer && can("ar.receipt.create") ? (
              <LinkButton href={`/ar/receipts/new?party=${party.id}`} size="sm">
                <Plus />
                {t("par.v360.newReceipt")}
              </LinkButton>
            ) : null}
            {party.isVendor && can("ap.payment.create") ? (
              <LinkButton href={`/ap/payments/new?party=${party.id}`} size="sm">
                <Plus />
                {t("par.v360.newPayment")}
              </LinkButton>
            ) : null}
            {party.isCustomer && can("ar.app.view") ? (
              <LinkButton
                href={`/ar/statements/${party.id}`}
                size="sm"
                variant="neutral"
              >
                <FileText />
                {t("par.v360.statement")}
              </LinkButton>
            ) : null}
            {canEdit ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
                data-testid="party-edit"
              >
                <Pencil />
                {t("par.v360.edit")}
              </Button>
            ) : null}
            {canHold ? (
              held ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setStatusTo("active")}
                  data-testid="party-release"
                >
                  <ShieldCheck />
                  {t("par.v360.release")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="destructive-outline"
                  onClick={() => setStatusTo("on-hold")}
                  data-testid="party-hold"
                >
                  <ShieldOff />
                  {t("par.v360.hold")}
                </Button>
              )
            ) : null}
          </div>
        </div>
        {held ? (
          <Banner
            tone={party.status === "blocked" ? "destructive" : "warning"}
            icon={<AlertTriangle />}
            testId="credit-hold-banner"
          >
            <p className="font-medium">
              {t(
                party.status === "blocked"
                  ? "par.v360.blockedBanner"
                  : "par.v360.holdBanner",
                { reason: party.holdReason ?? "" }
              )}
            </p>
            {party.autoHoldAt ? (
              <p className="text-muted-foreground">
                {t("par.v360.autoHold", {
                  date: dmy(party.autoHoldAt),
                  days: num(rules.creditHoldOverdueDays),
                })}
              </p>
            ) : null}
          </Banner>
        ) : null}
        <div
          className={cn(
            "@container grid grid-cols-2 gap-4 rounded-lg bg-surface-raised/50 p-3 sm:grid-cols-3 lg:grid-cols-6",
            flash
          )}
          data-testid="party-balances"
        >
          {party.isCustomer ? (
            <>
              <Stat
                label={t("par.v360.arOpen")}
                value={<MoneyText poisha={balances?.arOpen ?? 0} />}
                testId="party-ar-open"
              />
              <Stat
                label={t("par.v360.overdue")}
                value={<MoneyText poisha={balances?.overdue ?? 0} />}
                tone={balances?.overdue ? "destructive" : undefined}
              />
              <Stat
                label={t("par.v360.advances")}
                value={<MoneyText poisha={data.advanceP} />}
                tone={data.advanceP ? "info" : undefined}
                testId="party-advance"
              />
              <Stat
                label={t("par.v360.creditLimit")}
                value={
                  party.creditLimitP ? (
                    <MoneyText poisha={party.creditLimitP} />
                  ) : (
                    t("par.v360.noLimit")
                  )
                }
              />
              <Stat
                label={t("par.v360.available")}
                value={
                  creditAvail === null ? (
                    "-"
                  ) : (
                    <MoneyText poisha={creditAvail} />
                  )
                }
                tone={
                  creditAvail !== null && creditAvail < 0
                    ? "destructive"
                    : undefined
                }
              />
            </>
          ) : null}
          {party.isVendor ? (
            <Stat
              label={t("par.v360.apOpen")}
              value={<MoneyText poisha={balances?.apOpen ?? 0} />}
              testId="party-ap-open"
            />
          ) : null}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={t("par.v360.profile")} size="sm">
          <KeyValueGrid
            columns={2}
            items={[
              { label: t("par.form.type"), value: t(`par.type.${party.type}`) },
              { label: t("par.form.email"), value: party.email ?? "-" },
              {
                label: t("par.form.address"),
                value: address
                  ? [address.line, address.area, address.city]
                      .filter(Boolean)
                      .join(", ")
                  : "-",
                wide: true,
              },
              { label: t("par.form.bin"), value: party.bin ?? "-", mono: true },
              { label: t("par.form.tin"), value: party.tin ?? "-", mono: true },
              { label: t("par.form.nid"), value: party.nid ?? "-", mono: true },
              {
                label: t("par.form.tradeLicense"),
                value: party.tradeLicense ?? "-",
                mono: true,
              },
              ...(party.isCustomer
                ? [
                    {
                      label: t("par.v360.terms"),
                      value: party.paymentTermsDays
                        ? t("par.list.days", {
                            count: num(party.paymentTermsDays),
                          })
                        : t("par.list.cash"),
                    },
                    {
                      label: t("par.v360.priceList"),
                      value: data.priceList
                        ? nameOf(data.priceList, locale)
                        : "-",
                    },
                    {
                      label: t("par.v360.deducts"),
                      value:
                        [
                          party.deductsVds ? "VDS" : null,
                          party.deductsAit ? "AIT" : null,
                        ]
                          .filter(Boolean)
                          .join(", ") || t("par.v360.none"),
                    },
                  ]
                : []),
              ...(party.isVendor
                ? [
                    {
                      label: t("par.v360.vendorTax"),
                      value: party.vendorTaxCategory
                        ? tk(`par.taxCategory.${party.vendorTaxCategory}`)
                        : "-",
                    },
                    ...(!party.isCustomer
                      ? [
                          {
                            label: t("par.v360.terms"),
                            value: t("par.list.days", {
                              count: num(party.paymentTermsDays),
                            }),
                          },
                        ]
                      : []),
                  ]
                : []),
            ]}
          />
          {party.contacts.length ? (
            <div
              className="mt-4 flex flex-col gap-2"
              data-testid="party-contacts"
            >
              <span className="text-xs font-medium text-muted-foreground">
                {t("par.v360.contacts")}
              </span>
              {party.contacts.map((c, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline pb-2 text-[0.8125rem] last:border-0"
                >
                  <span>
                    <span className="font-medium">{c.name}</span>
                    {c.designation ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {c.designation}
                      </span>
                    ) : null}
                  </span>
                  <span lang="en" className="font-mono text-xs">
                    {c.phone}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </SectionCard>

        {party.isCustomer ? (
          <SectionCard
            title={t("par.v360.vehicles")}
            size="sm"
            subtitle={
              data.vehicles.length
                ? t("par.registry.count", { count: num(data.vehicles.length) })
                : undefined
            }
            action={
              can("par.customer.create") ? (
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="vehicle-add"
                  onClick={() => {
                    setVehicleEdit(undefined)
                    setVehicleOpen(true)
                  }}
                >
                  <Plus />
                  {t("par.v360.addVehicle")}
                </Button>
              ) : undefined
            }
          >
            {data.vehicles.length ? (
              <ul className="flex max-h-80 flex-col overflow-y-auto">
                {data.vehicles.map((v) => (
                  <li
                    key={v.id}
                    data-testid="vehicle-row"
                    data-reg={v.regNo}
                    className={cn(
                      "flex items-center gap-3 border-b border-hairline py-2 last:border-0",
                      !v.active && "opacity-60"
                    )}
                  >
                    <RegPlate regNo={v.regNo} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[0.8125rem] font-medium">
                        {v.make} {v.model}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {tk(`reports.enum.vehicleClass.${v.vehicleClass}`)} ·{" "}
                        {colour(v.colour)} ·{" "}
                        {num(v.year, { useGrouping: false })}
                        {!v.active ? ` · ${t("par.registry.retired")}` : ""}
                      </span>
                    </span>
                    {can("par.customer.edit") ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("par.v360.editVehicle")}
                        onClick={() => {
                          setVehicleEdit(v)
                          setVehicleOpen(true)
                        }}
                      >
                        <Pencil />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Car}
                title={t("par.v360.noVehicles")}
                size="sm"
              />
            )}
          </SectionCard>
        ) : null}
      </div>

      <SectionCard
        title={t("par.v360.transactions")}
        size="sm"
        subtitle={txs.length ? num(txs.length) : undefined}
      >
        <ListTable
          rows={txs}
          columns={txColumns}
          rowKey={(r) => r.key}
          rowTestId="party-tx"
          pageSize={15}
          dense
          empty={
            <EmptyState
              icon={FileText}
              title={t("par.v360.noTransactions")}
              size="sm"
            />
          }
        />
      </SectionCard>

      <VehicleDialog
        open={vehicleOpen}
        onOpenChange={setVehicleOpen}
        partyId={party.id}
        vehicle={vehicleEdit}
        thisYear={Number(today.slice(0, 4)) || 2026}
      />
      <ReasonDialog
        open={statusTo !== null}
        onOpenChange={(o) => !o && setStatusTo(null)}
        title={t(
          statusTo === "active"
            ? "par.v360.releaseTitle"
            : "par.v360.holdTitle",
          { party: nameOf(party, locale) }
        )}
        body={t(
          statusTo === "active" ? "par.v360.releaseBody" : "par.v360.holdBody"
        )}
        confirmLabel={
          statusTo === "active" ? t("par.v360.release") : t("par.v360.hold")
        }
        requireReason={statusTo !== "active"}
        destructive={statusTo !== "active"}
        pending={setStatus.pending}
        testId="party-status-dialog"
        onConfirm={async (reason) => {
          if (!statusTo) return
          const r = await setStatus.run({
            partyId: party.id,
            status: statusTo,
            reason,
            expectedVersion: party.version,
          })
          if (r) {
            toast.success(
              statusTo === "active" ? t("par.v360.release") : t("par.v360.hold")
            )
            setStatusTo(null)
          }
        }}
      />
    </div>
  )
}
