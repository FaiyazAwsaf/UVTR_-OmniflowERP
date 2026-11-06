import { rules } from "@/config/rules.config"
import type { AccountTag, ISODate, Id } from "@/core/db/schema"
import { linesForContra, linesForSettlement } from "@/core/ledger/rules"
import { percentOf } from "@/core/tax/vat"

import { CBA, LOC, USR } from "../content/seed-refs"
import type { World } from "../engine/world"
import { dhakaAt, isoAddDays, lastOfMonth } from "../time"
import { isBatchEnd } from "./volumes"

/**
 * Treasury (seed_data.md §7.1, R17, R18), run last over the cash flows of
 * every other document: card clearing settled to BRAC the next day (fee
 * 1.5%), bKash and Nagad every 3 days (1.0% and 0.9%), till cash above the
 * float deposited to Dutch-Bangla each evening, petty cash topped up to its
 * imprest at each month end, and a weekly transfer from Dutch-Bangla that
 * keeps BRAC above ৳10,00,000 (sooner when a large payment is due). No
 * cash, bank or wallet balance goes below zero on any day.
 */

const CASH_TAGS: AccountTag[] = ["CASH_TILL_GUL", "CASH_TILL_UTT", "PETTY_HQ", "PETTY_GUL", "PETTY_UTT", "BANK_MAIN", "BANK_COLLECTION", "MFS_BKASH", "MFS_NAGAD", "CARD_CLEARING"]
const T = (taka: number) => taka * 100
const BRAC_FLOOR = T(10_00_000)
const DBBL_BUFFER = T(50_000)

