import { fiscalYearBounds } from "@/config/brand.config"
import { approveKeyFor, canDecide } from "@/core/approvals/approvals"
import type { ApprovalRow, ISODate, Id, Ms } from "@/core/db/schema"
import { counterKey, formatDocNo, type DocType } from "@/core/docs/numbering"
import type { SecurityContext } from "@/core/engine/types"
import { buildSecurity } from "@/core/security/resolve"
import type { ApprovalKind } from "@/core/security/types"
import type { Rng } from "@/lib/mock/rng"

import type { SeedCtx } from "../context"
import { historyStart } from "../generators/org"
import { addMonthsISO, dhakaAt, firstOfMonth, isoAddDays } from "../time"
import { SeedLedger } from "./ledger"
import { SeedStock } from "./stock"

/**
 * Shared state of one full seed run: the calendar anchors, the ledger and
 * stock books, numbering, post-numbering fix-ups and approval routing.
 */

export type Calendar = {
  today: ISODate
  yesterday: ISODate
  now: Ms
  /** F: the history's first day (seed_data.md §1) */
  F: ISODate
  /** C: the itemised start and stock cutover (today − 30, or − 7 for the small profile) */
  C: ISODate
  itemisedDays: number
  /** First day of last month; every month before it is closed */
  lastMonthStart: ISODate
  currentMonthStart: ISODate
  /** First day of the current fiscal year */
  fyStart: ISODate
  /**
   * Summary days and the treasury are daily from this day on (the last 150
   * days); older days are batched by week, never across a month end, so the
   * full profile stays under 5 s in Chromium on long histories.
   */
  dailyFrom: ISODate
  /** 0.25 for the small profile, 1 for full */
  volume: number
  small: boolean
}

export function makeCalendar(ctx: SeedCtx): Calendar {
  const small = ctx.scale === "small"
  const itemisedDays = small ? 7 : 30
  return {
    today: ctx.today,
    yesterday: isoAddDays(ctx.today, -1),
    now: ctx.now,
    F: historyStart(ctx.today),
    C: isoAddDays(ctx.today, -itemisedDays),
    itemisedDays,
    lastMonthStart: addMonthsISO(ctx.today, -1),
    currentMonthStart: firstOfMonth(ctx.today),
    fyStart: fiscalYearBounds(ctx.today).startsOn,
    dailyFrom: isoAddDays(ctx.today, -150),
    volume: small ? 0.25 : 1,
    small,
  }
}

export class World {
  readonly cal: Calendar
  readonly ledger: SeedLedger
  readonly stock: SeedStock
  private readonly fixups: (() => void)[] = []
  private readonly rngs = new Map<string, Rng>()
  private securityCache: Map<Id, { security: SecurityContext; locationIds: Id[]; active: boolean }> | null = null

  constructor(readonly ctx: SeedCtx) {
    this.cal = makeCalendar(ctx)
    this.ledger = new SeedLedger(this)
    this.stock = new SeedStock(this)
    ctx.numbers.afterAssigned(() => {
      for (const fn of this.fixups) fn()
    })
  }

  /** One deterministic stream per generator. */
  rng(stream: string): Rng {
    let r = this.rngs.get(stream)
    if (!r) {
      r = this.ctx.rng(stream)
      this.rngs.set(stream, r)
    }
    return r
  }

  /** Runs after every document number is assigned (copies of numbers into links). */
  fix(fn: () => void): void {
    this.fixups.push(fn)
  }

  /** Request a document number (assigned in time order per counter key). */
  number(type: DocType, opts: { location?: string | null; date?: ISODate }, at: Ms, apply: (no: string) => void): void {
    this.ctx.numbers.request(counterKey(type, opts), at, (n) => apply(formatDocNo(type, n, opts)))
  }

  /** Dhaka wall time on a calendar day. */
  at(date: ISODate, hhmm: string): Ms {
    return dhakaAt(date, hhmm)
  }

  isClosed(date: ISODate): boolean {
    return date < this.cal.lastMonthStart
  }

  /* ---------------- Approval routing ---------------- */

