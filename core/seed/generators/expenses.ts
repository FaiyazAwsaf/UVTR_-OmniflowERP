import type { ExpenseTag, ISODate, Id, TemplateLine, VendorBillRow } from "@/core/db/schema"
import {
  linesForExpenseBill,
  linesForManualVoucher,
  linesForPettyCash,
  linesForRecurring,
  monthlyDepreciationP,
  type LineInput,
} from "@/core/ledger/rules"
import { percentOf, spreadAmount } from "@/core/tax/vat"

import { VENDOR_BY_ID } from "../content/parties"
import { CBA, LOC, PLANT, REC, USR, VND } from "../content/seed-refs"
import type { World } from "../engine/world"
import { periodIdOf } from "./org"
import { addMonthsISO, dhakaAt, firstOfMonth, isoAddDays, lastOfMonth, MINUTE } from "../time"

/**
 * Expenses, itemised throughout (seed_data.md §6, §7.1): rent on the 1st,
 * utilities on the 8th, security on the 1st (the most recent one is E6,
 * dated today − 13), internet, repairs, packaging, quarterly professional
 * fees and the August bill for the accrued audit fee, the prepaid renewal
 * each 1 July (R14); payroll accrued at each month end (R25) and paid by a
 * manual bank voucher on the 3rd (R24, Rashed approves); depreciation and
 * prepaid amortisation (R25); the loan instalment on the 10th (R24, Farzana
 * approves); petty cash vouchers within the makers' limits (R19). The small
 * profile scales running costs with its volumes so cash stays positive.
 */

const T = (taka: number) => taka * 100

export type PayHint = { bill: VendorBillRow; payOn: ISODate; method: "bank-transfer" | "cheque"; never?: boolean }

type BillLine = { tag: ExpenseTag; net: number; loc: Id; description: string }

