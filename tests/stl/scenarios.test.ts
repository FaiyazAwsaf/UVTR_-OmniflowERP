import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { OmniflowDb } from "@/core/db/database"
import { runScenario } from "@/core/scenarios/runner"
import { LOC, PLANT, PTY, USR, VEH } from "@/core/seed/content/seed-refs"
import { roleId } from "@/core/security/types"
import { readCatalogue } from "@/modules/pc/catalogue"
import { setLimit } from "@/modules/rbac/commands"
import { saveQuotation } from "@/modules/stl/commands"
import { requestsFromLines } from "@/modules/stl/quote-requests"
import { E1_DISCOUNT_PCT, stlScenarios } from "@/modules/stl/scenarios"
import { readOrderStockCheck, requestQtyFor } from "@/modules/stl/stock-check"
import { dhakaDate } from "@/core/clock/dates"
import { now } from "@/core/clock/clock"

import { actors, booksTie, refusal, run, seededDb } from "./helpers"

/**
 * STL launchers on the small seed (plan §10): E1 runs twice in a row and
 * each time the 12% discount on its fresh quotation is refused for Shuvo
 * (limit 5%), refused with a studio manager of another studio, and saved
 * with Arif's inline approval at the amounts the cue shows. Also the E3
 * stock check on the order page and E13's live discount limit.
 */

let db: OmniflowDb
let as: ReturnType<typeof actors>
beforeAll(async () => {
  db = await seededDb("stl-scn")
  as = actors(db)
}, 120_000)
afterAll(async () => {
  await db.delete()
})

const e1 = stlScenarios.find((s) => s.id === "E1")!

describe("E1 discount override", () => {
  for (const runNo of [1, 2]) {
    it(`run ${runNo}: a fresh quotation, then 12% needs Arif's PIN`, async () => {
      const launch = await runScenario(e1, db)
      const quotationId = launch.outcome.refs?.quotationId
      expect(quotationId).toBeTruthy()
      expect(launch.route).toBe(`/stl/quotations/${quotationId}`)
      const quote = (await db.quotations.get(quotationId!))!
      expect(quote).toMatchObject({ status: "draft", discountPct: 0, partyId: PTY.e1Customer, vehicleId: VEH.e1Allion, locationId: LOC.UTT })
      const params = launch.outcome.params!
      expect(params.quoteNo).toBe(quote.quoteNo)
      expect(params.subtotalP).toBe(quote.subtotalP)
      expect(params.subtotalP).toBe(20_000_00)
      expect(params.regNo).toBe((await db.vehicles.get(VEH.e1Allion))!.regNo)

      // The presenter's action on the quotation screen, as Shuvo.
      const lines = await db.quotationLines.where("quotationId").equals(quote.id).toArray()
      const input = {
        quotationId: quote.id,
        expectedVersion: quote.version,
        partyId: quote.partyId,
        vehicleId: quote.vehicleId,
        requests: requestsFromLines(lines),
        discountPct: E1_DISCOUNT_PCT,
      }
      const shuvo = await as("shuvo")
      expect(await refusal(db, shuvo, saveQuotation, input)).toBe("APPROVAL_LIMIT")
      expect(await refusal(db, shuvo, saveQuotation, { ...input, inline: { approverId: USR.shahriar, pin: "1234", reason: "Regular" } })).toBe("NOT_APPROVER")
      expect(await refusal(db, shuvo, saveQuotation, { ...input, inline: { approverId: USR.arif, pin: "0000", reason: "Regular" } })).not.toBe("ok")
      await run(db, shuvo, saveQuotation, { ...input, inline: { approverId: USR.arif, pin: "1234", reason: "Loyal customer, second car" } })
      const saved = (await db.quotations.get(quote.id))!
      expect(saved.discountPct).toBe(12)
      expect(saved.discountP).toBe(params.discountP)
      expect(saved.totalP).toBe(params.totalP)
      expect(saved.discountP).toBe(2_400_00)
      const approval = (await db.approvals.get(saved.discountApprovalId!))!
      expect(approval).toMatchObject({ kind: "discount-pct", status: "approved", decidedBy: USR.arif, inline: true, requestedBy: USR.shuvo, pct: 12 })
    })
  }

  it("E13: the advisor's discount limit is read live (0% asks for the PIN even at 3%)", async () => {
    const tahmid = await as("tahmid")
    const before = (await db.approvalLimits.where("[roleId+kind]").equals([roleId("ADVISOR"), "discount-pct"]).first())!
    await run(db, tahmid, setLimit, { roleId: roleId("ADVISOR"), kind: "discount-pct", value: 0 })
    const launch = await runScenario(e1, db)
    const quote = (await db.quotations.get(launch.outcome.refs!.quotationId!))!
    const lines = await db.quotationLines.where("quotationId").equals(quote.id).toArray()
    const input = { quotationId: quote.id, expectedVersion: quote.version, partyId: quote.partyId, vehicleId: quote.vehicleId, requests: requestsFromLines(lines), discountPct: 3 }
    expect(await refusal(db, await as("shuvo"), saveQuotation, input)).toBe("APPROVAL_LIMIT")
    await run(db, tahmid, setLimit, { roleId: roleId("ADVISOR"), kind: "discount-pct", value: before.value })
    expect(await refusal(db, await as("shuvo"), saveQuotation, input)).toBe("ok")
  })
})

describe("E3 stock check on the order page", () => {
  it("shows the Uttara ceramic job short of coating, rounded up to whole kits for the transfer", async () => {
    const order = (await db.salesOrders.get(PLANT.e3Order))!
    expect(order.status).toBe("booked")
    const lines = await db.salesOrderLines.where("orderId").equals(order.id).toArray()
    const rows = await readOrderStockCheck(db, await readCatalogue(db), { locationId: order.locationId, lines, on: dhakaDate(now()) })
    const short = rows.filter((r) => r.shortQty > 0)
    expect(short.length).toBeGreaterThan(0)
    const coating = short.find((r) => r.item.sku.startsWith("CH-CC2"))
    expect(coating).toBeTruthy()
    expect(coating!.neededQty).toBe(38)
    expect(coating!.usableQty).toBe(20)
    expect(coating!.shortQty).toBe(18)
    expect(coating!.requestQty % coating!.item.purchaseFactor).toBe(0)
    expect(coating!.requestQty).toBeGreaterThanOrEqual(18)
    expect(requestQtyFor({ purchaseFactor: 50 }, 18)).toBe(50)
    expect(requestQtyFor({ purchaseFactor: 50 }, 50)).toBe(50)
    expect(requestQtyFor({ purchaseFactor: 50 }, 51)).toBe(100)
    expect(requestQtyFor({ purchaseFactor: 1000 }, 0)).toBe(0)
  })
})

describe("books", () => {
  it("tie after every run", async () => {
    const tie = await booksTie(db)
    expect(tie.unbalanced).toEqual([])
    expect(tie.debit).toBe(tie.credit)
  })
})
