import type { OmniflowDb } from "@/core/db/database"
import type {
  AccountTag,
  Id,
  InventoryTag,
  JournalLineRow,
} from "@/core/db/schema"
import { accountIdOf, CHART, defaultPostingMap } from "@/core/ledger/chart"
import { trialBalance, type AccountInfo } from "@/core/ledger/statements"

/**
 * The books tie (plan §11 "Must"): every journal balances, the trial balance
 * ties, and every subledger equals its control account: AR and AP per party,
 * customer advances per party, GRNI per vendor, inventory per tag and
 * location, goods in transit. Read from a live database, so it can run after
 * every launcher; returns the problems found (empty when the books tie).
 */

const MAP = defaultPostingMap()

function balance(
  lines: JournalLineRow[],
  tag: AccountTag,
  opts: { partyId?: Id; locationId?: Id } = {}
): number {
  const id = MAP[tag]
  let sum = 0
  for (const l of lines) {
    if (l.accountId !== id) continue
    if (opts.partyId && l.partyId !== opts.partyId) continue
    if (opts.locationId && l.locationId !== opts.locationId) continue
    sum += l.debitP - l.creditP
  }
  return sum
}

function accounts(): AccountInfo[] {
  return CHART.map((c) => ({
    id: accountIdOf(c.code),
    code: c.code,
    nameEn: c.nameEn,
    nameBn: c.nameBn,
    type: c.type,
    parentId: c.parent ? accountIdOf(c.parent) : undefined,
    isGroup: !!c.group,
    normalSide:
      (c.type === "asset" || c.type === "expense") !== !!c.contra
        ? "debit"
        : "credit",
    tag: c.tag,
    isControl: !!c.control,
  }))
}

/** Per-key sums that differ (expected from the documents, actual from the GL). */
function compare(
  label: string,
  expected: Map<string, number>,
  actual: (key: string) => number,
  total: number
): string[] {
  const out: string[] = []
  let sum = 0
  for (const [key, value] of expected) {
    sum += value
    const gl = actual(key)
    if (gl !== value) out.push(`${label} ${key}: documents ${value}, GL ${gl}`)
  }
  if (sum !== total) out.push(`${label} total: documents ${sum}, GL ${total}`)
  return out
}

const add = (m: Map<string, number>, key: string, v: number) =>
  m.set(key, (m.get(key) ?? 0) + v)

export async function tieProblems(db: OmniflowDb): Promise<string[]> {
  const problems: string[] = []
  const lines = await db.journalLines.toArray()

  // Every journal balances; the trial balance ties.
  const byJournal = new Map<string, number>()
  for (const l of lines) add(byJournal, l.journalId, l.debitP - l.creditP)
  for (const [journalId, diff] of byJournal)
    if (diff !== 0) problems.push(`journal ${journalId} off by ${diff}`)
  const tb = trialBalance(accounts(), lines, {
    from: "2000-01-01",
    to: "2999-12-31",
  })
  if (!tb.balanced) problems.push("trial balance does not tie")

  // AR: open invoices per party.
  const ar = new Map<string, number>()
  for (const inv of await db.salesInvoices.toArray()) {
    add(
      ar,
      inv.partyId,
      inv.totalP - inv.advanceAppliedP - inv.paidP - inv.creditedP
    )
  }
  problems.push(
    ...compare(
      "AR",
      ar,
      (p) => balance(lines, "AR_CONTROL", { partyId: p }),
      balance(lines, "AR_CONTROL")
    )
  )

  // AP: open posted bills per vendor (a bill on hold has not posted).
  const ap = new Map<string, number>()
  for (const b of await db.vendorBills.toArray()) {
    if (b.status === "on-hold") continue
    add(ap, b.partyId, b.totalP - b.paidP - b.debitedP)
  }
  problems.push(
    ...compare(
      "AP",
      ap,
      (p) => -balance(lines, "AP_CONTROL", { partyId: p }),
      -balance(lines, "AP_CONTROL")
    )
  )

  // Customer advances: posted receipts' excess and credit notes kept as advance, less what invoices applied and refunds.
  const adv = new Map<string, number>()
  for (const r of await db.receipts.toArray())
    if (r.status === "posted") add(adv, r.partyId, r.advanceP)
  for (const cn of await db.creditNotes.toArray())
    if (cn.status === "posted") add(adv, cn.partyId, cn.toAdvanceP ?? 0)
  for (const inv of await db.salesInvoices.toArray())
    add(adv, inv.partyId, -inv.advanceAppliedP)
  for (const rf of await db.customerRefunds.toArray())
    add(adv, rf.partyId, -rf.amountP)
  problems.push(
    ...compare(
      "Customer advance",
      adv,
      (p) => -balance(lines, "CUSTOMER_ADVANCE", { partyId: p }),
      -balance(lines, "CUSTOMER_ADVANCE")
    )
  )

  // GRNI: accepted, not yet billed GRN lines per vendor.
  const grns = new Map((await db.grns.toArray()).map((g) => [g.id, g]))
  const grni = new Map<string, number>()
  for (const l of await db.grnLines.toArray()) {
    const grn = grns.get(l.grnId)
    if (!grn) continue
    add(
      grni,
      grn.vendorId,
      Math.round((l.qtyAccepted - l.qtyBilled) * l.unitCostP)
    )
  }
  problems.push(
    ...compare(
      "GRNI",
      grni,
      (p) => -balance(lines, "GRNI", { partyId: p }),
      -balance(lines, "GRNI")
    )
  )

  // Inventory per tag and location equals the stock value; in transit equals dispatched transfers.
  const items = new Map((await db.items.toArray()).map((i) => [i.id, i]))
  const cats = new Map(
    (await db.itemCategories.toArray()).map((c) => [c.id, c.inventoryTag])
  )
  const value = new Map<string, number>()
  for (const v of await db.stockValues.toArray()) {
    const tag = cats.get(items.get(v.itemId)!.categoryId)!
    add(value, `${v.locationId}|${tag}`, v.valueP)
  }
  for (const loc of ["loc_cst", "loc_gul", "loc_utt", "loc_hq"]) {
    for (const tag of [
      "INV_CHEMICAL",
      "INV_CONSUMABLE",
      "INV_RETAIL",
    ] as InventoryTag[]) {
      const gl = balance(lines, tag, { locationId: loc })
      const stock = value.get(`${loc}|${tag}`) ?? 0
      if (gl !== stock)
        problems.push(`Inventory ${loc} ${tag}: stock ${stock}, GL ${gl}`)
    }
  }
  const dispatched = new Set(
    (await db.transfers.toArray())
      .filter((t) => t.status === "dispatched")
      .map((t) => t.id)
  )
  const transit = (await db.transferLines.toArray())
    .filter((l) => dispatched.has(l.transferId))
    .reduce((s, l) => s + l.valueP, 0)
  const transitGl = balance(lines, "INV_TRANSIT")
  if (transit !== transitGl)
    problems.push(`In transit: transfers ${transit}, GL ${transitGl}`)

  return problems
}
