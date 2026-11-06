import { defaultTaxSettings } from "@/config/rules.config"
import type { ISODate, Id, Ms, SalesInvoiceRow } from "@/core/db/schema"
import { invoiceOpen, invoiceStatus } from "@/core/ar/receipt"
import { linesForChequeCleared, linesForReceipt } from "@/core/ledger/rules"
import { customerDeductions } from "@/core/tax/withholding"

import { CREDIT_BY_ID } from "../content/parties"
import { CBA, LOC, PLANT, PTY, USR } from "../content/seed-refs"
import type { World } from "../engine/world"
import { isoAddDays, MINUTE } from "../time"
import type { CreditInvoice, CreditPlan } from "./credit-plan"
import type { CreditOrder } from "./itemised"
import { STUDIO_LOC, writeInvoice, type InvoiceLineInput } from "./sales-docs"

/**
 * Credit customers' documents (seed_data.md §5.2, §7.1, §7.4): consolidated
 * invoices (R6) with lines per vehicle and service (order lines in the
 * itemised window, order-less before it), receipts by bank transfer (R8) or
 * cheque cleared two days later (R10) with VDS and AIT deducted where the
 * party deducts, the planted post-dated cheques (E8 Metro, Greenway) whose
 * pending receipts reserve their allocations, and Orbit's credit hold.
 */

const BANKS = ["Eastern Bank", "City Bank", "Prime Bank", "Mutual Trust Bank", "Southeast Bank", "Standard Chartered", "Islami Bank Bangladesh"]

export type CreditDocsOut = { invoices: Map<number, SalesInvoiceRow> }

export function seedCreditDocs(w: World, plan: CreditPlan, creditOrders: Map<number, CreditOrder>, openingInvoices: Map<number, SalesInvoiceRow>): CreditDocsOut {
  const { bag } = w.ctx
  const out = new Map<number, SalesInvoiceRow>(openingInvoices)
  const today = w.cal.today

  for (const p of plan.invoices) {
    if (p.kind === "opening") continue
    const party = CREDIT_BY_ID.get(p.partyId)!
    const at = p.date === today ? w.at(today, "09:30") : w.at(p.date, "10:00")
    const lines: InvoiceLineInput[] = []
    const orderIds: Id[] = []
    for (const job of p.jobs) {
      const co = creditOrders.get(job.key)
      if (co) orderIds.push(co.order.id)
      job.lines.forEach((l, i) => {
        lines.push({
          orderLineId: co?.lines[i]?.id,
          serviceId: l.serviceId,
          addOnId: l.addOnId,
          vehicleId: job.vehicle.id,
          vehicleClass: job.vehicle.cls,
          descriptionEn: `${l.descriptionEn}, ${bag.get("vehicles", job.vehicle.id).regNo}, ${job.date}`,
          descriptionBn: l.descriptionBn,
          qty: 1,
          unitPriceP: l.unitPriceP,
          discountP: l.discountP,
          vatP: l.vatP,
          netP: l.netP,
          revenueTag: l.revenueTag,
        })
      })
    }
    // Credit check (INV-10): over the limit needs an approved credit override (Farzana).
    const exposure = exposureOn(plan, p)
    let creditOverrideApprovalId: Id | undefined
    if (exposure > party.creditLimit * 100) {
      creditOverrideApprovalId = w.approval({
        kind: "credit-override",
        docType: "salesInvoices",
        docId: p.id ?? `pending_${p.key}`,
        docNo: () => "",
        locationId: STUDIO_LOC[p.studio],
        requestedBy: USR.mahbub,
        requestedAt: at - 10 * MINUTE,
        status: "approved",
        decidedBy: USR.farzana,
        decidedAt: at - 5 * MINUTE,
        reason: "Payment confirmed by the customer this week",
        decisionReason: "Payment confirmed by the customer this week",
        inline: true,
      }).id
    }
    const invoice = writeInvoice(w, {
      id: p.id,
      loc: STUDIO_LOC[p.studio],
      partyId: p.partyId,
      orderIds,
      date: p.date,
      at,
      dueDate: p.dueDate,
      kind: "consolidated",
      lines,
      advanceAppliedP: 0,
      issuedBy: USR.mahbub,
      creditOverrideApprovalId,
    })
    if (invoice.totalP !== p.totalP) throw new Error(`seed: consolidated invoice total drift ${invoice.totalP} vs ${p.totalP}`)
    if (creditOverrideApprovalId) {
      const apv = bag.get("approvals", creditOverrideApprovalId)
      apv.docId = invoice.id
      w.fix(() => {
        apv.docNo = invoice.invoiceNo
      })
    }
    for (const job of p.jobs) {
      const co = creditOrders.get(job.key)
      if (!co) continue
      co.order.status = "invoiced"
      co.order.invoicedAt = at
      co.order.updatedAt = Math.max(co.order.updatedAt, at)
      for (const l of co.lines) l.qtyInvoiced = 1
    }
    out.set(p.key, invoice)
  }

  // Receipts in date order (bank transfer R8, or cheque R10 when it clears).
  const payments = plan.invoices.flatMap((p) => p.payments.map((pay) => ({ p, pay })))
  payments.sort((a, b) => (a.pay.date < b.pay.date ? -1 : a.pay.date > b.pay.date ? 1 : a.p.key - b.p.key))
  for (const { p, pay } of payments) {
    const invoice = out.get(p.key)!
    writeCreditReceipt(w, { partyId: p.partyId, date: pay.date, method: pay.method, allocations: [{ invoice, amountP: pay.allocP }] })
  }

  // Orders of paid invoices are closed.
  for (const p of plan.invoices) {
    const invoice = out.get(p.key)
    if (!invoice || invoice.status !== "paid") continue
    for (const job of p.jobs) {
      const co = creditOrders.get(job.key)
      if (!co) continue
      co.order.status = "closed"
      co.order.closedAt = invoice.updatedAt
    }
  }

  plantPdcs(w, out)
  plantOrbitHold(w, out)
  return { invoices: out }
}

