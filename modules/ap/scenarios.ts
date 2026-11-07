import { decideApproval } from "@/core/approvals/decide"
import { addDaysISO } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import type { GrnLineRow, GrnRow, Id } from "@/core/db/schema"
import { readSetting } from "@/core/db/settings"
import { previousRuns } from "@/core/scenarios/helpers"
import type { ScenarioDef, ScenarioKit } from "@/core/scenarios/types"
import { CBA, ITM, LOC, VND } from "@/core/seed/content/seed-refs"
import { addMonthsISO } from "@/core/seed/time"
import { withholdingFor } from "@/core/tax/withholding"

import { receiveGoods } from "@/modules/grn/commands"
import { issuePo } from "@/modules/ptl/commands"

import { recordBill } from "./commands"
import { goodsLineValues } from "./lib"

/**
 * AP scenario launchers (implementation_plan.md §10): E5 three-way
 * mismatch and E6 vendor payment with AIT and VDS withheld. Setups run real
 * commands as the story's users and create fresh documents on every run.
 */

/** The vendor's invoice prices the coating kits this much above the PO (E5). */
const E5_MARKUP_PCT = 6

/** A bill line the presenter will type: the GRN line, its PO price and what is left to bill. */
type BillableGrnLine = { line: GrnLineRow; availableQty: number }

/** Accepted, not returned, not yet billed (purchase units). */
const openQty = (l: GrnLineRow) => Math.max(0, l.qtyAccepted - l.qtyReturned - l.qtyBilled)

/**
 * A Gloss & Guard receipt from E4 (or an earlier E5 setup) that no bill has
 * touched yet: never a GRN an earlier run already billed or holds on a bill.
 */
async function untouchedReceipt(db: OmniflowDb): Promise<{ grn: GrnRow; lines: GrnLineRow[] } | undefined> {
  const runs = await previousRuns(db, ["E4", "E5"])
  const ids = new Set(runs.flatMap((r) => Object.values(r.refs ?? {})))
  const grns = (await db.grns.where("vendorId").equals(VND.glossGuard).toArray())
    .filter((g) => ids.has(g.id) || ids.has(g.poId))
    .sort((a, b) => b.receivedAt - a.receivedAt)
  for (const grn of grns) {
    const lines = await db.grnLines.where("grnId").equals(grn.id).toArray()
    const billed = lines.some((l) => l.qtyBilled > 0)
    if (billed) continue
    const onBills = await db.vendorBillLines.where("grnLineId").anyOf(lines.map((l) => l.id)).count()
    if (onBills > 0) continue
    if (lines.some((l) => l.itemId === ITM.cc2Kit && openQty(l) > 0)) return { grn, lines }
  }
  return undefined
}

/**
 * E4's receipt, performed through PTL and GRN's own commands: Nusrat's PO
 * to Gloss & Guard for 24 ceramic coating 2-year kits and 12 finishing
 * polish (above her purchase limit, so Farzana approves it), and Habib's
 * partial GRN at the Central Store: 20 kits (2 rejected for short expiry,
 * into quarantine) and the 12 polish.
 */