export function seedExpenses(w: World): { hints: PayHint[] } {
  const rng = w.rng("expenses")
  const { F, today, now } = w.cal
  const scale = w.cal.small ? 0.4 : 1
  const S = (taka: number) => Math.round(taka * scale) * 100
  const hints: PayHint[] = []

  const bill = (input: {
    id?: Id
    vendorId: Id
    date: ISODate
    lines: BillLine[]
    vatPct: number
    mushak: boolean
    ref: string
    payOn?: ISODate
    method?: "bank-transfer" | "cheque"
    never?: boolean
  }) => {
    const vendor = VENDOR_BY_ID.get(input.vendorId)!
    const at = dhakaAt(input.date, "09:30")
    if (at > now) return
    const lines = input.lines.map((l) => ({ ...l, vat: percentOf(l.net, input.vatPct) }))
    const subtotal = lines.reduce((s, l) => s + l.net, 0)
    const vat = lines.reduce((s, l) => s + l.vat, 0)
    const id = input.id ?? w.ctx.seq("bl")
    const row = w.ctx.bag.put("vendorBills", id, at, {
      billNo: "",
      vendorRef: input.ref,
      partyId: input.vendorId,
      locationId: LOC.HQ,
      date: input.date,
      dueDate: isoAddDays(input.date, vendor.terms),
      kind: "expense",
      grnIds: [],
      hasMushak63: input.mushak,
      subtotalP: subtotal,
      inputVatP: vat,
      totalP: subtotal + vat,
      paidP: 0,
      debitedP: 0,
      status: "posted",
      matchStatus: "n-a",
      matchDiffs: [],
    }, USR.mahbub)
    w.number("BL", { date: input.date }, at, (no) => {
      row.billNo = no
    })
    lines.forEach((l, i) => {
      w.ctx.bag.put("vendorBillLines", w.ctx.seq("bll"), at, {
        billId: id,
        lineNo: i + 1,
        expenseTag: l.tag,
        description: l.description,
        qty: 1,
        unitPriceP: l.net,
        vatRatePct: input.vatPct,
        vatP: l.vat,
        netP: l.net,
        costCentreId: `cc_${l.loc.slice(4)}`,
      }, USR.mahbub)
    })
    const journal = w.ledger.post({
      rule: "R14",
      date: input.date,
      at,
      lines: linesForExpenseBill({
        partyId: input.vendorId,
        locationId: LOC.HQ,
        lines: lines.map((l) => ({ expenseTag: l.tag, netP: l.net, vatP: l.vat, locationId: l.loc })),
        hasMushak63: input.mushak,
      }),
      narration: () => `Vendor bill ${row.billNo}, ${vendor.nameEn}`,
      source: { app: "ap", docType: "vendorBills", docId: id, docNo: () => row.billNo },
      preparedBy: USR.mahbub,
    })
    row.journalId = journal.id
    hints.push({ bill: row, payOn: input.payOn ?? isoAddDays(input.date, vendor.terms - rng.int(0, 3)), method: input.method ?? "bank-transfer", never: input.never })
  }

  // The E6 bill replaces Prime Guard's monthly bill of the month it falls in, and nothing follows it.
  const e6Day = isoAddDays(today, -13)
  const months: ISODate[] = []
  for (let m = firstOfMonth(F); m <= today; m = addMonthsISO(m, 1)) months.push(m)
  let n = 0
  for (const m of months) {
    n += 1
    const ym = `${m.slice(2, 4)}${m.slice(5, 7)}`
    const on = (day: number) => isoAddDays(m, day - 1)
    // Rent on the 1st, paid by cheque by the 5th (AIT 5% and VDS withheld).
    bill({ vendorId: VND.gulshanProps, date: m, vatPct: 15, mushak: true, ref: `GPL/R/${ym}`, payOn: on(rng.int(2, 5)), method: "cheque",
      lines: [{ tag: "RENT", net: S(1_80_000), loc: LOC.GUL, description: "Gulshan Studio rent" }, { tag: "RENT", net: S(60_000), loc: LOC.HQ, description: "Head Office rent" }] })
    bill({ vendorId: VND.uttaraEstate, date: m, vatPct: 15, mushak: true, ref: `UEH/${ym}`, payOn: on(rng.int(2, 5)), method: "cheque",
      lines: [{ tag: "RENT", net: S(1_10_000), loc: LOC.UTT, description: "Uttara Studio rent" }] })
    bill({ vendorId: VND.tejgaonWh, date: m, vatPct: 15, mushak: true, ref: `TWL-${ym}`, payOn: on(rng.int(2, 5)), method: "cheque",
      lines: [{ tag: "RENT", net: S(60_000), loc: LOC.CST, description: "Central Store rent" }] })
    // Security on the 1st, paid by the 10th; the most recent one is the E6 bill (unpaid, due in 2 days).
    const e6Month = e6Day.slice(0, 7) === m.slice(0, 7)
    if (!e6Month && m < e6Day) {
      bill({ vendorId: VND.primeGuard, date: m, vatPct: 15, mushak: true, ref: `PGS/${ym}/${100 + n}`, payOn: on(rng.int(7, 10)), lines: securityLines() })
    }
    if (e6Month) {
      bill({ id: PLANT.e6Bill, vendorId: VND.primeGuard, date: e6Day, vatPct: 15, mushak: true, ref: `PGS/${ym}/${100 + n}`, never: true, lines: securityLines() })
    }
    // Internet on the 1st (exempt), utilities on the 8th (exempt), paid by the 15th.
    bill({ vendorId: VND.swiftlink, date: m, vatPct: 0, mushak: false, ref: `SL-${ym}-AM`, payOn: on(rng.int(5, 12)),
      lines: spreadLines([["TELECOM", LOC.HQ, 30], ["TELECOM", LOC.GUL, 30], ["TELECOM", LOC.UTT, 25], ["TELECOM", LOC.CST, 15]], S(9_500), "Internet") })
    const power = Math.round(rng.around(1_45_000, 8_000, 1_30_000, 1_60_000) * scale) * 100
    bill({ vendorId: VND.cityUtilities, date: on(8), vatPct: 0, mushak: false, ref: `CU/${ym}/${rng.int(10000, 99999)}`, payOn: on(rng.int(12, 15)),
      lines: spreadLines([["UTILITIES", LOC.GUL, 48], ["UTILITIES", LOC.UTT, 28], ["UTILITIES", LOC.CST, 14], ["UTILITIES", LOC.HQ, 10]], power, "Electricity and water") })
    // Packaging and printed bags (Shapla), monthly.
    bill({ vendorId: VND.shaplaPack, date: on(rng.int(10, 20)), vatPct: 15, mushak: true, ref: `SPH-${ym}-${rng.int(100, 999)}`,
      lines: spreadLines([["OFFICE", LOC.GUL, 55], ["OFFICE", LOC.UTT, 35], ["OFFICE", LOC.HQ, 10]], Math.round(rng.int(9_000, 15_000) * scale) * 100, "Printed bags and packaging") })
    // Repairs once or twice a month (ProTech).
    for (let k = rng.bool(0.5) ? 2 : 1; k > 0; k--) {
      const loc = rng.pick([LOC.GUL, LOC.GUL, LOC.UTT, LOC.CST])
      bill({ vendorId: VND.protech, date: on(rng.int(3, 26)), vatPct: 15, mushak: true, ref: `PTS/${ym}/${rng.int(100, 999)}`,
        lines: [{ tag: "REPAIRS", net: Math.round(rng.int(8_000, 25_000) * scale) * 100, loc, description: rng.pick(["Pressure washer pump service", "Polisher motor repair", "Foam cannon and hose replacement", "Vacuum extractor repair"]) }] })
    }
    // Professional fees quarterly (Rahman & Associates); the prior-year audit fee in the first August.
    if (["09", "12", "03", "06"].includes(m.slice(5, 7))) {
      bill({ vendorId: VND.rahmanAssoc, date: on(20), vatPct: 15, mushak: true, ref: `R&A/${ym}/Q`, lines: [{ tag: "PROFESSIONAL", net: S(45_000), loc: LOC.HQ, description: "Tax and accounting advice, quarter" }] })
    }
    if (m.slice(5, 7) === "08" && m.slice(0, 4) === F.slice(0, 4)) {
      bill({ vendorId: VND.rahmanAssoc, date: on(12), vatPct: 15, mushak: true, ref: `R&A/${ym}/AUDIT`, lines: [{ tag: "ACCRUED_EXP", net: T(55_000), loc: LOC.HQ, description: "Statutory audit, prior year (accrued)" }] })
    }
    // Prepaid insurance and software renewed each 1 July after the first year.
    if (m.slice(5, 7) === "07" && m > F) {
      bill({ vendorId: VND.swiftlink, date: m, vatPct: 0, mushak: false, ref: `SL-${ym}-ANNUAL`, lines: [{ tag: "PREPAID", net: T(1_20_000), loc: LOC.HQ, description: "Annual software licences and insurance cover, renewed" }] })
    }
  }

  recurring(w, scale)
  payrollAndLoan(w, scale)
  pettyCash(w)
  return { hints }

  function securityLines(): BillLine[] {
    return spreadLines([["SECURITY", LOC.HQ, 25], ["SECURITY", LOC.GUL, 33], ["SECURITY", LOC.UTT, 25], ["SECURITY", LOC.CST, 17]], T(60_000), "Guards")
  }
}