  private security(): Map<Id, { security: SecurityContext; locationIds: Id[]; active: boolean }> {
    if (this.securityCache) return this.securityCache
    const bag = this.ctx.bag
    const roles = bag.all("roles")
    const permissions = bag.all("rolePermissions")
    const limits = bag.all("approvalLimits")
    const userRoles = bag.all("userRoles")
    const out = new Map<Id, { security: SecurityContext; locationIds: Id[]; active: boolean }>()
    for (const user of bag.all("users")) {
      const roleIds = new Set(userRoles.filter((ur) => ur.userId === user.id).map((ur) => ur.roleId))
      const security = buildSecurity(
        roles.filter((r) => roleIds.has(r.id)),
        permissions.filter((p) => roleIds.has(p.roleId)),
        limits.filter((l) => roleIds.has(l.roleId))
      )
      out.set(user.id, { security, locationIds: user.locationIds, active: user.status === "active" })
    }
    this.securityCache = out
    return out
  }

  /** Users who could decide an approval (active, approve key with scope, covering limit), never the requester. */
  routedTo(approval: Pick<ApprovalRow, "approveKey" | "locationId" | "kind" | "amountP" | "pct" | "requestedBy">): Id[] {
    const out: Id[] = []
    for (const [userId, s] of this.security()) {
      if (!s.active || userId === approval.requestedBy) continue
      if (canDecide(s.security, s.locationIds, approval)) out.push(userId)
    }
    return out.sort()
  }

  /** A user's own limit for a kind (poisha, percent; Infinity = unlimited). */
  limitOf(userId: Id, kind: ApprovalKind): number {
    return this.security().get(userId)?.security.limits[kind] ?? 0
  }

  /**
   * An approval row. `docNo` is read after numbering. Decided rows record the
   * decider; pending rows stay pending (only the planted ones of §8, dated today).
   */
  approval(input: {
    kind: ApprovalKind
    docType: string
    docId: Id
    docNo: () => string
    locationId?: Id
    amountP?: number
    pct?: number
    requestedBy: Id
    requestedAt: Ms
    status: ApprovalRow["status"]
    decidedBy?: Id
    decidedAt?: Ms
    reason?: string
    decisionReason?: string
    inline?: boolean
    id?: Id
  }): ApprovalRow {
    const approveKey = approveKeyFor(input.kind, input.docType)
    const base = {
      kind: input.kind,
      docType: input.docType,
      docId: input.docId,
      docNo: "",
      locationId: input.locationId,
      amountP: input.amountP,
      pct: input.pct,
      requestedBy: input.requestedBy,
      requestedAt: input.requestedAt,
      approveKey,
    }
    const routed = input.inline && input.decidedBy ? [input.decidedBy] : this.routedTo(base)
    if (input.decidedBy && input.decidedBy === input.requestedBy) throw new Error("seed: self-approval")
    if (input.decidedBy && !input.inline && !routed.includes(input.decidedBy)) {
      throw new Error(`seed: ${input.decidedBy} cannot decide ${input.kind} ${input.amountP ?? input.pct}`)
    }
    const at = input.decidedAt ?? input.requestedAt
    const row = this.ctx.bag.put(
      "approvals",
      input.id ?? this.ctx.seq("apv"),
      input.requestedAt,
      {
        ...base,
        status: input.status,
        decidedBy: input.decidedBy,
        decidedAt: input.decidedAt,
        reason: input.reason ?? "",
        decisionReason: input.decisionReason,
        inline: !!input.inline,
        pinVerified: !!input.inline,
        routedTo: routed,
      },
      input.requestedBy
    )
    row.updatedAt = at
    if (input.decidedBy) row.updatedBy = input.decidedBy
    const docNo = input.docNo
    this.fix(() => {
      row.docNo = docNo()
    })
    // A pending request notifies everyone it is routed to (as requireApproval does).
    if (input.status === "pending") {
      const by = this.ctx.bag.get("users", input.requestedBy).nameEn
      for (const userId of routed) {
        const note = this.ctx.bag.put("notifications", this.ctx.seq("ntf"), input.requestedAt, {
          userId,
          kind: "approval-requested",
          titleKey: "approvals.notify.requested",
          params: { docNo: "", by },
          refs: { approvalId: row.id },
          href: "/approvals",
          read: false,
          at: input.requestedAt,
        }, input.requestedBy)
        this.fix(() => {
          note.params.docNo = row.docNo
        })
      }
    }
    return row
  }
}
