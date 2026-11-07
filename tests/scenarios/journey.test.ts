import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { z } from "zod"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import { stockValueId } from "@/core/db/tables"
import { commit } from "@/core/engine/commit"
import type { Actor, CommandDef } from "@/core/engine/types"
import { trialBalance } from "@/core/ledger/statements"
import { SCENARIOS } from "@/core/scenarios/registry"
import { createKit, runScenario } from "@/core/scenarios/runner"
import { seedDatabase } from "@/core/seed"
import { BAY, PTY, SVC, USR, VEH } from "@/core/seed/content/seed-refs"
import { dhakaAt } from "@/core/seed/time"
import { advanceOf, JOURNEY, journeyOrder } from "@/modules/demo/journey"
import { handover, HANDOVER_KEYS } from "@/modules/sd/commands"
import { checkout } from "@/modules/si/commands"
import { acceptQuotation, finishTask, qcCheck, QC_KEYS, saveQuotation, scheduleOrder, startTask } from "@/modules/stl/commands"

import { freshDb, signedIn } from "../helpers/foundation"

/**
 * The main-journey launchers J1 to J6 (plan §10), each run twice in a row on
 * the small seed, with the presenter's key action after every run done
 * through the real commands as the person on the cue card. The books tie at
 * the end.
 */
let db: OmniflowDb
const today = dhakaDate(now())
const actors = new Map<string, Actor>()
let n = 0

async function as(username: string): Promise<Actor> {
  if (!actors.has(username)) actors.set(username, await signedIn(db, username))
  return actors.get(username)!
}
async function act<S extends z.ZodType, O>(def: CommandDef<S, O>, input: z.input<S>, username: string): Promise<O> {
  return (await commit(def, input, { db, actor: await as(username) })).result
}
const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!
const launch = (id: string) => runScenario(scenario(id), db)
const key = (label: string) => `test-${label}-${++n}`

async function ties(): Promise<boolean> {
  return trialBalance(await db.accounts.toArray(), await db.journalLines.toArray(), { from: "2000-01-01", to: "2999-12-31" }).balanced
}
async function order() {
  const o = await journeyOrder(createKit(scenario("J2"), db))
  if (!o) throw new Error("no journey order")
  return o
}

beforeAll(async () => {
  db = await freshDb("journey")
  await seedDatabase(db, { now: dhakaAt(today, "10:30"), today, scale: "small" })
  // The demo clock at opening time, as after a reset.
  applyClockOffset(atDhaka(today, "10:30") - Date.now())
}, 180_000)
afterAll(async () => {
  applyClockOffset(0)
  await db.delete()
})