function spreadLines(parts: [ExpenseTag, Id, number][], total: number, description: string): BillLine[] {
  const amounts = spreadAmount(parts.map((p) => p[2]), total)
  return parts.map(([tag, loc], i) => ({ tag, net: amounts[i], loc, description }))
}

/* ---------------- Recurring (R25): depreciation, salary accrual, prepaid amortisation ---------------- */

const ASSETS: { cost: number; pct: number; acc: "ACC_DEP_EQUIPMENT" | "ACC_DEP_FURNITURE" | "ACC_DEP_VEHICLE" | "ACC_DEP_FITOUT"; split: [Id, number][] }[] = [
  { cost: T(32_00_000), pct: 20, acc: "ACC_DEP_EQUIPMENT", split: [[LOC.GUL, 55], [LOC.UTT, 35], [LOC.CST, 10]] },
  { cost: T(6_50_000), pct: 10, acc: "ACC_DEP_FURNITURE", split: [[LOC.HQ, 30], [LOC.GUL, 35], [LOC.UTT, 25], [LOC.CST, 10]] },
  { cost: T(18_00_000), pct: 20, acc: "ACC_DEP_VEHICLE", split: [[LOC.CST, 100]] },
  { cost: T(24_00_000), pct: 15, acc: "ACC_DEP_FITOUT", split: [[LOC.GUL, 55], [LOC.UTT, 45]] },
]

