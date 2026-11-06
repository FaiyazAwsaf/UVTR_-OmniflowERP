import type { AccountRow, AccountTag, ISODate, Id, JournalLineRow, JournalRow, Ms, VoucherType } from "@/core/db/schema"
import { counterKey, formatDocNo } from "@/core/docs/numbering"
import { accountIdOf, CHART, defaultPostingMap, INVENTORY_TAGS, PARTY_TAGS } from "@/core/ledger/chart"
import { compact, RULE_VOUCHER, totals, type LineInput, type RuleCode } from "@/core/ledger/rules"

import { periodIdOf } from "../generators/org"
import type { World } from "./world"

/**
 * The seed's ledger: posts journals exactly as `core/ledger/post.ts`
 * `postJournal` would (rule lines through `compact`, tags resolved by the
 * posting map, `<TYPE>-<FY>-<6>` numbers from the counter, the period from
 * the month, the cost centre defaulted from the line's location, `rule`
 * recorded, lines denormalised with date, period and voucher type), but into
 * the in-memory bag. Lines are always built by a `linesFor<Doc>` rule.
 */

export type SourceRef = {
  app: string
  docType: string
  docId: Id
  /** Read after document numbers are assigned */
  docNo: () => string
}

export type PostInput = {
  rule: RuleCode
  date: ISODate
  /** Moment of posting (orders numbers within the day) */
  at: Ms
  lines: LineInput[]
  narration: string | (() => string)
  source?: SourceRef
  voucherType?: VoucherType
  preparedBy?: Id
  postedBy?: Id
  approvalId?: Id
  recurringId?: Id
}

/** A posted line with its tag, kept in memory for the later passes (tax, treasury, tests). */
export type MemLine = {
  journal: JournalRow
  row: JournalLineRow
  tag: AccountTag | undefined
}

const TAG_OF_ACCOUNT = new Map<string, AccountTag>(CHART.flatMap((c) => (c.tag ? [[accountIdOf(c.code), c.tag] as [string, AccountTag]] : [])))
const CONTROL = new Set<string>(CHART.filter((c) => c.control).map((c) => accountIdOf(c.code)))
const POSTABLE = new Set<string>(CHART.filter((c) => !c.group).map((c) => accountIdOf(c.code)))

export class SeedLedger {
  readonly journals: JournalRow[] = []
  readonly lines: MemLine[] = []
  private readonly map = defaultPostingMap()
  private readonly costCentreOf = new Map<Id, Id>([
    ["loc_hq", "cc_hq"],
    ["loc_gul", "cc_gul"],
    ["loc_utt", "cc_utt"],
    ["loc_cst", "cc_cst"],
  ])

  constructor(private readonly world: World) {}

  accountId(account: AccountTag | Id): Id {
    return (this.map as Record<string, string>)[account] ?? account
  }

  tagOf(accountId: Id): AccountTag | undefined {
    return TAG_OF_ACCOUNT.get(accountId)
  }

