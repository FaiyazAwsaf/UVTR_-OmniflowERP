import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { rules } from "@/config/rules.config"
import { invoiceAvailable } from "@/core/ar/receipt"
import { now } from "@/core/clock/clock"
import { addDaysISO, atDhaka, dhakaDate } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import { LOC, PENDING_APPROVAL_IDS, PLANT, USR } from "@/core/seed/content/seed-refs"
import { boardStatus, loadCollections, loadFinance, loadRoleHome, loadStudioOps, primaryRole } from "@/modules/dashboard/queries"
import type { RoleHomeData, TodoItem } from "@/modules/dashboard/types"

import { signedIn } from "../helpers/foundation"
import { gl, seededDb } from "./helpers"

/**
 * WS-Dash role homes on the small seed: each of the 11 roles gets its KPIs
 * and to-dos from the right data (approvals this user may decide and never
 * their own, the studio's board, the counter queue, the technician's own
 * tasks, the store's goods and transfers, locked users, the audit trail),
 * scoped to the user's studio where the role is studio-bound.
 */

let db: OmniflowDb
let today: string

beforeAll(async () => {
  db = await seededDb("dash-homes")
  today = dhakaDate(now())
}, 180_000)
afterAll(async () => {
  await db.delete()
})

const home = (username: keyof typeof USR, locationId?: string) => loadRoleHome(db, { userId: USR[username], today, nowMs: now(), locationId })
const kpi = (h: RoleHomeData, k: string) => h.kpis.find((x) => x.key === k)?.value
const ids = (h: RoleHomeData, kind: TodoItem["kind"]) => h.todos.filter((t) => t.kind === kind).map((t) => t.id)

