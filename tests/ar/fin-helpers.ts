import type { z } from "zod"

import type { OmniflowDb } from "@/core/db/database"
import type { AccountTag, Id, JournalLineRow, PartyRow } from "@/core/db/schema"
import { nextDocNo } from "@/core/docs/numbering"
import { commit } from "@/core/engine/commit"
import type { Actor, CommandDef, Tx } from "@/core/engine/types"
import { postJournal } from "@/core/ledger/post"
import { linesForGoodsAccepted, linesForOpeningBalances, linesForSalesInvoice } from "@/core/ledger/rules"
import { balanceOf } from "@/core/ledger/statements"

import { foundationDb } from "../helpers/foundation"
import { asSystem, partyData, seedTestItems } from "../helpers/fixtures"

/**
 * WS-FIN test helpers: a foundation database with opening cash and bank
 * balances (R1a), credit customers and vendors, posted invoices (R6) and
 * goods received (R12), and GL balance lookups.
 */

export const T = (taka: number) => Math.round(taka * 100)

export async function finDb(prefix: string): Promise<OmniflowDb> {
  const db = await foundationDb(prefix)
  await asSystem(db, async (tx) => {
    const today = tx.today()
    await postJournal(tx, {
      voucherType: "OB",
      date: today,
      narration: "Opening balances (test)",
      lines: linesForOpeningBalances([
        { account: "BANK_MAIN", balanceP: T(10_00_000) },
        { account: "BANK_COLLECTION", balanceP: T(5_00_000) },
        { account: "CASH_TILL_GUL", balanceP: T(50_000), locationId: "loc_gul" },
        { account: "CASH_TILL_UTT", balanceP: T(40_000), locationId: "loc_utt" },
        { account: "PETTY_HQ", balanceP: T(15_000), locationId: "loc_hq" },
        { account: "PETTY_GUL", balanceP: T(6_000), locationId: "loc_gul" },
        { account: "PETTY_UTT", balanceP: T(10_000), locationId: "loc_utt" },
        { account: "CARD_CLEARING", balanceP: T(30_000) },
        { account: "MFS_BKASH", balanceP: T(20_000) },
      ]),
      rule: "R1a",
    })
    tx.insert("parties", {
      id: "pty_fleet",
      ...partyData("C-000901", { type: "company", nameEn: "Test Fleet Ltd", segment: "fleet", creditLimitP: T(5_00_000), paymentTermsDays: 30, deductsVds: true, deductsAit: true, phone: "01711-555001" }),
    })
    tx.insert("parties", { id: "pty_retail", ...partyData("C-000902", { nameEn: "Test Retail Customer", phone: "01711-555002" }) })
    tx.insert("parties", {
      id: "pty_goods",
      ...partyData("V-0901", { isCustomer: false, isVendor: true, type: "company", nameEn: "Test Chem Supplier", segment: "supplier", vendorTaxCategory: "goods", paymentTermsDays: 30, bin: "000999111-0101" }),
    })
    tx.insert("parties", {
      id: "pty_guard",
      ...partyData("V-0902", { isCustomer: false, isVendor: true, type: "company", nameEn: "Test Guard Services", segment: "service-provider", vendorTaxCategory: "services", paymentTermsDays: 15 }),
    })
  })
  return db
}

/** Run a command as a signed-in actor. */
export async function run<S extends z.ZodType, O>(db: OmniflowDb, def: CommandDef<S, O>, input: z.input<S>, actor: Actor): Promise<O> {
  return (await commit(def, input, { db, actor })).result
}

/** A posted credit invoice (R6) of `netP` + 15% VAT, dated `date`, due after `terms` days. */
export async function postInvoice(db: OmniflowDb, opts: { partyId: Id; netP: number; date?: string; dueDate?: string; locationId?: string }): Promise<Id> {
  return asSystem(db, async (tx: Tx) => {
    const date = opts.date ?? tx.today()
    const locationId = opts.locationId ?? "loc_gul"
    const vatP = Math.round(opts.netP * 0.15)
    const invoiceNo = await nextDocNo(tx, "INV", { location: locationId, date })
    const inv = tx.insert("salesInvoices", {
      invoiceNo,
      locationId,
      partyId: opts.partyId,
      orderIds: [],
      date,
      issuedAt: tx.now(),
      dueDate: opts.dueDate ?? date,
      kind: "opening",
      buyerNameEn: "Test",
      subtotalP: opts.netP,
      discountP: 0,
      vatP,
      totalP: opts.netP + vatP,
      advanceAppliedP: 0,
      paidP: 0,
      reservedP: 0,
      creditedP: 0,
      status: "posted",
      journalId: "pending",
      printCount: 0,
      issuedBy: tx.actor.userId,
    })
    const journal = await postJournal(tx, {
      voucherType: "SV",
      date: tx.today(),
      source: { app: "si", docType: "salesInvoices", docId: inv.id, docNo: invoiceNo },
      narration: invoiceNo,
      lines: linesForSalesInvoice({
        partyId: opts.partyId,
        locationId,
        lines: [{ revenueTag: "REV_WASH", grossP: opts.netP, discountP: 0, vatP }],
        advanceAppliedP: 0,
      }),
      rule: "R6",
    })
    await tx.update("salesInvoices", inv.id, { journalId: journal.id })
    return inv.id
  })
}