  post(input: PostInput): JournalRow {
    const { ctx } = this.world
    const lines = compact(input.lines)
    const sum = totals(lines)
    for (const l of lines) {
      if ((l.debitP ?? 0) < 0 || (l.creditP ?? 0) < 0) throw new Error(`seed: negative line in ${input.rule} on ${input.date}: ${JSON.stringify(l)}`)
      if ((l.debitP ?? 0) > 0 && (l.creditP ?? 0) > 0) throw new Error(`seed: line both sides in ${input.rule}`)
      if (!Number.isInteger(l.debitP ?? 0) || !Number.isInteger(l.creditP ?? 0)) throw new Error(`seed: fractional poisha in ${input.rule}: ${JSON.stringify(l)}`)
    }
    if (sum.debitP <= 0) throw new Error(`seed: empty journal ${input.rule} on ${input.date}`)
    if (sum.debitP !== sum.creditP) throw new Error(`seed: unbalanced ${input.rule} on ${input.date}: ${sum.debitP} vs ${sum.creditP}`)

    const voucherType = input.voucherType ?? RULE_VOUCHER[input.rule]
    const periodId = periodIdOf(input.date.slice(0, 7))
    if (!ctx.bag.find("periods", periodId)) throw new Error(`seed: no period for ${input.date}`)
    const preparedBy = input.preparedBy ?? "system"
    const id = ctx.seq("jnl")
    const journal = ctx.bag.put(
      "journals",
      id,
      input.at,
      {
        journalNo: "",
        voucherType,
        date: input.date,
        periodId,
        source: input.source
          ? { app: input.source.app, docType: input.source.docType, docId: input.source.docId, docNo: "" }
          : undefined,
        narration: typeof input.narration === "string" ? input.narration : "",
        status: "posted",
        totalP: sum.debitP,
        rule: input.rule,
        approvalId: input.approvalId,
        preparedBy,
        postedBy: input.postedBy ?? preparedBy,
        postedAt: input.at,
        recurringId: input.recurringId,
      },
      preparedBy
    )
    this.world.number(voucherType, { date: input.date }, input.at, (no) => {
      journal.journalNo = no
    })
    if (input.source) {
      const source = input.source
      this.world.fix(() => {
        journal.source!.docNo = source.docNo()
      })
    }
    if (typeof input.narration === "function") {
      const narration = input.narration
      this.world.fix(() => {
        journal.narration = narration()
      })
    }

    let lineNo = 0
    for (const l of lines) {
      const accountId = this.accountId(l.account)
      if (!POSTABLE.has(accountId)) throw new Error(`seed: not a postable account ${String(l.account)}`)
      const tag = TAG_OF_ACCOUNT.get(accountId)
      if (tag && PARTY_TAGS.includes(tag) && !l.partyId) throw new Error(`seed: ${tag} line without a party in ${input.rule}`)
      if (tag && INVENTORY_TAGS.includes(tag)) {
        const exempt = voucherType === "OB" || voucherType === "SM" || voucherType === "YC"
        if (!l.locationId || (!exempt && !l.itemId)) throw new Error(`seed: ${tag} line without item or location in ${input.rule}`)
      }
      if (CONTROL.has(accountId) && input.rule === "R24") throw new Error(`seed: control account ${tag} on a manual voucher`)
      lineNo += 1
      const row = ctx.bag.put(
        "journalLines",
        ctx.seq("jl"),
        input.at,
        {
          journalId: id,
          lineNo,
          accountId,
          debitP: l.debitP ?? 0,
          creditP: l.creditP ?? 0,
          partyId: l.partyId,
          costCentreId: l.costCentreId ?? (l.locationId ? this.costCentreOf.get(l.locationId) : undefined),
          locationId: l.locationId,
          itemId: l.itemId,
          description: l.description,
          date: input.date,
          periodId,
          voucherType,
        },
        preparedBy
      )
      this.lines.push({ journal, row, tag })
    }
    this.journals.push(journal)
    return journal
  }

  /** Signed balance (debit positive) of a tag, optionally filtered, up to a day (inclusive). */
  balance(tag: AccountTag, opts: { upTo?: ISODate; before?: ISODate; locationId?: Id; partyId?: Id } = {}): number {
    let sum = 0
    for (const l of this.lines) {
      if (l.tag !== tag) continue
      if (opts.upTo && l.row.date > opts.upTo) continue
      if (opts.before && l.row.date >= opts.before) continue
      if (opts.locationId && l.row.locationId !== opts.locationId) continue
      if (opts.partyId && l.row.partyId !== opts.partyId) continue
      sum += l.row.debitP - l.row.creditP
    }
    return sum
  }
}

/** The documents' numbering: counter key and format of core/docs/numbering.ts. */
export function docNo(type: Parameters<typeof counterKey>[0], serial: number, opts: { location?: string | null; date?: ISODate }): string {
  return formatDocNo(type, serial, opts)
}

export type { AccountRow }
