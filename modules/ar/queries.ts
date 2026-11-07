import type { OmniflowDb } from "@/core/db/database"
import { readSetting } from "@/core/db/settings"
import type { AccountTag, ISODate, Id, PartyRow, Poisha, SalesInvoiceRow, VendorBillRow } from "@/core/db/schema"

import { addToBuckets, bucketOf, billOnLedger, billOpenP, daysPastDue, emptyBuckets, invoiceOpenP, type Bucket, type BucketTotals } from "./lib"

/**
 * Read-side queries shared by the AR, AP and CAB screens, the report
 * datasets and the tests: open items with their aging, GL balances by tag
 * and party, customer advances. Each reads committed data with `db` (wrap
 * in useLiveQuery on screens).
 */

export async function accountIdOfTag(db: OmniflowDb, tag: AccountTag): Promise<Id | undefined> {
  const map = await readSetting(db, "postingAccounts")
  return map[tag]
}

/** Signed GL balance (debit positive) of a tag, optionally up to a day. */
export async function glBalanceP(db: OmniflowDb, tag: AccountTag, upTo?: ISODate): Promise<Poisha> {
  const id = await accountIdOfTag(db, tag)
  if (!id) return 0
  const lines = await db.journalLines.where("accountId").equals(id).toArray()
  let sum = 0
  for (const l of lines) if (!upTo || l.date <= upTo) sum += l.debitP - l.creditP
  return sum
}

/** Signed GL balance per party of a party tag (AR_CONTROL, AP_CONTROL, CUSTOMER_ADVANCE). */
export async function glByParty(db: OmniflowDb, tag: AccountTag): Promise<Map<Id, Poisha>> {
  const id = await accountIdOfTag(db, tag)
  const out = new Map<Id, Poisha>()
  if (!id) return out
  const lines = await db.journalLines.where("accountId").equals(id).toArray()
  for (const l of lines) {
    if (!l.partyId) continue
    out.set(l.partyId, (out.get(l.partyId) ?? 0) + l.debitP - l.creditP)
  }
  return out
}

/** Open customer advances per party (credit balances on CUSTOMER_ADVANCE), positive. */
export async function customerAdvances(db: OmniflowDb): Promise<Map<Id, Poisha>> {
  const signed = await glByParty(db, "CUSTOMER_ADVANCE")
  const out = new Map<Id, Poisha>()
  for (const [party, v] of signed) if (-v !== 0) out.set(party, -v)
  return out
}

export type ArOpenItem = {
  invoice: SalesInvoiceRow
  party: PartyRow | undefined
  openP: Poisha
  availableP: Poisha
  dpd: number
  bucket: Bucket
}

/** Every invoice with an open amount, with days past due and bucket on `today`. */
export async function arOpenItems(db: OmniflowDb, today: ISODate, partyId?: Id): Promise<ArOpenItem[]> {
  const invoices = partyId
    ? (await db.salesInvoices.where("partyId").equals(partyId).toArray()).filter((i) => i.status === "posted" || i.status === "partially-paid")
    : await db.salesInvoices.where("status").anyOf("posted", "partially-paid").toArray()
  const open = invoices.filter((i) => invoiceOpenP(i) > 0)
  const parties = new Map((await db.parties.bulkGet([...new Set(open.map((i) => i.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
  return open.map((invoice) => {
    const dpd = daysPastDue(invoice.dueDate, today)
    const openP = invoiceOpenP(invoice)
    return { invoice, party: parties.get(invoice.partyId), openP, availableP: openP - invoice.reservedP, dpd, bucket: bucketOf(dpd) }
  })
}

export type ApOpenItem = {
  bill: VendorBillRow
  vendor: PartyRow | undefined
  openP: Poisha
  dpd: number
  bucket: Bucket
}

/** Every posted bill with an open amount (bills on hold are not on AP yet). */
export async function apOpenItems(db: OmniflowDb, today: ISODate, partyId?: Id): Promise<ApOpenItem[]> {
  const bills = partyId
    ? await db.vendorBills.where("partyId").equals(partyId).toArray()
    : await db.vendorBills.where("status").anyOf("posted", "partially-paid").toArray()
  const open = bills.filter((b) => billOnLedger(b) && billOpenP(b) > 0)
  const vendors = new Map((await db.parties.bulkGet([...new Set(open.map((b) => b.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
  return open.map((bill) => {
    const dpd = daysPastDue(bill.dueDate, today)
    return { bill, vendor: vendors.get(bill.partyId), openP: billOpenP(bill), dpd, bucket: bucketOf(dpd) }
  })
}

export type AgingRow = { partyId: Id; party: PartyRow | undefined; buckets: BucketTotals; advanceP: number }

/** Aging by party for AR (customers, with advances) or AP (vendors), with the control-account tie. */
export async function loadAging(db: OmniflowDb, today: string, side: "ar" | "ap") {
  const rows = new Map<Id, AgingRow>()
  const totals = emptyBuckets()
  const get = (partyId: Id, party: PartyRow | undefined) => {
    let r = rows.get(partyId)
    if (!r) {
      r = { partyId, party, buckets: emptyBuckets(), advanceP: 0 }
      rows.set(partyId, r)
    }
    return r
  }
  if (side === "ar") {
    for (const i of await arOpenItems(db, today)) {
      addToBuckets(get(i.invoice.partyId, i.party).buckets, i.bucket, i.openP)
      addToBuckets(totals, i.bucket, i.openP)
    }
  } else {
    for (const i of await apOpenItems(db, today)) {
      addToBuckets(get(i.bill.partyId, i.vendor).buckets, i.bucket, i.openP)
      addToBuckets(totals, i.bucket, i.openP)
    }
  }
  let advancesP = 0
  if (side === "ar") {
    const adv = await customerAdvances(db)
    const missing = [...adv.keys()].filter((id) => !rows.has(id))
    const extra = new Map((await db.parties.bulkGet(missing)).filter(Boolean).map((p) => [p!.id, p!]))
    for (const [partyId, v] of adv) {
      get(partyId, extra.get(partyId) ?? rows.get(partyId)?.party).advanceP = v
      advancesP += v
    }
  }
  const controlTag: AccountTag = side === "ar" ? "AR_CONTROL" : "AP_CONTROL"
  const control = await glBalanceP(db, controlTag)
  const advanceGl = side === "ar" ? -(await glBalanceP(db, "CUSTOMER_ADVANCE")) : 0
  return {
    rows: [...rows.values()].sort((a, b) => b.buckets.total - a.buckets.total || b.advanceP - a.advanceP),
    totals,
    advancesP,
    // AR is a debit balance, AP a credit balance: compare the open amounts with the signed GL.
    controlP: side === "ar" ? control : -control,
    advanceGlP: advanceGl,
  }
}