async function performE4Receipt(kit: ScenarioKit): Promise<{ grn: GrnRow; lines: GrnLineRow[] }> {
  const db = kit.db
  const today = kit.today()
  const [kits, polish] = await Promise.all([db.items.get(ITM.cc2Kit), db.items.get(ITM.polish)])
  if (!kits || !polish) throw new Error("E5: the coating kit or the finishing polish is missing from the item master")
  const issued = await kit.run(
    issuePo,
    {
      locationId: LOC.CST,
      orders: [
        {
          vendorId: VND.glossGuard,
          expectedDate: today,
          lines: [
            { itemId: kits.id, qty: 24, unitCostP: kits.standardCostP },
            { itemId: polish.id, qty: 12, unitCostP: polish.standardCostP },
          ],
        },
      ],
      idempotencyKey: `e5-po-${kit.runId}`,
    },
    "nusrat"
  )
  const poId = issued.pos[0].id
  let po = await db.purchaseOrders.get(poId)
  if (po?.status === "pending-approval" && po.approvalId) {
    const approval = await db.approvals.get(po.approvalId)
    if (approval?.status === "pending") {
      await kit.run(
        decideApproval,
        { approvalId: approval.id, decision: "approve", reason: "Coating restock for the studios", expectedVersion: approval.version },
        "farzana"
      )
    }
    po = await db.purchaseOrders.get(poId)
  }
  if (!po) throw new Error("E5: the purchase order was not created")
  const poLines = await db.poLines.where("poId").equals(po.id).toArray()
  const kitLine = poLines.find((l) => l.itemId === kits.id)!
  const polishLine = poLines.find((l) => l.itemId === polish.id)!
  const tag = `${today.slice(2, 4)}${today.slice(5, 7)}${today.slice(8, 10)}-${kit.runId.slice(-4).toUpperCase()}`
  const received = await kit.run(
    receiveGoods,
    {
      poId: po.id,
      expectedVersion: po.version,
      vendorChallanNo: `GGT-DC-${tag}`,
      lots: [
        { poLineId: kitLine.id, qtyAccepted: 18, qtyRejected: 0, quarantine: true, batchNo: `CN2-${tag}`, expiry: addMonthsISO(today, 18) },
        {
          poLineId: kitLine.id,
          qtyAccepted: 0,
          qtyRejected: 2,
          rejectReason: "short-expiry",
          quarantine: true,
          batchNo: `CN2S-${tag}`,
          expiry: addDaysISO(today, 40),
        },
        { poLineId: polishLine.id, qtyAccepted: 12, qtyRejected: 0, quarantine: true, batchNo: `LUP-${tag}`, expiry: addMonthsISO(today, 24) },
      ],
      idempotencyKey: `e5-grn-${kit.runId}`,
    },
    "habib"
  )
  const grn = await db.grns.get(received.id)
  if (!grn) throw new Error("E5: the goods receipt was not created")
  return { grn, lines: await db.grnLines.where("grnId").equals(grn.id).toArray() }
}

/** A vendor reference no bill of this vendor carries yet (INV-12). */
async function freshVendorRef(db: OmniflowDb, partyId: Id, prefix: string, start: number): Promise<string> {
  const refs = new Set((await db.vendorBills.where("partyId").equals(partyId).toArray()).map((b) => b.vendorRef))
  for (let n = start; ; n++) {
    const ref = `${prefix}/${n}`
    if (!refs.has(ref)) return ref
  }
}

/** The next cheque number on an account's issued chequebook, past every cheque and every payment still waiting. */
async function nextIssuedChequeNo(db: OmniflowDb, accountId: Id): Promise<string> {
  const cheques = (await db.cheques.toArray()).filter((c) => c.cashBankAccountId === accountId && c.direction === "issued")
  const waiting = (await db.vendorPayments.toArray()).filter((p) => p.status === "pending-approval" && p.cashBankAccountId === accountId)
  const used = [...cheques.map((c) => c.chequeNo), ...waiting.map((p) => p.chequeNo ?? "")].map(Number).filter(Number.isFinite)
  return String(Math.max(7_300_000, ...used) + 1)
}