describe("main journey launchers (J1 to J6)", () => {
  it("J1 twice: the presenter quotes, takes the bKash deposit and books C1 at 11:00 each time", async () => {
    for (let run = 0; run < 2; run++) {
      const out = await launch("J1")
      expect(out.route).toBe("/stl/quotations/new")
      expect(out.outcome.params?.regNo).toBeTruthy()
      const stock = await db.stockValues.get(stockValueId(JOURNEY.itemId, JOURNEY.locationId))
      expect(stock?.qtyBase ?? 0).toBeGreaterThanOrEqual(JOURNEY.minStock)
      expect(await advanceOf(createKit(scenario("J1"), db))).toBe(0)
      const quote = await act(saveQuotation, { locationId: "loc_gul", partyId: PTY.shahedKabir, vehicleId: VEH.corollaCross7731, requests: [{ kind: "service", serviceId: SVC.PRT_CC2 }, { kind: "service", serviceId: SVC.INT_DEEP }] }, "nayeem")
      const accepted = await act(acceptQuotation, { quotationId: quote.quotationId, deposit: { method: "bkash", amountP: 10_000_00, ref: "BK0000001", confirmed: true }, idempotencyKey: key("accept") }, "nayeem")
      const lines = await db.salesOrderLines.where("orderId").equals(accepted.orderId).sortBy("lineNo")
      await act(scheduleOrder, { orderId: accepted.orderId, bayId: BAY.GUL_C1, start: atDhaka(today, "11:00"), assignments: lines.map((l) => ({ orderLineId: l.id, technicianId: USR.rakib })) }, "nayeem")
      expect((await db.salesOrders.get(accepted.orderId))?.status).toBe("booked")
    }
    // The first run's booking was cleared by the second (cancelled, deposit returned).
    const cancelled = (await db.salesOrders.where("vehicleId").equals(VEH.corollaCross7731).toArray()).filter((o) => o.status === "cancelled")
    expect(cancelled.length).toBeGreaterThanOrEqual(1)
    expect(await ties()).toBe(true)
  })

  it("J2 twice: Rakib starts and finishes his tasks; the job reaches QC each time", async () => {
    for (let run = 0; run < 2; run++) {
      const out = await launch("J2")
      expect(out.route).toBe("/stl/my-jobs")
      const o = await order()
      expect(out.outcome.refs?.orderId).toBe(o.id)
      const tasks = await db.jobTasks.where("orderId").equals(o.id).toArray()
      expect(tasks.length).toBe(2)
      expect(tasks.every((t) => t.technicianId === USR.rakib && t.bayId === BAY.GUL_C1 && t.status === "queued")).toBe(true)
      for (const t of tasks) {
        await act(startTask, { taskId: t.id }, "rakib")
        await act(finishTask, { taskId: t.id }, "rakib")
      }
      expect((await db.salesOrders.get(o.id))?.status).toBe("qc")
      const issued = (await db.jobConsumptions.toArray()).filter((c) => c.orderId === o.id)
      expect(issued.length).toBeGreaterThan(0)
    }
    expect(await ties()).toBe(true)
  })

  it("J3 twice: Shahriar passes QC and hands over with a signature each time", async () => {
    for (let run = 0; run < 2; run++) {
      const out = await launch("J3")
      const o = await order()
      expect(out.route).toBe(`/sd/handover/${o.id}`)
      expect(o.status).toBe("qc")
      await act(qcCheck, { orderId: o.id, items: QC_KEYS.map((k) => ({ key: k, ok: true })) }, "shahriar")
      await act(handover, { orderId: o.id, checklist: HANDOVER_KEYS.map((k) => ({ key: k, ok: true })), signatureName: "Shahed Kabir", signatureSvg: "M1 1 L 20 20" }, "shahriar")
      expect((await db.salesOrders.get(o.id))?.status).toBe("delivered")
    }
    expect(await ties()).toBe(true)
  })

  it("J4 twice: Tania takes the balance by card and cash with the advance applied", async () => {
    for (let run = 0; run < 2; run++) {
      const out = await launch("J4")
      expect(out.route).toBe("/si/counter")
      const o = await order()
      expect(o.status).toBe("delivered")
      const applied = Math.min(o.totalP, await advanceOf(createKit(scenario("J4"), db)))
      expect(out.outcome.params?.depositP).toBe(applied)
      const due = o.totalP - applied
      const paid = await act(checkout, { orderIds: [o.id], tenders: [{ method: "card", amountP: 20_000_00, ref: "AUTH01" }, { method: "cash", amountP: due - 20_000_00, tenderedP: due - 20_000_00 }], idempotencyKey: key("checkout") }, "tania")
      expect(paid.status).toBe("paid")
      expect((await db.salesInvoices.get(paid.invoiceId))?.advanceAppliedP).toBe(applied)
      expect((await db.salesOrders.get(o.id))?.status).toBe("closed")
    }
    expect(await ties()).toBe(true)
  })

  it("J5 and J6 twice: the journey is paid, its vouchers are posted and the books tie", async () => {
    for (const id of ["J5", "J5", "J6", "J6"]) {
      const out = await launch(id)
      expect(out.route).toBe(id === "J5" ? "/fa/journals" : "/dashboard")
      const invoiceId = out.outcome.refs?.invoiceId
      expect(invoiceId).toBeTruthy()
      const invoice = (await db.salesInvoices.get(invoiceId!))!
      expect(invoice.status).toBe("paid")
      expect(out.outcome.params?.invoiceNo).toBe(invoice.invoiceNo)
      const journals = (await db.journals.toArray()).filter((j) => j.source?.docId === invoice.id)
      expect(journals.map((j) => j.rule)).toContain("R6")
      expect(await ties()).toBe(true)
    }
  })
})
