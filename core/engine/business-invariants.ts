import type {
  AccountRow,
  BaseRow,
  JournalLineRow,
  JournalRow,
  PeriodRow,
  SalesInvoiceRow,
  VendorBillRow,
} from "@/core/db/schema"
import { INVENTORY_TAGS, PARTY_TAGS } from "@/core/ledger/chart"

import type { Invariant, InvariantContext } from "./invariants"
import type { Change } from "./types"

/**
 * The ERP invariants of plan §3.3 (INV-06 and INV-11 live in the engine
 * itself). Each runs only when the commit touched its tables.
 */

const after = <T>(c: Change) => c.after as unknown as T
const inserted = (changes: readonly Change[], table: string) =>
  changes.filter((c) => c.table === table && c.kind !== "delete" && c.after)

async function accountMap(ctx: InvariantContext, lines: JournalLineRow[]): Promise<Map<string, AccountRow>> {
  const ids = [...new Set(lines.map((l) => l.accountId))]
  const out = new Map<string, AccountRow>()
  for (const id of ids) {
    const row = await ctx.tx.find("accounts", id)
    if (row) out.set(id, row)
  }
  return out
}

/** Posted lines written in this commit, grouped by journal. */
function newLinesByJournal(changes: readonly Change[]): Map<string, JournalLineRow[]> {
  const out = new Map<string, JournalLineRow[]>()
  for (const c of inserted(changes, "journalLines")) {
    if (c.kind !== "insert") continue
    const line = after<JournalLineRow>(c)
    const list = out.get(line.journalId) ?? []
    list.push(line)
    out.set(line.journalId, list)
  }
  return out
}

/** INV-01: every journal balances: debits = credits > 0; no line both. */
const inv01: Invariant = {
  id: "INV-01",
  tables: ["journalLines", "journals"],
  check({ changes, fail }) {
    for (const [journalId, lines] of newLinesByJournal(changes)) {
      let debit = 0
      let credit = 0
      for (const l of lines) {
        if (l.debitP < 0 || l.creditP < 0) fail("JOURNAL_LINE_BOTH", { journal: journalId })
        if (l.debitP > 0 && l.creditP > 0) fail("JOURNAL_LINE_BOTH", { journal: journalId })
        debit += l.debitP
        credit += l.creditP
      }
      if (debit !== credit || debit <= 0) {
        fail("JOURNAL_UNBALANCED", { debitP: debit, creditP: credit, debit, credit })
      }
    }
  },
}

/** INV-02: a posted journal's date falls in an open period of an open fiscal year. */
const inv02: Invariant = {
  id: "INV-02",
  tables: ["journals", "journalLines"],
  async check({ tx, changes, fail }) {
    const periods = new Map<string, PeriodRow | undefined>()
    for (const c of inserted(changes, "journalLines")) {
      if (c.kind !== "insert") continue
      const line = after<JournalLineRow>(c)
      if (!periods.has(line.periodId)) periods.set(line.periodId, await tx.find("periods", line.periodId))
      const period = periods.get(line.periodId)
      if (!period) return fail("NO_PERIOD", { date: line.date })
      if (period.status !== "open" || line.date < period.startsOn || line.date > period.endsOn) {
        fail("PERIOD_CLOSED", { period: period.code, date: line.date }, true)
      }
      const year = await tx.find("fiscalYears", period.fiscalYearId)
      if (year?.status === "closed") fail("PERIOD_CLOSED", { period: period.code, date: line.date }, true)
    }
  },
}

/**
 * INV-03: lines post only to active, postable accounts; control accounts
 * accept lines only from the posting rules, never from a manual voucher (R24).
 */
const inv03: Invariant = {
  id: "INV-03",
  tables: ["journalLines"],
  async check(ctx) {
    const byJournal = newLinesByJournal(ctx.changes)
    const all = [...byJournal.values()].flat()
    const accounts = await accountMap(ctx, all)
    for (const [journalId, lines] of byJournal) {
      const journal = (await ctx.tx.find("journals", journalId)) as JournalRow | undefined
      for (const l of lines) {
        const account = accounts.get(l.accountId)
        if (!account) return ctx.fail("ACCOUNT_INACTIVE", { account: l.accountId })
        if (!account.active) ctx.fail("ACCOUNT_INACTIVE", { account: `${account.code} ${account.nameEn}` })
        if (account.isGroup) ctx.fail("ACCOUNT_GROUP", { account: `${account.code} ${account.nameEn}` })
        if (account.isControl && journal?.rule === "R24") {
          ctx.fail("CONTROL_ACCOUNT", { account: `${account.code} ${account.nameEn}` }, true)
        }
      }
    }
  },
}

/**
 * INV-04: lines on AR, AP, customer advances and GRNI carry a party;
 * inventory lines carry an item and a location (OB, SM and YC exempt from
 * the item rule).
 */