/**
 * A PO and a GRN at the Central Store for `qty` kits at `unitCostP`, the
 * accepted quantity posted to GRNI (R12). Returns the GRN line id.
 */
export async function receiveGoods(db: OmniflowDb, opts: { vendorId: Id; qty: number; unitCostP: number; accepted?: number }): Promise<{ grnLineId: Id; poLineId: Id; grnId: Id }> {
  if (!(await db.items.get("itm_cc2"))) await seedTestItems(db)
  return asSystem(db, async (tx) => {
    const date = tx.today()
    const accepted = opts.accepted ?? opts.qty
    const subtotal = Math.round(opts.qty * opts.unitCostP)
    const vat = Math.round(subtotal * 0.15)
    const po = tx.insert("purchaseOrders", {
      poNo: await nextDocNo(tx, "PO", { date }),
      vendorId: opts.vendorId,
      locationId: "loc_cst",
      status: "received",
      orderDate: date,
      expectedDate: date,
      subtotalP: subtotal,
      vatP: vat,
      totalP: subtotal + vat,
      buyerId: "usr_nusrat",
    })
    const poLine = tx.insert("poLines", { poId: po.id, lineNo: 1, itemId: "itm_cc2", qty: opts.qty, unitCostP: opts.unitCostP, vatRatePct: 15, qtyReceived: opts.qty, qtyRejected: 0, qtyReturned: 0, qtyBilled: 0 })
    const grn = tx.insert("grns", { grnNo: await nextDocNo(tx, "GRN", { location: "loc_cst", date }), poId: po.id, vendorId: opts.vendorId, locationId: "loc_cst", receivedBy: "usr_habib", receivedAt: tx.now(), date })
    const grnLine = tx.insert("grnLines", {
      grnId: grn.id,
      poLineId: poLine.id,
      itemId: "itm_cc2",
      qtyReceived: opts.qty,
      qtyAccepted: accepted,
      qtyRejected: opts.qty - accepted,
      qtyReturned: 0,
      qtyBilled: 0,
      quarantine: false,
      unitCostP: opts.unitCostP,
    })
    const journal = await postJournal(tx, {
      voucherType: "PJ",
      date,
      source: { app: "grn", docType: "grns", docId: grn.id, docNo: grn.grnNo },
      narration: grn.grnNo,
      lines: linesForGoodsAccepted({ partyId: opts.vendorId, locationId: "loc_cst", lines: [{ itemId: "itm_cc2", tag: "INV_CHEMICAL", valueP: Math.round(accepted * opts.unitCostP) }] }),
      rule: "R12",
    })
    await tx.update("grns", grn.id, { journalId: journal.id })
    return { grnLineId: grnLine.id, poLineId: poLine.id, grnId: grn.id }
  })
}

/** A posted expense bill through the command, as a system fixture (E6-like). */
export async function accountId(db: OmniflowDb, tag: AccountTag): Promise<Id> {
  const map = (await db.settings.get("postingAccounts"))?.value as Record<string, Id>
  return map[tag]
}

/** Signed GL balance (debit positive) of a tag, optionally for one party. */
export async function gl(db: OmniflowDb, tag: AccountTag, partyId?: Id): Promise<number> {
  const id = await accountId(db, tag)
  const lines: JournalLineRow[] = await db.journalLines.where("accountId").equals(id).toArray()
  return balanceOf(lines, (l) => !partyId || l.partyId === partyId)
}

/** Every journal posted so far balances (INV-01 from the outside). */
export async function allBalanced(db: OmniflowDb): Promise<boolean> {
  const lines = await db.journalLines.toArray()
  const sums = new Map<string, number>()
  for (const l of lines) sums.set(l.journalId, (sums.get(l.journalId) ?? 0) + l.debitP - l.creditP)
  return [...sums.values()].every((v) => v === 0)
}

export type { PartyRow }