function depreciationLines(): TemplateLine[] {
  const lines: TemplateLine[] = []
  for (const a of ASSETS) {
    const month = monthlyDepreciationP(a.cost, a.pct)
    const parts = spreadAmount(a.split.map((s) => s[1]), month)
    a.split.forEach(([loc], i) => lines.push({ account: "DEPRECIATION", debitP: parts[i], creditP: 0, locationId: loc }))
    lines.push({ account: a.acc, debitP: 0, creditP: month })
  }
  return lines
}

function salaryLines(scale: number): TemplateLine[] {
  const s = (taka: number) => Math.round(taka * scale) * 100
  const salaries: [Id, number][] = [[LOC.HQ, 2_40_000], [LOC.GUL, 3_90_000], [LOC.UTT, 2_30_000], [LOC.CST, 1_00_000]]
  const incentives: [Id, number][] = [[LOC.GUL, 70_000], [LOC.UTT, 50_000]]
  const lines: TemplateLine[] = []
  for (const [loc, v] of salaries) lines.push({ account: "SALARIES", debitP: s(v), creditP: 0, locationId: loc })
  for (const [loc, v] of incentives) lines.push({ account: "INCENTIVES", debitP: s(v), creditP: 0, locationId: loc })
  lines.push({ account: "SALARY_PAYABLE", debitP: 0, creditP: lines.reduce((sum, l) => sum + l.debitP, 0) })
  return lines
}

const toLines = (t: TemplateLine[]): LineInput[] => t.map((l) => ({ account: l.account, debitP: l.debitP, creditP: l.creditP, locationId: l.locationId, partyId: l.partyId, costCentreId: l.costCentreId }))

function recurring(w: World, scale: number) {
  const { bag } = w.ctx
  const { F, currentMonthStart } = w.cal
  const at0 = dhakaAt(F, "09:00")
  const lastMonth = addMonthsISO(currentMonthStart, -1)
  const lastPostedPeriodId = lastMonth >= firstOfMonth(F) ? periodIdOf(lastMonth.slice(0, 7)) : undefined
  const dep = depreciationLines()
  const sal = salaryLines(scale)
  const pre: TemplateLine[] = [
    { account: "OFFICE", debitP: T(10_000), creditP: 0, locationId: LOC.HQ },
    { account: "PREPAID", debitP: 0, creditP: T(10_000) },
  ]
  bag.put("recurringJournals", REC.depreciation, at0, { code: "REC-DEP", nameEn: "Monthly depreciation", nameBn: "মাসিক অবচয়", frequency: "monthly", kind: "depreciation", lines: dep, lastPostedPeriodId, active: true }, USR.farzana)
  bag.put("recurringJournals", REC.salary, at0, { code: "REC-SAL", nameEn: "Salary and incentive accrual", nameBn: "বেতন ও প্রণোদনা বকেয়া", frequency: "monthly", kind: "salary-accrual", lines: sal, lastPostedPeriodId, active: true }, USR.farzana)
  bag.put("recurringJournals", REC.prepaid, at0, { code: "REC-PRE", nameEn: "Prepaid insurance and software amortisation", nameBn: "অগ্রিম বিমা ও সফটওয়্যার খরচ বণ্টন", frequency: "monthly", kind: "prepaid-amortisation", lines: pre, lastPostedPeriodId, active: true }, USR.farzana)

  let prepaid = T(1_20_000)
  for (let m = firstOfMonth(F); m < currentMonthStart; m = addMonthsISO(m, 1)) {
    const end = lastOfMonth(m)
    const at = dhakaAt(end, "18:00")
    if (m.slice(5, 7) === "07" && m > F) prepaid += T(1_20_000)
    const post = (recId: Id, code: string, lines: LineInput[], narration: string) =>
      w.ledger.post({
        rule: "R25",
        date: end,
        at,
        lines: linesForRecurring(lines),
        narration,
        source: { app: "fa", docType: "recurringJournals", docId: recId, docNo: () => code },
        recurringId: recId,
        preparedBy: USR.mahbub,
      })
    post(REC.depreciation, "REC-DEP", toLines(dep), `Monthly depreciation, ${m.slice(0, 7)}`)
    post(REC.salary, "REC-SAL", toLines(sal), `Salary and incentive accrual, ${m.slice(0, 7)}`)
    const amort = Math.min(T(10_000), prepaid)
    if (amort > 0) {
      prepaid -= amort
      post(REC.prepaid, "REC-PRE", toLines([{ ...pre[0], debitP: amort }, { ...pre[1], creditP: amort }]), `Prepaid amortisation, ${m.slice(0, 7)}`)
    }
  }
}