const inv04: Invariant = {
  id: "INV-04",
  tables: ["journalLines"],
  async check(ctx) {
    const lines = [...newLinesByJournal(ctx.changes).values()].flat()
    const accounts = await accountMap(ctx, lines)
    for (const l of lines) {
      const tag = accounts.get(l.accountId)?.tag
      if (!tag) continue
      const label = `${accounts.get(l.accountId)!.code} ${accounts.get(l.accountId)!.nameEn}`
      if (PARTY_TAGS.includes(tag) && !l.partyId) ctx.fail("PARTY_REQUIRED", { account: label })
      if (INVENTORY_TAGS.includes(tag)) {
        const exempt = l.voucherType === "OB" || l.voucherType === "SM" || l.voucherType === "YC"
        if (!l.locationId || (!exempt && !l.itemId)) ctx.fail("ITEM_REQUIRED", { account: label })
      }
    }
  },
}

/** INV-05: stock never goes below zero; quarantined quantity is never negative or issued. */
const inv05: Invariant = {
  id: "INV-05",
  tables: ["stockBalances", "stockValues"],
  check({ relevant, fail }) {
    for (const c of relevant) {
      if (c.kind === "delete" || !c.after) continue
      const row = c.after as BaseRow & { qtyBase: number; quarantinedQty?: number; valueP?: number; itemId: string; locationId: string }
      if (row.qtyBase < -1e-9 || (row.quarantinedQty ?? 0) < -1e-9) {
        fail("STOCK_NEGATIVE", { item: row.itemId, location: row.locationId, available: 0, needed: -row.qtyBase })
      }
      if (c.table === "stockValues") {
        if ((row.valueP ?? 0) < 0) fail("STOCK_VALUE_NEGATIVE", { item: row.itemId, location: row.locationId })
        if (Math.abs(row.qtyBase) < 1e-9 && (row.valueP ?? 0) !== 0) {
          fail("STOCK_VALUE_RESIDUE", { item: row.itemId, location: row.locationId })
        }
      }
    }
  },
}

/** INV-07: maker-checker: an approval is never decided by its requester. */
const inv07: Invariant = {
  id: "INV-07",
  tables: ["approvals"],
  check({ relevant, fail }) {
    for (const c of relevant) {
      if (!c.after) continue
      const a = c.after as unknown as { decidedBy?: string; requestedBy: string; status: string }
      if (a.decidedBy && a.decidedBy === a.requestedBy) fail("SELF_APPROVAL", {}, true)
    }
  },
}

/** INV-08: header totals equal the sum of their lines; total = subtotal − discount + VAT. */
const inv08: Invariant = {
  id: "INV-08",
  tables: ["salesInvoices", "salesInvoiceLines", "vendorBills", "vendorBillLines", "quotations", "salesOrders", "purchaseOrders"],
  async check({ tx, changes, fail }) {
    const headerOk = (h: { subtotalP: number; discountP?: number; vatP: number; totalP: number }) =>
      h.totalP === h.subtotalP - (h.discountP ?? 0) + h.vatP
    for (const c of inserted(changes, "salesInvoices")) {
      if (c.kind !== "insert") continue
      const inv = after<SalesInvoiceRow>(c)
      if (inv.kind === "opening") continue
      if (!headerOk(inv)) fail("DOC_TOTALS", { doc: inv.invoiceNo })
      const lines = await tx.list("salesInvoiceLines", "invoiceId", inv.id)
      if (lines.length) {
        const gross = lines.reduce((s, l) => s + Math.round(l.qty * l.unitPriceP), 0)
        const disc = lines.reduce((s, l) => s + l.discountP, 0)
        const vat = lines.reduce((s, l) => s + l.vatP, 0)
        const netSum = lines.reduce((s, l) => s + l.netP, 0)
        if (vat !== inv.vatP || disc !== inv.discountP || netSum !== inv.subtotalP - inv.discountP || gross !== inv.subtotalP) {
          fail("DOC_TOTALS", { doc: inv.invoiceNo })
        }
      }
    }
    for (const c of inserted(changes, "vendorBills")) {
      if (c.kind !== "insert") continue
      const bill = after<VendorBillRow>(c)
      if (bill.kind === "opening" || bill.kind === "summary") continue
      if (bill.totalP !== bill.subtotalP + bill.inputVatP) fail("DOC_TOTALS", { doc: bill.billNo })
      const lines = await tx.list("vendorBillLines", "billId", bill.id)
      if (lines.length) {
        const netSum = lines.reduce((s, l) => s + l.netP, 0)
        const vat = lines.reduce((s, l) => s + l.vatP, 0)
        if (netSum !== bill.subtotalP || vat !== bill.inputVatP) fail("DOC_TOTALS", { doc: bill.billNo })
      }
    }
    for (const table of ["quotations", "salesOrders", "purchaseOrders"] as const) {
      for (const c of inserted(changes, table)) {
        const h = c.after as unknown as { subtotalP: number; discountP?: number; vatP: number; totalP: number; [k: string]: unknown }
        if (!headerOk(h)) fail("DOC_TOTALS", { doc: String(h.quoteNo ?? h.orderNo ?? h.poNo ?? c.id) })
      }
    }
  },
}

