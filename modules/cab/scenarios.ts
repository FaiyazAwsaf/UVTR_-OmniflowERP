import { addDaysISO } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import type { Id, ISODate, SalesInvoiceRow } from "@/core/db/schema"
import { readSetting } from "@/core/db/settings"
import { lastMonth, previousRuns } from "@/core/scenarios/helpers"
import type { ScenarioDef } from "@/core/scenarios/types"
import { CBA, PLANT, PTY } from "@/core/seed/content/seed-refs"
import { isoWeekday } from "@/core/seed/time"

import { recordReceipt } from "@/modules/ar/commands"
import { accountIdOfTag } from "@/modules/ar/queries"
import { allocateOldestFirst, cashFor, deductionsFor, grossUp, invoiceAvailableP, invoiceOpenP, oldestFirst } from "@/modules/ar/lib"
import { reopenPeriod } from "@/modules/fa/commands"

import { importStatement, updateCheque } from "./commands"

/**
 * CAB scenario launchers (implementation_plan.md §10): E7 bank
 * reconciliation and E8 post-dated cheque bounce. Setups run real commands
 * as the story's users and create fresh documents on every run.
 */

/** The bank's last working day of a month (Bangladesh banks close on Friday and Saturday). */
export function lastWorkingDay(lastDay: ISODate): ISODate {
  let day = lastDay
  while (isoWeekday(day) === 5 || isoWeekday(day) === 6) day = addDaysISO(day, -1)
  return day
}

/** E7: the Skyline deposit the bank credits this many days after the books dated it. */
const E7_DAYS_LATE = 5
const E7_DEPOSIT_P = 12_000_00

const e7: ScenarioDef = {
  id: "E7",
  kind: "scenario",
  module: "cab",
  titleKey: "cab.scenarios.E7.title",
  summaryKey: "cab.scenarios.E7.summary",
  user: "mahbub",
  async setup(kit) {
    const db = kit.db
    const month = lastMonth(kit.today())
    // Last month must be open: an earlier close (E11) is reopened by Farzana with a reason.
    const period = (await db.periods.toArray()).find((p) => p.startsOn === month.firstDay)
    if (period?.status === "closed") {
      await kit.run(
        reopenPeriod,
        { periodId: period.id, expectedVersion: period.version, reason: "Bank statement for the month arrived: reconcile and post the bank's charges" },
        "farzana"
      )
    }
    // A fresh Skyline Logistics receipt by bank transfer, dated 5 days before the bank's last working day.
    const bankDay = lastWorkingDay(month.lastDay)
    const receiptDate = addDaysISO(bankDay, -E7_DAYS_LATE)
    const transferRef = `NPSB${bankDay.replaceAll("-", "").slice(2)}${kit.runId.slice(-4).toUpperCase()}`
    const receipt = await kit.run(
      recordReceipt,
      {
        partyId: PTY.skyline,
        date: receiptDate,
        method: "bank-transfer",
        cashBankAccountId: CBA.BRAC,
        amountP: E7_DEPOSIT_P,
        ref: transferRef,
        idempotencyKey: `e7-mr-${kit.runId}`,
      },
      "mahbub"
    )
    const receiptRow = await db.receipts.get(receipt.receiptId)
    const bankGl = await accountIdOfTag(db, "BANK_MAIN")
    const bookLine = receiptRow?.journalId
      ? (await db.journalLines.where("journalId").equals(receiptRow.journalId).toArray()).find((l) => l.accountId === bankGl)
      : undefined
    if (!bookLine) throw new Error("E7: the receipt did not post to the bank")
    // BRAC's file for last month: the books, a new ৳575 charge, and the Skyline deposit on the bank's own date and reference.
    const imported = await kit.run(
      importStatement,
      {
        cashBankAccountId: CBA.BRAC,
        fromDate: month.firstDay,
        toDate: month.lastDay,
        includeCharge: true,
        omit: [bookLine.id],
        extra: [{ date: bankDay, description: "NPSB inward transfer, SKYLINE LOGISTICS LTD", ref: transferRef, amountP: E7_DEPOSIT_P }],
      },
      "mahbub"
    )
    const statement = await db.bankStatements.get(imported.statementId)
    const charge = statement?.lines.find((l) => l.ref.startsWith("SC") && l.amountP < 0 && l.lineId.startsWith("bx_"))
    return {
      refs: { statementId: imported.statementId, receiptId: receipt.receiptId, partyId: PTY.skyline },
      params: {
        file: statement?.fileName ?? "",
        lines: imported.lines,
        autoLines: imported.lines - 2,
        chargeP: charge ? -charge.amountP : 575_00,
        depositP: E7_DEPOSIT_P,
        receiptNo: receipt.receiptNo,
        days: E7_DAYS_LATE,
        transferRef,
      },
    }
  },
  route: (o) => `/cab/reconciliation?id=${o.refs?.statementId ?? ""}`,
  cueKeys: ["cab.scenarios.E7.cue1", "cab.scenarios.E7.cue2", "cab.scenarios.E7.cue3", "cab.scenarios.E7.cue4", "cab.scenarios.E7.cue5"],
}