const e5: ScenarioDef = {
  id: "E5",
  kind: "scenario",
  module: "ap",
  titleKey: "ap.scenarios.E5.title",
  summaryKey: "ap.scenarios.E5.summary",
  user: "mahbub",
  async setup(kit) {
    const db = kit.db
    const today = kit.today()
    const receipt = (await untouchedReceipt(db)) ?? (await performE4Receipt(kit))
    const po = await db.purchaseOrders.get(receipt.grn.poId)
    const poLines = new Map((await db.poLines.where("poId").equals(receipt.grn.poId).toArray()).map((l) => [l.id, l]))
    const billable: BillableGrnLine[] = receipt.lines.map((line) => ({ line, availableQty: openQty(line) })).filter((l) => l.availableQty > 0)
    const kits = billable.filter((l) => l.line.itemId === ITM.cc2Kit)
    const poPriceP = kits[0].line.unitCostP
    const invoicePriceP = Math.round((poPriceP * (100 + E5_MARKUP_PCT)) / 100)
    let totalP = 0
    let ppvP = 0
    let otherPriceP = 0
    for (const l of billable) {
      const isKit = l.line.itemId === ITM.cc2Kit
      const v = goodsLineValues(l.availableQty, isKit ? invoicePriceP : l.line.unitCostP, l.line.unitCostP, poLines.get(l.line.poLineId)?.vatRatePct ?? 15)
      totalP += v.netP + v.vatP
      ppvP += v.ppvP
      if (!isKit) otherPriceP = l.line.unitCostP
    }
    const vendorRef = await freshVendorRef(db, VND.glossGuard, `GGT/INV/${today.slice(2, 4)}${today.slice(5, 7)}`, 101)
    return {
      refs: { grnId: receipt.grn.id, poId: receipt.grn.poId, partyId: VND.glossGuard },
      params: {
        grnNo: receipt.grn.grnNo,
        poNo: po?.poNo ?? "",
        vendorRef,
        kitQty: kits.reduce((s, l) => s + l.availableQty, 0),
        poPriceP,
        invoicePriceP,
        polishPriceP: otherPriceP,
        totalP,
        ppvP,
        pct: E5_MARKUP_PCT,
      },
    }
  },
  route: (o) =>
    `/ap/bills/new?vendor=${o.refs?.partyId ?? VND.glossGuard}&grn=${o.refs?.grnId ?? ""}&ref=${encodeURIComponent(String(o.params?.vendorRef ?? ""))}`,
  cueKeys: ["ap.scenarios.E5.cue1", "ap.scenarios.E5.cue2", "ap.scenarios.E5.cue3", "ap.scenarios.E5.cue4", "ap.scenarios.E5.cue5"],
}

const e6: ScenarioDef = {
  id: "E6",
  kind: "scenario",
  module: "ap",
  titleKey: "ap.scenarios.E6.title",
  summaryKey: "ap.scenarios.E6.summary",
  user: "mahbub",
  async setup(kit) {
    const db = kit.db
    const today = kit.today()
    const tax = await readSetting(db, "tax")
    const vatPct = tax.vatRates.standard
    const netP = 60_000_00
    const vendorRef = await freshVendorRef(db, VND.primeGuard, `PGS/${today.slice(2, 4)}${today.slice(5, 7)}`, 201)
    const bill = await kit.run(
      recordBill,
      {
        kind: "expense",
        partyId: VND.primeGuard,
        vendorRef,
        date: today,
        hasMushak63: true,
        expenseLines: [{ expenseTag: "SECURITY", description: "Security guards at all sites, monthly service", netP, vatRatePct: vatPct, locationId: LOC.HQ }],
        idempotencyKey: `e6-bill-${kit.runId}`,
      },
      "mahbub"
    )
    const row = await db.vendorBills.get(bill.billId)
    const vendor = await db.parties.get(VND.primeGuard)
    if (!row || !vendor) throw new Error("E6: the bill was not recorded")
    const wh = withholdingFor(vendor.vendorTaxCategory, [{ allocatedP: row.totalP, billNetP: row.subtotalP, billVatP: row.inputVatP, billTotalP: row.totalP }], tax)
    return {
      refs: { billId: row.id, partyId: vendor.id },
      params: {
        billNo: row.billNo,
        vendorRef,
        netP: row.subtotalP,
        vatP: row.inputVatP,
        grossP: row.totalP,
        aitP: wh.aitP,
        vdsP: wh.vdsP,
        payP: wh.netPaidP,
        chequeNo: await nextIssuedChequeNo(db, CBA.BRAC),
      },
    }
  },
  route: (o) => `/ap/payments/new?party=${o.refs?.partyId ?? VND.primeGuard}&bill=${o.refs?.billId ?? ""}`,
  cueKeys: ["ap.scenarios.E6.cue1", "ap.scenarios.E6.cue2", "ap.scenarios.E6.cue3", "ap.scenarios.E6.cue4", "ap.scenarios.E6.cue5"],
}

/** AP scenario launchers (implementation_plan.md §10). */
export const apScenarios: ScenarioDef[] = [e5, e6]
