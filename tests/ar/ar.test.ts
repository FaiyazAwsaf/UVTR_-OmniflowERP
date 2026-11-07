import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { defaultTaxSettings } from "@/config/rules.config"
import { now } from "@/core/clock/clock"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import type { SweepContext } from "@/core/clock/types"
import type { OmniflowDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { PermissionDenied } from "@/core/engine/errors"
import { SYSTEM_ACTOR, type Actor } from "@/core/engine/types"
import { recordReceipt, recordRefund, sendReminder } from "@/modules/ar/commands"
import { arJobs } from "@/modules/ar/jobs"
import { allocateOldestFirst, bucketOf, cashFor, daysPastDue } from "@/modules/ar/lib"
import { arOpenItems, customerAdvances } from "@/modules/ar/queries"
import { updateCheque } from "@/modules/cab/commands"

import { signedIn } from "../helpers/foundation"
import { allBalanced, finDb, gl, postInvoice, run, T } from "./fin-helpers"

let db: OmniflowDb
let mahbub: Actor
const today = () => dhakaDate(now())

beforeEach(async () => {
  db = await finDb("ar")
  mahbub = await signedIn(db, "mahbub")
})
afterEach(async () => {
  await db.delete()
})

const sweep = (): SweepContext => ({
  db,
  now: now(),
  commitSystem: ((def, input) => commit(def, input, { db, actor: SYSTEM_ACTOR })) as SweepContext["commitSystem"],
})

describe("aging and allocation helpers", () => {
  it("buckets days past due: not yet due, 0 to 30, 31 to 60, 61 to 90, over 90", () => {
    expect(bucketOf(-1)).toBe("current")
    expect(bucketOf(0)).toBe("d0_30")
    expect(bucketOf(30)).toBe("d0_30")
    expect(bucketOf(31)).toBe("d31_60")
    expect(bucketOf(61)).toBe("d61_90")
    expect(bucketOf(91)).toBe("over90")
    expect(daysPastDue("2026-10-01", "2026-11-07")).toBe(37)
  })

  it("allocates cash oldest first, grossed up for VDS and AIT", () => {
    const party = { deductsVds: true, deductsAit: true }
    const inv = (id: string, date: string) => ({ id, date, dueDate: date, invoiceNo: id, vatP: T(15_000), totalP: T(1_15_000), availableP: T(1_15_000) })
    // A full invoice costs the customer 1,15,000 − 15,000 VDS − 5,000 AIT = 95,000.
    expect(cashFor(party, inv("a", "2026-01-01"), T(1_15_000), defaultTaxSettings)).toBe(T(95_000))
    const r = allocateOldestFirst(T(1_20_000), [inv("b", "2026-02-01"), inv("a", "2026-01-01")], party, defaultTaxSettings)
    expect(r.allocations[0]).toEqual({ invoiceId: "a", amountP: T(1_15_000) })
    expect(r.allocations[1].invoiceId).toBe("b")
    expect(cashFor(party, inv("b", "x"), r.allocations[1].amountP, defaultTaxSettings)).toBeLessThanOrEqual(T(25_000))
    expect(r.restP).toBeLessThan(2)
  })
})

describe("ar.recordReceipt (R8)", () => {
  it("records a fleet receipt with VDS and AIT deducted: bank, VAT current and AIT paid debited, AR credited", async () => {
    const invoiceId = await postInvoice(db, { partyId: "pty_fleet", netP: T(1_00_000) })
    const input = {
      partyId: "pty_fleet",
      method: "bank-transfer" as const,
      cashBankAccountId: "cba_brac",
      amountP: T(95_000),
      allocations: [{ invoiceId, amountP: T(1_15_000) }],
      vdsDeductedP: T(15_000),
      aitDeductedP: T(5_000),
      idempotencyKey: "mr-test-1",
    }
    await expect(run(db, recordReceipt, { ...input, idempotencyKey: "mr-test-0" }, mahbub)).rejects.toMatchObject({ code: "CERTIFICATE_REQUIRED" })
    const r = await run(db, recordReceipt, { ...input, certificateNo: "6.6/2026/101" }, mahbub)
    expect(r.status).toBe("posted")
    expect(r.receiptNo).toMatch(/^MR-HQ-\d{4}-\d{6}$/)
    const receipt = (await db.receipts.get(r.receiptId))!
    const journal = (await db.journals.get(receipt.journalId!))!
    expect(journal.rule).toBe("R8")
    expect(journal.source).toMatchObject({ app: "ar", docType: "receipts", docId: receipt.id })
    expect(await gl(db, "AR_CONTROL", "pty_fleet")).toBe(0)
    expect(await gl(db, "VAT_CURRENT")).toBe(T(15_000))
    expect(await gl(db, "AIT_PAID")).toBe(T(5_000))
    expect(await db.salesInvoices.get(invoiceId)).toMatchObject({ paidP: T(1_15_000), status: "paid" })
    expect(await allBalanced(db)).toBe(true)
    // Idempotent: the same key commits once.
    await run(db, recordReceipt, { ...input, certificateNo: "6.6/2026/101" }, mahbub)
    expect(await db.receipts.count()).toBe(1)
  })

  it("is refused without ar.receipt.create and outside the cashier's studio", async () => {
    const rakib = await signedIn(db, "rakib")
    const base = { partyId: "pty_retail", method: "cash" as const, amountP: T(1_000), idempotencyKey: "mr-x" }
    await expect(run(db, recordReceipt, base, rakib)).rejects.toBeInstanceOf(PermissionDenied)
    const tania = await signedIn(db, "tania")
    await expect(run(db, recordReceipt, { ...base, locationId: "loc_utt", idempotencyKey: "mr-y" }, tania)).rejects.toMatchObject({ code: "OUT_OF_SCOPE" })
    const r = await run(db, recordReceipt, { ...base, locationId: "loc_gul", cashBankAccountId: "cba_till_gul", idempotencyKey: "mr-z" }, tania)
    expect(r.receiptNo).toMatch(/^MR-GUL-/)
    expect((await customerAdvances(db)).get("pty_retail")).toBe(T(1_000))
  })

  it("keeps a cheque in hand reserving the invoice; clearing posts R10, a bounce releases it with a notice", async () => {
    const inv1 = await postInvoice(db, { partyId: "pty_retail", netP: T(10_000) })
    const inv2 = await postInvoice(db, { partyId: "pty_retail", netP: T(20_000) })
    const cheque = (no: string, invoiceId: string, amountP: number, chequeDate = today()) => ({
      partyId: "pty_retail",
      method: "cheque" as const,
      cashBankAccountId: "cba_dbbl",
      amountP,
      allocations: [{ invoiceId, amountP }],
      cheque: { chequeNo: no, bankName: "City Bank", chequeDate },
      idempotencyKey: `mr-${no}`,
    })
    const pdc = await run(db, recordReceipt, cheque("5550001", inv2, T(23_000), addDaysISO(today(), 2)), mahbub)
    expect(pdc.status).toBe("pending")
    expect((await db.salesInvoices.get(inv2))?.reservedP).toBe(T(23_000))
    const pdcRow = (await db.cheques.where("receiptId").equals(pdc.receiptId).first())!
    expect(pdcRow).toMatchObject({ status: "in-hand", isPdc: true })
    await expect(run(db, updateCheque, { chequeId: pdcRow.id, action: "deposit", expectedVersion: pdcRow.version }, mahbub)).rejects.toMatchObject({ code: "PDC_NOT_DUE" })

    const ok = await run(db, recordReceipt, cheque("5550002", inv1, T(11_500)), mahbub)
    let row = (await db.cheques.where("receiptId").equals(ok.receiptId).first())!
    await run(db, updateCheque, { chequeId: row.id, action: "deposit", expectedVersion: row.version }, mahbub)
    row = (await db.cheques.get(row.id))!
    await run(db, updateCheque, { chequeId: row.id, action: "clear", expectedVersion: row.version }, mahbub)
    const cleared = (await db.receipts.get(ok.receiptId))!
    expect(cleared.status).toBe("posted")
    expect((await db.journals.get(cleared.journalId!))?.rule).toBe("R10")
    expect(await db.salesInvoices.get(inv1)).toMatchObject({ paidP: T(11_500), reservedP: 0, status: "paid" })

    // Bounce the post-dated one: nothing posts, the invoice is open again, the customer gets an SMS.
    const before = await db.journals.count()
    await run(db, updateCheque, { chequeId: pdcRow.id, action: "bounce", expectedVersion: pdcRow.version }, mahbub)
    expect(await db.journals.count()).toBe(before)
    expect(await db.salesInvoices.get(inv2)).toMatchObject({ reservedP: 0, paidP: 0, status: "posted" })
    expect((await db.receipts.get(pdc.receiptId))?.status).toBe("bounced")
    const sms = await db.sms.toArray()
    expect(sms.some((s) => s.templateId === "cheque-bounced" && s.text.includes("5550001"))).toBe(true)
    expect(await allBalanced(db)).toBe(true)
  })
})

describe("ar.recordRefund (R28)", () => {
  it("refunds no more than the advance held", async () => {
    await run(db, recordReceipt, { partyId: "pty_retail", method: "cash", cashBankAccountId: "cba_till_gul", locationId: "loc_gul", amountP: T(5_000), idempotencyKey: "mr-adv" }, mahbub)
    const shahriar = await signedIn(db, "shahriar")
    const base = { partyId: "pty_retail", locationId: "loc_gul", method: "cash" as const, cashBankAccountId: "cba_till_gul", source: "deposit" as const, reason: "Booking cancelled" }
    await expect(run(db, recordRefund, { ...base, amountP: T(6_000), idempotencyKey: "rf-1" }, shahriar)).rejects.toMatchObject({ code: "REFUND_EXCEEDS_ADVANCE" })
    const r = await run(db, recordRefund, { ...base, amountP: T(3_000), idempotencyKey: "rf-2" }, shahriar)
    expect(r.refundNo).toMatch(/^RF-GUL-\d{4}-\d{4}$/)
    const refund = (await db.customerRefunds.get(r.refundId))!
    expect((await db.journals.get(refund.journalId))?.rule).toBe("R28")
    expect(-(await gl(db, "CUSTOMER_ADVANCE", "pty_retail"))).toBe(T(2_000))
    const tania = await signedIn(db, "tania")
    await expect(run(db, recordRefund, { ...base, amountP: T(1_000), idempotencyKey: "rf-3" }, tania)).rejects.toBeInstanceOf(PermissionDenied)
  })
})

describe("credit hold (ar.creditHold) and reminders", () => {
  it("holds a customer once when an invoice is over 60 days past due; a receipt back within terms releases it", async () => {
    const invoiceId = await postInvoice(db, { partyId: "pty_fleet", netP: T(40_000), date: addDaysISO(today(), -100), dueDate: addDaysISO(today(), -70) })
    await arJobs[0].run(sweep())
    const held = (await db.parties.get("pty_fleet"))!
    expect(held.status).toBe("on-hold")
    expect(held.autoHoldAt).toBeTruthy()
    const v = held.version
    await arJobs[0].run(sweep())
    expect((await db.parties.get("pty_fleet"))?.version).toBe(v)

    const r = await run(
      db,
      recordReceipt,
      { partyId: "pty_fleet", method: "bank-transfer", cashBankAccountId: "cba_brac", amountP: T(46_000), allocations: [{ invoiceId, amountP: T(46_000) }], idempotencyKey: "mr-hold" },
      mahbub
    )
    expect(r.released).toBe(true)
    expect(await db.parties.get("pty_fleet")).toMatchObject({ status: "active" })
    expect((await db.events.toArray()).map((e) => e.type)).toEqual(expect.arrayContaining(["CreditHoldSet", "CreditHoldReleased"]))
  })

  it("sends an invoice-due SMS per overdue invoice (numbers, dates and amounts only)", async () => {
    await postInvoice(db, { partyId: "pty_fleet", netP: T(10_000), dueDate: addDaysISO(today(), -5) })
    const r = await run(db, sendReminder, { partyId: "pty_fleet" }, mahbub)
    expect(r.sent).toBe(1)
    const sms = (await db.sms.toArray()).filter((s) => s.templateId === "invoice-due")
    expect(sms[0].text).toMatch(/INV-GUL-\d{4}-\d{6}/)
    await expect(run(db, sendReminder, { partyId: "pty_retail" }, mahbub)).rejects.toMatchObject({ code: "NOTHING_OVERDUE" })
    const tania = await signedIn(db, "tania")
    await expect(run(db, sendReminder, { partyId: "pty_fleet" }, tania)).rejects.toBeInstanceOf(PermissionDenied)
  })

  it("lists open items with their bucket and the totals tie to AR_CONTROL", async () => {
    await postInvoice(db, { partyId: "pty_fleet", netP: T(10_000), dueDate: addDaysISO(today(), -40) })
    await postInvoice(db, { partyId: "pty_retail", netP: T(5_000), dueDate: addDaysISO(today(), 10) })
    const items = await arOpenItems(db, today())
    expect(items.map((i) => i.bucket).sort()).toEqual(["current", "d31_60"])
    expect(items.reduce((s, i) => s + i.openP, 0)).toBe(await gl(db, "AR_CONTROL"))
  })
})