/** INV-09: allocations never exceed what is outstanding (invoices, bills). */
const inv09: Invariant = {
  id: "INV-09",
  tables: ["salesInvoices", "vendorBills"],
  check({ relevant, fail }) {
    for (const c of relevant) {
      if (!c.after) continue
      if (c.table === "salesInvoices") {
        const inv = c.after as unknown as SalesInvoiceRow
        const used = inv.advanceAppliedP + inv.paidP + inv.creditedP + inv.reservedP
        if (used > inv.totalP || inv.paidP < 0 || inv.reservedP < 0 || inv.creditedP < 0) {
          fail("OVER_ALLOCATION", { doc: inv.invoiceNo })
        }
      } else {
        const bill = c.after as unknown as VendorBillRow
        if (bill.paidP + bill.debitedP > bill.totalP || bill.paidP < 0 || bill.debitedP < 0) {
          fail("OVER_ALLOCATION", { doc: bill.billNo })
        }
      }
    }
  },
}

/**
 * INV-10: a credit invoice for a party on hold or over its credit limit
 * needs an approved credit override recorded on the invoice.
 */
const inv10: Invariant = {
  id: "INV-10",
  tables: ["salesInvoices"],
  async check({ tx, relevant, fail }) {
    for (const c of relevant) {
      if (c.kind !== "insert" || !c.after) continue
      const inv = c.after as unknown as SalesInvoiceRow
      if (inv.kind !== "credit" && inv.kind !== "consolidated") continue
      const party = await tx.get("parties", inv.partyId)
      // Exposure after this invoice: every open invoice of the party.
      const invoices = await tx.list("salesInvoices", "partyId", party.id)
      const exposure = invoices.reduce((s, i) => s + (i.totalP - i.advanceAppliedP - i.paidP - i.creditedP), 0)
      const over = party.creditLimitP > 0 && exposure > party.creditLimitP
      if ((party.status !== "active" || over) && !inv.creditOverrideApprovalId) {
        fail("CREDIT_OVERRIDE_REQUIRED", { party: party.nameEn }, true)
      }
      if (inv.creditOverrideApprovalId) {
        const approval = await tx.find("approvals", inv.creditOverrideApprovalId)
        if (!approval || approval.status !== "approved" || approval.kind !== "credit-override") {
          fail("CREDIT_OVERRIDE_REQUIRED", { party: party.nameEn }, true)
        }
      }
    }
  },
}

/** INV-12: a vendor's bill reference is unique per vendor; a cheque number per bank account. */
const inv12: Invariant = {
  id: "INV-12",
  tables: ["vendorBills", "cheques"],
  async check({ tx, relevant, fail }) {
    for (const c of relevant) {
      if (c.kind !== "insert" || !c.after) continue
      if (c.table === "vendorBills") {
        const bill = c.after as unknown as VendorBillRow
        const same = await tx.list("vendorBills", "[partyId+vendorRef]", [bill.partyId, bill.vendorRef])
        if (same.length > 1) fail("DUPLICATE_VENDOR_REF", { ref: bill.vendorRef }, true)
      } else {
        const cheque = c.after as unknown as { cashBankAccountId: string; chequeNo: string; direction: string }
        const same = await tx.list("cheques", "[cashBankAccountId+chequeNo]", [cheque.cashBankAccountId, cheque.chequeNo])
        if (same.filter((s) => s.direction === cheque.direction).length > 1) {
          fail("DUPLICATE_CHEQUE", { no: cheque.chequeNo }, true)
        }
      }
    }
  },
}

/**
 * INV-13: a period closes only when it has no draft or pending journals and
 * no pending approvals on documents dated in it.
 */
const inv13: Invariant = {
  id: "INV-13",
  tables: ["periods"],
  async check({ tx, relevant, fail }) {
    for (const c of relevant) {
      if (c.kind !== "update" || !c.after || !c.before) continue
      const before = c.before as unknown as PeriodRow
      const period = c.after as unknown as PeriodRow
      if (before.status === "closed" || period.status !== "closed") continue
      const journals = await tx.list("journals", "periodId", period.id)
      if (journals.some((j) => j.status === "draft" || j.status === "pending-approval")) {
        fail("PERIOD_HAS_PENDING", { period: period.code })
      }
      const pending = await tx.list("approvals", "status", "pending")
      for (const a of pending) {
        const doc = (await tx.db.table(a.docType).get(a.docId)) as { date?: string; orderDate?: string } | undefined
        const date = doc?.date ?? doc?.orderDate
        if (date && date >= period.startsOn && date <= period.endsOn) {
          fail("PERIOD_HAS_PENDING", { period: period.code })
        }
      }
    }
  },
}

export const BUSINESS_INVARIANTS: Invariant[] = [inv01, inv02, inv03, inv04, inv05, inv07, inv08, inv09, inv10, inv12, inv13]