/* ---------------- Payroll payment and loan instalment (R24, manual bank vouchers) ---------------- */

function payrollAndLoan(w: World, scale: number) {
  const { F, now } = w.cal
  const accrued = salaryLines(scale).reduce((s, l) => s + l.debitP, 0)
  const manual = (date: ISODate, hhmm: string, lines: LineInput[], narration: string) => {
    const at = dhakaAt(date, hhmm)
    if (at > now) return
    const total = lines.reduce((s, l) => s + (l.debitP ?? 0), 0)
    const approver = total <= w.limitOf(USR.farzana, "journal") ? USR.farzana : USR.rashed
    const journal = w.ledger.post({
      rule: "R24",
      voucherType: "PV",
      date,
      at,
      lines: linesForManualVoucher(lines),
      narration,
      preparedBy: USR.mahbub,
      postedBy: approver,
    })
    journal.approvalId = w.approval({
      kind: "journal",
      docType: "journals",
      docId: journal.id,
      docNo: () => journal.journalNo,
      locationId: LOC.HQ,
      amountP: total,
      requestedBy: USR.mahbub,
      requestedAt: at - 60 * MINUTE,
      status: "approved",
      decidedBy: approver,
      decidedAt: at,
    }).id
  }
  // June payroll (opening) on F + 2, then each month's on the 3rd of the next.
  manual(isoAddDays(F, 2), "11:00", [{ account: "SALARY_PAYABLE", debitP: T(10_80_000) }, { account: "BANK_MAIN", creditP: T(10_80_000) }], "Salaries and incentives paid, June (opening)")
  for (let m = firstOfMonth(F); m < w.cal.currentMonthStart; m = addMonthsISO(m, 1)) {
    const payDay = isoAddDays(addMonthsISO(m, 1), 2)
    manual(payDay, "11:00", [{ account: "SALARY_PAYABLE", debitP: accrued }, { account: "BANK_MAIN", creditP: accrued }], `Salaries and incentives paid, ${m.slice(0, 7)}`)
  }
  // Loan instalment on the 10th: ৳50,000 principal plus interest at 11% a year on the balance.
  let balance = T(20_00_000)
  for (let m = firstOfMonth(F); m <= w.cal.today; m = addMonthsISO(m, 1)) {
    const day = isoAddDays(m, 9)
    if (dhakaAt(day, "12:00") > now || day < F) continue
    const interest = Math.round((balance * 11) / 100 / 12)
    manual(day, "12:00", [
      { account: "TERM_LOAN", debitP: T(50_000) },
      { account: "INTEREST_EXPENSE", debitP: interest, locationId: LOC.HQ },
      { account: "BANK_MAIN", creditP: T(50_000) + interest },
    ], `Term loan instalment, BRAC Bank, ${m.slice(0, 7)}`)
    balance -= T(50_000)
  }
}