describe("role homes", () => {
  it("picks the role in plan order and gives every seeded role four KPIs", async () => {
    expect(primaryRole(["ADVISOR", "STUDIO_MGR"])).toBe("STUDIO_MGR")
    expect(primaryRole([])).toBe("NONE")
    const roles: [keyof typeof USR, string][] = [
      ["rashed", "OWNER"],
      ["farzana", "ACC_MGR"],
      ["mahbub", "ACCOUNTANT"],
      ["shahriar", "STUDIO_MGR"],
      ["nayeem", "ADVISOR"],
      ["tania", "CASHIER"],
      ["rakib", "TECHNICIAN"],
      ["habib", "STORE"],
      ["nusrat", "PROCUREMENT"],
      ["tahmid", "SYS_ADMIN"],
      ["shamima", "AUDITOR"],
    ]
    for (const [user, role] of roles) {
      const h = await home(user)
      expect(h.role, user).toBe(role)
      expect(h.kpis, user).toHaveLength(4)
      for (const k of h.kpis) expect(k.href.startsWith("/"), `${user} ${k.key}`).toBe(true)
      for (const item of h.todos) expect(item.href.startsWith("/"), `${user} ${item.kind}`).toBe(true)
    }
  })

  it("owner: today's revenue, collections and cash from the books, every pending approval, the dashboard", async () => {
    const h = await home("rashed")
    expect(kpi(h, "revenueToday")).toBe((await loadFinance(db, { today, period: "today" })).revenueTodayP)
    expect(kpi(h, "collectionsToday")).toBe((await loadCollections(db, { from: today, to: today })).totalP)
    let cash = 0
    for (const tag of ["CASH_TILL_GUL", "CASH_TILL_UTT", "PETTY_HQ", "PETTY_GUL", "PETTY_UTT", "BANK_MAIN", "BANK_COLLECTION", "MFS_BKASH", "MFS_NAGAD", "CARD_CLEARING"] as const) cash += await gl(db, tag, { upTo: today })
    expect(kpi(h, "cash")).toBe(cash)
    const pending = await db.approvals.where("status").equals("pending").toArray()
    expect(kpi(h, "approvals")).toBe(pending.filter((a) => a.requestedBy !== USR.rashed).length)
    for (const id of PENDING_APPROVAL_IDS) expect(ids(h, "approval")).toContain(id)
    expect(h.todos[0].kind).toBe("dashboard")
    expect(ids(h, "bill-hold")).toContain(PLANT.heldBill)
  })

  it("accounts manager: her approvals, bills on hold, cheques due and overdue accounts", async () => {
    const h = await home("farzana")
    expect(ids(h, "approval")).toContain(PLANT.pendingPoApproval)
    expect(ids(h, "approval")).toContain(PLANT.heldBillApproval)
    expect(ids(h, "bill-hold")).toContain(PLANT.heldBill)
    const pdcs = ids(h, "pdc")
    expect(pdcs).toContain(PLANT.e8Cheque)
    expect(pdcs).toContain(PLANT.greenwayCheque)
    const due = addDaysISO(today, rules.pdcWarnDays)
    expect(kpi(h, "pdcDue")).toBe((await db.cheques.where("status").equals("in-hand").toArray()).filter((c) => c.direction === "received" && c.chequeDate <= due).length)
    expect(kpi(h, "overdueReceivables")).toBeGreaterThan(0)
    expect(h.todos.filter((t) => t.kind === "overdue").length).toBeGreaterThan(0)
  })

  it("accountant: no approvals of his own kind to decide; drafts, pending vouchers and payments he prepared", async () => {
    const h = await home("mahbub")
    expect(ids(h, "approval")).toEqual([])
    const drafts = (await db.journals.where("status").equals("draft").toArray()).filter((j) => j.preparedBy === USR.mahbub)
    expect(kpi(h, "myDrafts")).toBe(drafts.length)
    expect(ids(h, "pdc")).toContain(PLANT.e8Cheque)
  })

  it("studio manager: Gulshan only; Tania's petty cash to approve, not Uttara's adjustment; the board's jobs", async () => {
    const h = await home("shahriar")
    expect(h.locationId).toBe(LOC.GUL)
    expect(ids(h, "approval")).toContain(PLANT.pendingPettyCashApproval)
    expect(ids(h, "approval")).not.toContain(PLANT.pendingAdjustmentApproval)
    const ops = await loadStudioOps(db, { locationId: LOC.GUL, today, nowMs: now() })
    expect(kpi(h, "jobsToday")).toBe(Object.values(ops.counts).reduce((s, v) => s + v, 0))
    expect(kpi(h, "lateJobs")).toBe(ops.late)
    expect(kpi(h, "revenueToday")).toBe((await loadFinance(db, { today, period: "today", locationId: LOC.GUL })).revenueTodayP)
    const qc = (await db.salesOrders.where("[locationId+status]").equals([LOC.GUL, "qc"]).toArray()).map((o) => `qc:${o.id}`)
    expect(ids(h, "qc").sort()).toEqual(qc.sort())
    const arif = await home("arif")
    expect(arif.locationId).toBe(LOC.UTT)
    expect(ids(arif, "approval")).toContain(PLANT.pendingAdjustmentApproval)
    expect(ids(arif, "approval")).not.toContain(PLANT.pendingPettyCashApproval)
  })

  it("advisor: late and ready jobs, bookings later today and open quotations at his studio", async () => {
    const h = await home("nayeem")
    expect(h.locationId).toBe(LOC.GUL)
    const kinds = new Set(h.todos.map((t) => t.kind))
    for (const k of kinds) expect(["late-job", "ready", "booking", "quote"]).toContain(k)
    const ready = (await db.salesOrders.where("[locationId+status]").equals([LOC.GUL, "ready"]).toArray()).map((o) => `ready:${o.id}`)
    expect(ids(h, "ready").sort()).toEqual(ready.sort())
    const orders = await db.salesOrders.where("locationId").equals(LOC.GUL).toArray()
    const nowMs = now()
    const end = atDhaka(today, "00:00") + 86_400_000
    expect(kpi(h, "bookingsLater")).toBe(orders.filter((o) => o.status === "booked" && o.scheduledAt >= nowMs && o.scheduledAt < end).length)
    expect(kpi(h, "jobsToday")).toBe(orders.filter((o) => boardStatus(o, today)).length)
  })

  it("cashier: the counter queue, today's takings and the till at her studio", async () => {
    const h = await home("tania")
    expect(h.locationId).toBe(LOC.GUL)
    const invoices = (await db.salesInvoices.where("locationId").equals(LOC.GUL).toArray()).filter((i) => i.kind === "counter" && invoiceAvailable(i) > 0)
    const delivered = await db.salesOrders.where("[locationId+status]").equals([LOC.GUL, "delivered"]).toArray()
    const parties = new Map((await db.parties.bulkGet(delivered.map((o) => o.partyId))).filter(Boolean).map((p) => [p!.id, p!]))
    const queue = delivered.filter((o) => {
      const p = parties.get(o.partyId)
      return !!p && !["fleet", "dealer", "corporate"].includes(p.segment) && p.paymentTermsDays === 0
    })
    expect(kpi(h, "counterQueue")).toBe(queue.length + invoices.length)
    expect(kpi(h, "tillBalance")).toBe(await gl(db, "CASH_TILL_GUL", { upTo: today }))
    expect(kpi(h, "takingsToday")).toBe((await loadCollections(db, { from: today, to: today, locationId: LOC.GUL })).totalP)
    expect(h.todos.every((t) => t.href === "/si/counter")).toBe(true)
  })

  it("technician: only his own tasks today", async () => {
    const h = await home("rakib")
    const end = atDhaka(today, "00:00") + 86_400_000
    const mine = (await db.jobTasks.where("technicianId").equals(USR.rakib).toArray()).filter((x) => (x.status === "queued" || x.status === "in-progress") && x.plannedStart < end)
    expect(kpi(h, "myTasks")).toBe(mine.length)
    expect(ids(h, "task").sort()).toEqual(mine.map((x) => x.id).sort())
    expect(h.todos.every((t) => t.kind === "task" && t.href === "/stl/my-jobs")).toBe(true)
  })

  it("store keeper: goods to receive on open POs, transfers in transit, quarantine, expiring lots and low stock", async () => {
    const h = await home("habib")
    expect(ids(h, "grn")).toContain(PLANT.bengalPartialPo)
    expect(ids(h, "transfer-in")).toContain(PLANT.inTransitTransfer)
    expect(kpi(h, "inTransit")).toBeGreaterThanOrEqual(1)
    expect(kpi(h, "lowStock")).toBeGreaterThan(0)
    expect(kpi(h, "expiringLots")).toBeGreaterThanOrEqual(2)
    expect(h.todos.find((t) => t.kind === "grn" && t.id === PLANT.bengalPartialPo)?.href).toBe(`/grn/receive/${PLANT.bengalPartialPo}`)
  })

  it("procurement: never her own PO approval (maker-checker), open and overdue POs", async () => {
    const h = await home("nusrat")
    expect(ids(h, "approval")).not.toContain(PLANT.pendingPoApproval)
    const open = await db.purchaseOrders.where("status").anyOf("issued", "partial").toArray()
    expect(kpi(h, "openPos")).toBe(open.length)
    expect(kpi(h, "overduePos")).toBe(open.filter((p) => p.expectedDate < today).length)
  })

  it("administrator: locked users and active sessions", async () => {
    const h = await home("tahmid")
    expect(ids(h, "locked-user")).toContain(USR.polash)
    expect(kpi(h, "lockedUsers")).toBe((await db.users.where("status").equals("locked").toArray()).length)
    expect(kpi(h, "activeSessions")).toBe((await db.sessions.toArray()).filter((s) => !s.endedAt).length)
    expect(h.todos.find((t) => t.id === USR.polash)?.href).toBe(`/sac/users/${USR.polash}`)
  })

  it("auditor: today's audit entries, the access review and login history reports", async () => {
    await signedIn(db, "mahbub")
    const h = await home("shamima")
    const start = atDhaka(today, "00:00")
    expect(kpi(h, "auditToday")).toBe(await db.audit.where("at").between(start, start + 86_400_000).count())
    expect(h.todos.find((t) => t.kind === "access-review")?.href).toBe("/irt/run/IRT-32")
    expect(h.todos.find((t) => t.kind === "report")?.href).toBe("/irt/run/IRT-31")
    expect(h.todos.filter((t) => t.kind === "audit").length).toBeGreaterThan(0)
  })
})
