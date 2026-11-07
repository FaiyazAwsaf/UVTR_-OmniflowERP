import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { ScenarioLaunch } from "@/core/scenarios/runner"
import { runScenario } from "@/core/scenarios/runner"
import { trialBalance } from "@/core/ledger/statements"
import { BAY, ITM, LOC, PLANT } from "@/core/seed/content/seed-refs"
import { usableAt } from "@/modules/ic/scenario-kit"
import { e3StockOut } from "@/modules/st/scenarios"
import { dispatchTransfer, receiveTransfer, requestTransfer } from "@/modules/st/commands"
import { finishTask, startTask } from "@/modules/stl/commands"

import { expectBalanced, expectStockTies, run, scmDb, type ScmDb } from "../ic/scm"

/**
 * E3 Stock-out for a job (plan §10), run again and again on the small seed:
 * each run books a fresh SUV ceramic 2-year job in Uttara's C1 with exactly
 * 20 ml on the shelf; the transfer from the Central Store (R20, R21) lets the
 * technician finish the job (R4 takes 38 ml); leftovers of a previous run
 * (its booked job, a request or a transfer in transit) are cleared.
 */

let s: ScmDb
beforeAll(async () => {
  s = await scmDb("e3")
}, 120_000)
afterAll(async () => {
  await s.db.delete()
})

const usable = (locationId: string) => usableAt(s.db, ITM.cc2Kit, locationId, s.today)

async function launch(): Promise<ScenarioLaunch> {
  const out = await runScenario(e3StockOut, s.db)
  const orderId = out.outcome.refs?.orderId as string
  expect(out.route).toBe(`/stl/orders/${orderId}`)
  expect(out.companionRoute).toBe("/st/transfers")
  const order = (await s.db.salesOrders.get(orderId))!
  expect(order.status).toBe("booked")
  expect(order.locationId).toBe(LOC.UTT)
  expect(order.bayId).toBe(BAY.UTT_C1)
  expect(order.orderNo).toBe(out.outcome.params?.orderNo)
  const tasks = await s.db.jobTasks.where("orderId").equals(orderId).toArray()
  expect(tasks).toHaveLength(1)
  expect(["usr_kamrul", "usr_jewel"]).toContain(tasks[0].technicianId)
  expect(out.outcome.params).toMatchObject({ sku: "CH-CC2-50", needQty: 38, onHandQty: 20, shortQty: 18, transferQty: 50, afterQty: 70 })
  expect(await usable(LOC.UTT)).toBe(20)
  expect(await usable(LOC.CST)).toBeGreaterThanOrEqual(50)
  return out
}

/** The presenter's part: the request from the stock check, Habib's dispatch, Arif's receipt. */
async function transfer(out: ScenarioLaunch, stopAt: "requested" | "dispatched" | "received" = "received") {
  const p = out.outcome.params!
  const req = await run(
    s,
    requestTransfer,
    { fromLocationId: LOC.CST, toLocationId: LOC.UTT, note: `For job order ${p.orderNo}`, lines: [{ itemId: ITM.cc2Kit, qtyBase: Number(p.transferQty) }] },
    "arif"
  )
  if (stopAt === "requested") return req.id
  let tr = (await s.db.transfers.get(req.id))!
  const sent = await run(s, dispatchTransfer, { transferId: tr.id, expectedVersion: tr.version, lines: [] }, "habib")
  await expectBalanced(s, sent.journalId)
  if (stopAt === "dispatched") return req.id
  tr = (await s.db.transfers.get(req.id))!
  const got = await run(s, receiveTransfer, { transferId: tr.id, expectedVersion: tr.version, lines: [] }, "arif")
  await expectBalanced(s, got.journalId)
  expect(await usable(LOC.UTT)).toBe(Number(p.afterQty))
  return req.id
}

/** The job proceeds: the technician starts and finishes it; the recipe takes 38 ml (R4). */
async function finishJob(out: ScenarioLaunch) {
  const orderId = out.outcome.refs?.orderId as string
  const [task] = await s.db.jobTasks.where("orderId").equals(orderId).toArray()
  const tech = (await s.db.users.get(task.technicianId))!.username
  await run(s, startTask, { taskId: task.id }, tech)
  const done = await run(s, finishTask, { taskId: task.id }, tech)
  expect(done.toQc).toBe(true)
  const used = (await s.db.jobConsumptions.where("orderId").equals(orderId).toArray()).find((c) => c.itemId === ITM.cc2Kit)!
  expect(used.actualQty).toBe(38)
  expect(await usable(LOC.UTT)).toBe(32)
}

async function ties() {
  const tb = trialBalance(await s.db.accounts.toArray(), await s.db.journalLines.toArray(), { from: "2000-01-01", to: "2999-12-31" })
  expect(tb.balanced).toBe(true)
  await expectStockTies(s)
}

describe("E3 launcher", () => {
  let first: ScenarioLaunch
  let second: ScenarioLaunch

  it("run 1: replaces the planted job with a fresh one, 20 ml on Uttara's shelf; the transfer lets the job finish", async () => {
    first = await launch()
    expect((await s.db.salesOrders.get(PLANT.e3Order))?.status).toBe("cancelled")
    await transfer(first)
    await finishJob(first)
    await ties()
  })

  it("run 2: a finished job stays as it is; a fresh job, the shelf back to 20 ml", async () => {
    second = await launch()
    expect(second.outcome.refs?.orderId).not.toBe(first.outcome.refs?.orderId)
    expect((await s.db.salesOrders.get(first.outcome.refs?.orderId as string))?.status).toBe("qc")
    // This time the presenter stops with the transfer in transit.
    await transfer(second, "dispatched")
    await ties()
  })

  it("run 3: clears run 2's booked job and receives its transfer in transit; the story works again", async () => {
    const leftover = (await s.db.transfers.where("status").equals("dispatched").toArray()).find((t) => t.note?.includes(String(second.outcome.params?.orderNo)))
    expect(leftover).toBeDefined()
    const third = await launch()
    expect((await s.db.salesOrders.get(second.outcome.refs?.orderId as string))?.status).toBe("cancelled")
    expect((await s.db.transfers.get(leftover!.id))?.status).toBe("received")
    // A request left waiting is withdrawn by the next run.
    const waiting = await transfer(third, "requested")
    const fourth = await launch()
    expect((await s.db.transfers.get(waiting))?.status).toBe("cancelled")
    await transfer(fourth)
    await finishJob(fourth)
    await ties()
  })
})