/* ---------------- Petty cash (R19) ---------------- */

const PETTY: { loc: Id; account: Id; tag: "PETTY_HQ" | "PETTY_GUL" | "PETTY_UTT"; makers: [Id, number][]; perMonth: number; budget: number }[] = [
  { loc: LOC.HQ, account: CBA.PETTY_HQ, tag: "PETTY_HQ", makers: [[USR.mahbub, T(5_000)]], perMonth: 6, budget: T(10_000) },
  // At most ৳6,000 a month, so the box always holds the planted ৳3,500 voucher Shahriar approves (seed_data §8), even on the last day before the top-up.
  { loc: LOC.GUL, account: CBA.PETTY_GUL, tag: "PETTY_GUL", makers: [[USR.tania, T(1_000)], [USR.shahriar, T(5_000)]], perMonth: 8, budget: T(6_000) },
  { loc: LOC.UTT, account: CBA.PETTY_UTT, tag: "PETTY_UTT", makers: [[USR.sabbir, T(1_000)], [USR.arif, T(5_000)]], perMonth: 7, budget: T(6_500) },
]

const PETTY_KINDS: [ExpenseTag, string, string][] = [
  ["CONVEYANCE", "CNG fare to the bank", "Rickshaw and CNG"],
  ["CONVEYANCE", "Courier of documents to the head office", "Courier"],
  ["WELFARE", "Tea and snacks for staff", "Tea stall"],
  ["WELFARE", "Lunch for staff on a late shift", "Restaurant"],
  ["REPAIRS", "Hose clamp and fittings", "Hardware shop"],
  ["OFFICE", "Printer paper and pens", "Stationery shop"],
  ["REPAIRS", "Bulb replacement in the bay", "Electrical shop"],
]

function pettyCash(w: World) {
  const rng = w.rng("petty")
  const { F, today } = w.cal
  for (const p of PETTY) {
    for (let m = firstOfMonth(F); m <= today; m = addMonthsISO(m, 1)) {
      let spent = 0
      const days: ISODate[] = []
      for (let k = 0; k < p.perMonth; k++) {
        const d = isoAddDays(m, rng.int(0, 27))
        if (d >= F && d < today) days.push(d)
      }
      days.sort()
      for (const d of days) {
        const [maker, limit] = rng.pick(p.makers)
        const amount = Math.min(limit, rng.int(2, Math.min(25, limit / 100_00)) * 100_00)
        if (spent + amount > p.budget) break
        spent += amount
        const [tag, description, payee] = rng.pick(PETTY_KINDS)
        const at = dhakaAt(d, `${rng.int(10, 18)}:${rng.pick(["05", "20", "35", "50"])}`)
        const id = w.ctx.seq("pcv")
        const v = w.ctx.bag.put("pettyCashVouchers", id, at, {
          voucherNo: "",
          cashBankAccountId: p.account,
          locationId: p.loc,
          date: d,
          expenseTag: tag,
          amountP: amount,
          payee,
          description,
          status: "posted",
          preparedBy: maker,
        }, maker)
        w.number("PCV", { location: p.loc, date: d }, at, (no) => {
          v.voucherNo = no
        })
        const journal = w.ledger.post({
          rule: "R19",
          date: d,
          at,
          lines: linesForPettyCash({ pettyTag: p.tag, expenseTag: tag, amountP: amount, locationId: p.loc }),
          narration: () => `Petty cash ${v.voucherNo}: ${description}`,
          source: { app: "cab", docType: "pettyCashVouchers", docId: id, docNo: () => v.voucherNo },
          preparedBy: maker,
        })
        v.journalId = journal.id
      }
    }
  }
}