/** The party's open invoices on the invoice's day (from the plan), plus this invoice. */
function exposureOn(plan: CreditPlan, p: CreditInvoice): number {
  let sum = 0
  for (const i of plan.invoices) {
    if (i.partyId !== p.partyId || i.date > p.date || i.key === p.key) continue
    sum += i.totalP - i.payments.filter((pay) => pay.date <= p.date).reduce((s, pay) => s + pay.allocP, 0)
  }
  return sum + p.totalP
}

let chequeSerial = 0

export function writeCreditReceipt(
  w: World,
  input: {
    id?: Id
    partyId: Id
    date: ISODate
    method: "bank-transfer" | "cheque"
    allocations: { invoice: SalesInvoiceRow; amountP: number }[]
    /** Cash received when it is fixed (the planted PDCs); deductions then solve to it */
    pending?: { chequeDate: ISODate; chequeId: Id; amountP: number; advanceP: number }
  }
): void {
  const { bag } = w.ctx
  const rng = w.rng("credit-receipts")
  const party = bag.get("parties", input.partyId)
  const shares = input.allocations.map((a) => ({ allocatedP: a.amountP, invoiceVatP: a.invoice.vatP, invoiceTotalP: a.invoice.totalP }))
  const { vdsP, aitP } = customerDeductions(party, shares, defaultTaxSettings)
  const allocated = input.allocations.reduce((s, a) => s + a.amountP, 0)
  const amountP = input.pending ? input.pending.amountP : allocated - vdsP - aitP
  const advanceP = input.pending ? input.pending.advanceP : 0
  if (amountP + vdsP + aitP - allocated !== advanceP) throw new Error("seed: receipt does not add up")
  const at = w.at(input.date, input.method === "cheque" ? "15:10" : "12:20")
  const id = input.id ?? w.ctx.seq("mr")
  const cheque = input.method === "cheque"
  const accountId = cheque ? CBA.DBBL : CBA.BRAC
  const receipt = bag.put("receipts", id, at, {
    receiptNo: "",
    locationId: LOC.HQ,
    partyId: input.partyId,
    date: input.date,
    method: input.method,
    cashBankAccountId: accountId,
    amountP,
    ref: cheque ? undefined : `NPSB${rng.int(1_000_000, 9_999_999)}`,
    status: input.pending ? "pending" : "posted",
    allocations: input.allocations.map((a) => ({ invoiceId: a.invoice.id, amountP: a.amountP })),
    advanceP,
    vdsDeductedP: vdsP,
    aitDeductedP: aitP,
    certificateNo: vdsP > 0 || aitP > 0 ? `${party.deductsVds ? "6.6" : "TDS"}/${input.date.replace(/-/g, "")}/${rng.int(100, 999)}` : undefined,
    idempotencyKey: `seed:${id}`,
    at,
    takenBy: USR.mahbub,
  }, USR.mahbub)
  w.number("MR", { location: LOC.HQ, date: input.date }, at, (no) => {
    receipt.receiptNo = no
  })

  if (cheque) {
    chequeSerial += 1
    const chequeDate = input.pending?.chequeDate ?? input.date
    const deposited = isoAddDays(input.date, 1)
    const cleared = isoAddDays(input.date, 2)
    const history: { status: "in-hand" | "deposited" | "cleared"; at: Ms; by: Id }[] = [{ status: "in-hand", at, by: USR.mahbub }]
    if (!input.pending) {
      history.push({ status: "deposited", at: w.at(deposited, "11:00"), by: USR.mahbub })
      history.push({ status: "cleared", at: w.at(cleared, "15:00"), by: USR.mahbub })
    }
    const chq = bag.put("cheques", input.pending?.chequeId ?? w.ctx.seq("chq"), at, {
      direction: "received",
      chequeNo: String(4_100_000 + chequeSerial * 37 + rng.int(0, 30)),
      bankName: rng.pick(BANKS),
      cashBankAccountId: accountId,
      partyId: input.partyId,
      amountP,
      chequeDate,
      receivedOn: input.date,
      isPdc: chequeDate > input.date,
      status: input.pending ? "in-hand" : "cleared",
      receiptId: id,
      history,
    }, USR.mahbub)
    receipt.chequeId = chq.id
    if (input.pending) {
      for (const a of input.allocations) {
        a.invoice.reservedP += a.amountP
        a.invoice.updatedAt = Math.max(a.invoice.updatedAt, at)
      }
      return
    }
    chq.updatedAt = w.at(cleared, "15:00")
    const journal = w.ledger.post({
      rule: "R10",
      date: cleared,
      at: w.at(cleared, "15:00"),
      lines: linesForChequeCleared({ partyId: input.partyId, locationId: LOC.HQ, cashTag: "BANK_COLLECTION", amountP, vdsP, aitP, allocatedP: allocated, advanceP }),
      narration: () => `Cheque cleared, receipt ${receipt.receiptNo}`,
      source: { app: "ar", docType: "receipts", docId: id, docNo: () => receipt.receiptNo },
      preparedBy: USR.mahbub,
    })
    receipt.journalId = journal.id
    receipt.updatedAt = w.at(cleared, "15:00")
  } else {
    const journal = w.ledger.post({
      rule: "R8",
      date: input.date,
      at,
      lines: linesForReceipt({ partyId: input.partyId, locationId: LOC.HQ, cashTag: "BANK_MAIN", amountP, vdsP, aitP, allocatedP: allocated, advanceP }),
      narration: () => `Receipt ${receipt.receiptNo}`,
      source: { app: "ar", docType: "receipts", docId: id, docNo: () => receipt.receiptNo },
      preparedBy: USR.mahbub,
    })
    receipt.journalId = journal.id
  }
  for (const a of input.allocations) {
    a.invoice.paidP += a.amountP
    a.invoice.status = invoiceStatus(a.invoice)
    a.invoice.updatedAt = Math.max(a.invoice.updatedAt, receipt.updatedAt)
  }
}