/** E8: Metro Corporate Fleet's post-dated cheque. */
const E8_CHEQUE_P = 85_000_00

/** A cheque number no cheque on this account carries yet (INV-12). */
async function freshChequeNo(db: OmniflowDb, accountId: Id, start: number): Promise<string> {
  const used = new Set((await db.cheques.toArray()).filter((c) => c.cashBankAccountId === accountId).map((c) => c.chequeNo))
  for (let n = start; ; n++) if (!used.has(String(n))) return String(n)
}

/**
 * Where the cheque goes: the oldest open invoice that can take all of it
 * (grossed up for the VDS and AIT Metro deducts); else oldest first across
 * the open invoices, the rest as advance.
 */
function allocationFor(party: { deductsVds: boolean; deductsAit: boolean }, invoices: SalesInvoiceRow[], cashP: number, tax: Parameters<typeof cashFor>[3]) {
  const open = invoices.filter((i) => invoiceAvailableP(i) > 0).sort(oldestFirst)
  for (const inv of open) {
    const available = invoiceAvailableP(inv)
    const a = grossUp(party, inv, cashP, available, tax)
    if (a > 0 && cashP - cashFor(party, inv, a, tax) <= 1) return [{ invoiceId: inv.id, amountP: a }]
  }
  return allocateOldestFirst(cashP, open.map((i) => ({ ...i, availableP: invoiceAvailableP(i) })), party, tax).allocations
}

const e8: ScenarioDef = {
  id: "E8",
  kind: "scenario",
  module: "cab",
  titleKey: "cab.scenarios.E8.title",
  summaryKey: "cab.scenarios.E8.summary",
  user: "mahbub",
  async setup(kit) {
    const db = kit.db
    const today = kit.today()
    const party = await db.parties.get(PTY.metroFleet)
    if (!party) throw new Error("E8: Metro Corporate Fleet is missing")
    // Re-run rule: earlier E8 cheques (and the seed's planted one) still in hand
    // go back to the customer, so this run's cheque reserves the invoice afresh.
    const earlier = new Set([PLANT.e8Cheque, ...(await previousRuns(db, "E8")).map((r) => r.refs.chequeId).filter((id): id is string => !!id)])
    for (const id of earlier) {
      const cheque = await db.cheques.get(id)
      if (cheque?.status !== "in-hand" || cheque.direction !== "received") continue
      await kit.run(updateCheque, { chequeId: id, action: "return", expectedStatus: "in-hand", reason: "Demo re-run: the customer takes the earlier cheque back" }, "mahbub")
    }
    const tax = await readSetting(db, "tax")
    const invoices = (await db.salesInvoices.where("partyId").equals(party.id).toArray()).filter((i) => i.status === "posted" || i.status === "partially-paid")
    const allocations = allocationFor(party, invoices, E8_CHEQUE_P, tax)
    const byId = new Map(invoices.map((i) => [i.id, i]))
    const d = deductionsFor(party, allocations, byId, tax)
    const chequeNo = await freshChequeNo(db, CBA.DBBL, 5_210_101)
    const receipt = await kit.run(
      recordReceipt,
      {
        partyId: party.id,
        date: addDaysISO(today, -1),
        method: "cheque",
        cashBankAccountId: CBA.DBBL,
        amountP: E8_CHEQUE_P,
        allocations,
        vdsDeductedP: d.vdsP,
        aitDeductedP: d.aitP,
        certificateNo: d.vdsP + d.aitP > 0 ? `MCF/6.6/${today.slice(2, 4)}${today.slice(5, 7)}/${chequeNo.slice(-3)}` : undefined,
        cheque: { chequeNo, bankName: "City Bank", chequeDate: today },
        idempotencyKey: `e8-mr-${kit.runId}`,
      },
      "mahbub"
    )
    const row = await db.receipts.get(receipt.receiptId)
    const first = allocations[0] ? byId.get(allocations[0].invoiceId) : undefined
    return {
      refs: { chequeId: row?.chequeId, receiptId: receipt.receiptId, partyId: party.id, ...(first ? { invoiceId: first.id } : {}) },
      params: {
        chequeNo,
        amountP: E8_CHEQUE_P,
        receiptNo: receipt.receiptNo,
        invoiceNo: first?.invoiceNo ?? "-",
        reservedP: allocations[0]?.amountP ?? 0,
        openP: first ? invoiceOpenP(first) : 0,
        // What the invoice has to collect again once the cheque bounces (read before this receipt reserved it).
        collectP: first ? invoiceAvailableP(first) : 0,
      },
    }
  },
  route: (o) => `/cab/cheques?id=${o.refs?.chequeId ?? ""}`,
  cueKeys: ["cab.scenarios.E8.cue1", "cab.scenarios.E8.cue2", "cab.scenarios.E8.cue3", "cab.scenarios.E8.cue4", "cab.scenarios.E8.cue5"],
}

/** CAB scenario launchers (implementation_plan.md §10). */
export const cabScenarios: ScenarioDef[] = [e7, e8]