export function seedTreasury(w: World): void {
  const { F, today, now } = w.cal
  // Daily net flow per tag from every posted line so far.
  const flows = new Map<string, number>()
  for (const l of w.ledger.lines) {
    if (!l.tag || !CASH_TAGS.includes(l.tag)) continue
    const k = `${l.tag}|${l.row.date}`
    flows.set(k, (flows.get(k) ?? 0) + l.row.debitP - l.row.creditP)
  }
  const flow = (tag: AccountTag, day: ISODate) => flows.get(`${tag}|${day}`) ?? 0
  const bal = new Map<AccountTag, number>(CASH_TAGS.map((t) => [t, 0]))
  const add = (tag: AccountTag, v: number) => bal.set(tag, bal.get(tag)! + v)
  const get = (tag: AccountTag) => bal.get(tag)!

  const transfer = (kind: "deposit" | "transfer" | "top-up", from: { id: Id; tag: AccountTag; loc?: Id }, to: { id: Id; tag: AccountTag; loc?: Id }, amountP: number, day: ISODate, hhmm: string, by: Id) => {
    const at = dhakaAt(day, hhmm)
    const id = w.ctx.seq("ct")
    const row = w.ctx.bag.put("fundTransfers", id, at, { transferNo: "", kind, fromAccountId: from.id, toAccountId: to.id, amountP, feesP: 0, date: day, ref: kind === "deposit" ? `DS-${day.replace(/-/g, "")}` : undefined, journalId: "" }, by)
    w.number("CT", { date: day }, at, (no) => {
      row.transferNo = no
    })
    const label = kind === "deposit" ? "Till cash deposited to Dutch-Bangla Bank" : kind === "top-up" ? "Petty cash topped up to the imprest" : "Transfer from Dutch-Bangla Bank to BRAC Bank"
    row.journalId = w.ledger.post({
      rule: "R17",
      date: day,
      at,
      lines: linesForContra({ fromTag: from.tag, toTag: to.tag, amountP, fromLocationId: from.loc, toLocationId: to.loc }),
      narration: () => `${label}, ${row.transferNo}`,
      source: { app: "cab", docType: "fundTransfers", docId: id, docNo: () => row.transferNo },
      preparedBy: by,
    }).id
    add(from.tag, -amountP)
    add(to.tag, amountP)
  }

  const settle = (kind: "card" | "bkash" | "nagad", day: ISODate, hhmm: string) => {
    const tag: AccountTag = kind === "card" ? "CARD_CLEARING" : kind === "bkash" ? "MFS_BKASH" : "MFS_NAGAD"
    const gross = get(tag)
    if (gross <= 0) return
    const feesP = percentOf(gross, rules.merchantFeesPct[kind])
    const at = dhakaAt(day, hhmm)
    const id = w.ctx.seq("set")
    const row = w.ctx.bag.put("settlements", id, at, {
      settlementNo: "",
      kind,
      clearingAccountId: kind === "card" ? CBA.CARD : kind === "bkash" ? CBA.BKASH : CBA.NAGAD,
      bankAccountId: CBA.BRAC,
      grossP: gross,
      feesP,
      netP: gross - feesP,
      date: day,
      ref: `${kind.toUpperCase()}-${day.replace(/-/g, "")}`,
      journalId: "",
    }, USR.mahbub)
    w.number("SET", { date: day }, at, (no) => {
      row.settlementNo = no
    })
    row.journalId = w.ledger.post({
      rule: "R18",
      date: day,
      at,
      lines: linesForSettlement({ clearingTag: tag, bankTag: "BANK_MAIN", grossP: gross, feesP, locationId: LOC.HQ }),
      narration: () => `${kind === "card" ? "Card" : kind === "bkash" ? "bKash" : "Nagad"} settlement ${row.settlementNo}`,
      source: { app: "cab", docType: "settlements", docId: id, docNo: () => row.settlementNo },
      preparedBy: USR.mahbub,
    }).id
    add(tag, -gross)
    add("BANK_MAIN", gross - feesP)
  }

  const BRAC = { id: CBA.BRAC, tag: "BANK_MAIN" as AccountTag }
  const DBBL = { id: CBA.DBBL, tag: "BANK_COLLECTION" as AccountTag }
  let index = 0
  for (let day = F; day <= today; day = isoAddDays(day, 1), index++) {
    const isToday = day === today
    const daily = day >= w.cal.dailyFrom
    const batch = isBatchEnd(w, day)
    // Morning: yesterday's card batch and, every third day, the wallets (by week before the daily window).
    if (daily || batch) settle("card", day, "10:00")
    if (daily ? index % 3 === 2 : batch) {
      settle("bkash", day, "10:10")
      settle("nagad", day, "10:15")
    }
    // Late morning: keep BRAC above ৳10,00,000 over the coming week (weekly on Sundays; sooner if needed).
    if (!isToday || dhakaAt(day, "11:00") <= now) {
      let run = get("BANK_MAIN")
      let low = Infinity
      for (let k = 0; k < 7; k++) {
        const d = isoAddDays(day, k)
        if (d > today) break
        run += flow("BANK_MAIN", d)
        low = Math.min(low, run)
      }
      const sunday = new Date(`${day}T00:00:00Z`).getUTCDay() === 0
      const todayLow = get("BANK_MAIN") + flow("BANK_MAIN", day)
      const need = sunday ? BRAC_FLOOR - low : todayLow < T(2_00_000) ? BRAC_FLOOR - Math.min(low, todayLow) : 0
      const room = get("BANK_COLLECTION") + Math.min(0, flow("BANK_COLLECTION", day)) - DBBL_BUFFER
      const amount = Math.min(Math.ceil(Math.max(0, need) / T(10_000)) * T(10_000), Math.floor(Math.max(0, room) / T(10_000)) * T(10_000))
      if (amount > 0) transfer("transfer", DBBL, BRAC, amount, day, "11:00", USR.mahbub)
    }
    // The day's documents.
    for (const tag of CASH_TAGS) add(tag, flow(tag, day))
    if (isToday) break
    // Month end: petty cash back to its imprest.
    if (day === lastOfMonth(day)) {
      for (const p of [
        { id: CBA.PETTY_HQ, tag: "PETTY_HQ" as AccountTag, loc: LOC.HQ, imprest: T(15_000) },
        { id: CBA.PETTY_GUL, tag: "PETTY_GUL" as AccountTag, loc: LOC.GUL, imprest: T(10_000) },
        { id: CBA.PETTY_UTT, tag: "PETTY_UTT" as AccountTag, loc: LOC.UTT, imprest: T(10_000) },
      ]) {
        const amount = p.imprest - get(p.tag)
        if (amount > 0) transfer("top-up", BRAC, { id: p.id, tag: p.tag, loc: p.loc }, amount, day, "17:00", USR.mahbub)
      }
    }
    // Evening: till cash above the float to Dutch-Bangla (by week before the daily window).
    if (batch) for (const t of [
      { id: CBA.TILL_GUL, tag: "CASH_TILL_GUL" as AccountTag, loc: LOC.GUL, float: T(20_000), by: USR.tania },
      { id: CBA.TILL_UTT, tag: "CASH_TILL_UTT" as AccountTag, loc: LOC.UTT, float: T(15_000), by: USR.sabbir },
    ]) {
      const amount = get(t.tag) - t.float
      if (amount > 0) transfer("deposit", { id: t.id, tag: t.tag, loc: t.loc }, DBBL, amount, day, "21:15", t.by)
    }
    for (const tag of CASH_TAGS) {
      if (get(tag) < 0) throw new Error(`seed: ${tag} below zero on ${day} (${get(tag)})`)
    }
  }
}