/**
 * E8: Metro Corporate Fleet's ৳85,000 cheque dated today, received
 * yesterday, reserving part of its oldest open invoice (allocation grossed
 * up for the VDS and AIT it deducts). Greenway's ৳40,000 cheque dated in
 * three days, received yesterday.
 */
function plantPdcs(w: World, invoices: Map<number, SalesInvoiceRow>) {
  const yesterday = w.cal.yesterday
  const open = (partyId: Id) =>
    [...invoices.values()]
      .filter((i) => i.partyId === partyId && invoiceOpen(i) - i.reservedP > 0)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  const metro = w.ctx.bag.get("parties", PTY.metroFleet)
  const cash = 85_000_00
  const oldest = open(PTY.metroFleet)[0]
  if (oldest) {
    const available = invoiceOpen(oldest) - oldest.reservedP
    const gross = (alloc: number) => {
      const d = customerDeductions(metro, [{ allocatedP: alloc, invoiceVatP: oldest.vatP, invoiceTotalP: oldest.totalP }], defaultTaxSettings)
      return alloc - d.vdsP - d.aitP
    }
    // Gross the cash up for the VDS and AIT Metro deducts; keep it to part of the invoice.
    let alloc = Math.round(cash / 0.826)
    for (let i = 0; i < 400 && gross(alloc) < cash; i++) alloc += 1
    for (let i = 0; i < 400 && gross(alloc) > cash; i++) alloc -= 1
    if (alloc >= available) alloc = Math.round((available * 0.7) / 100) * 100
    const net = gross(alloc)
    writeCreditReceipt(w, {
      id: PLANT.e8Receipt,
      partyId: PTY.metroFleet,
      date: yesterday,
      method: "cheque",
      allocations: [{ invoice: oldest, amountP: alloc }],
      pending: { chequeDate: w.cal.today, chequeId: PLANT.e8Cheque, amountP: cash, advanceP: cash - net },
    })
  } else {
    writeCreditReceipt(w, { id: PLANT.e8Receipt, partyId: PTY.metroFleet, date: yesterday, method: "cheque", allocations: [], pending: { chequeDate: w.cal.today, chequeId: PLANT.e8Cheque, amountP: cash, advanceP: cash } })
  }

  let left = 40_000_00
  const allocations: { invoice: SalesInvoiceRow; amountP: number }[] = []
  for (const inv of open(PTY.greenway)) {
    if (left <= 0) break
    const take = Math.min(left, invoiceOpen(inv) - inv.reservedP)
    allocations.push({ invoice: inv, amountP: take })
    left -= take
  }
  writeCreditReceipt(w, {
    id: PLANT.greenwayReceipt,
    partyId: PTY.greenway,
    date: yesterday,
    method: "cheque",
    allocations,
    pending: { chequeDate: isoAddDays(w.cal.today, 3), chequeId: PLANT.greenwayCheque, amountP: 40_000_00, advanceP: left },
  })
}

/** Orbit: on hold since its invoice went 60 days past due (14 days ago). */
function plantOrbitHold(w: World, invoices: Map<number, SalesInvoiceRow>) {
  const orbit = w.ctx.bag.get("parties", PTY.orbit)
  const overdue = [...invoices.values()].find((i) => i.id === PLANT.orbitOverdueInvoice)
  orbit.status = "on-hold"
  orbit.autoHoldAt = w.at(isoAddDays(w.cal.today, -14), "06:00")
  orbit.updatedAt = orbit.autoHoldAt
  orbit.updatedBy = "system"
  w.fix(() => {
    orbit.holdReason = `Invoice ${overdue?.invoiceNo ?? ""} is 60 days past due`
  })
}

export function resetChequeSerial(): void {
  chequeSerial = 0
}

export type { CreditInvoice }
