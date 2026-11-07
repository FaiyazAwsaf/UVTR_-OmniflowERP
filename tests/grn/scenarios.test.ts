import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { ScenarioLaunch } from "@/core/scenarios/runner"
import { runScenario } from "@/core/scenarios/runner"
import { trialBalance } from "@/core/ledger/statements"
import { ITM, LOC, VND } from "@/core/seed/content/seed-refs"
import { poLineProgress, receiveGoods } from "@/modules/grn/commands"
import { e4PartialGrn, E4_RECEIPT } from "@/modules/grn/scenarios"
import { parseDmy } from "@/lib/i18n/dmy"

import { expectBalanced, expectStockTies, run, scmDb, type ScmDb } from "../ic/scm"

/**
 * E4 Partial GRN with QC reject (plan §10), run again and again on the small
 * seed: each run issues a fresh PO to Gloss & Guard (24 kits, 12 polish)
 * that waits above Nusrat's limit and is approved by Farzana; Habib's receipt
 * of 18 + 2 rejected kits and 12 polish reads "18 accepted · 6 pending" and
 * posts R12 for the value the cue names; an untouched PO of a previous run
 * is cancelled.
 */

let s: ScmDb
beforeAll(async () => {
  s = await scmDb("e4")
}, 120_000)
afterAll(async () => {
  await s.db.delete()
})

async function launch(): Promise<ScenarioLaunch> {
  const out = await runScenario(e4PartialGrn, s.db)
  const poId = out.outcome.refs?.poId as string
  expect(out.route).toBe(`/grn/receive/${poId}`)
  const po = (await s.db.purchaseOrders.get(poId))!
  expect(po.status).toBe("issued")
  expect(po.vendorId).toBe(VND.glossGuard)
  expect(po.locationId).toBe(LOC.CST)
  expect(po.totalP).toBe(226_320_00)
  expect(out.outcome.params).toMatchObject({ poNo: po.poNo, poTotalP: 226_320_00, grnValueP: 157_800_00, kitSku: "CH-CC2-50", polishSku: "CH-POL-1L" })
  // Nusrat issued it above her ৳1,00,000; Farzana approved it (never Nusrat).
  const approval = (await s.db.approvals.get(po.approvalId!))!
  expect(approval.status).toBe("approved")
  expect(approval.requestedBy).toBe("usr_nusrat")
  expect(approval.decidedBy).toBe("usr_farzana")
  const lines = await s.db.poLines.where("poId").equals(poId).toArray()
  expect(lines.map((l) => [l.itemId, l.qty]).sort()).toEqual([[ITM.cc2Kit, 24], [ITM.polish, 12]].sort())
  return out
}

/** Habib's receipt as the cue gives it. */
async function receive(out: ScenarioLaunch) {
  const p = out.outcome.params!
  const poId = out.outcome.refs?.poId as string
  const po = (await s.db.purchaseOrders.get(poId))!
  const lines = await s.db.poLines.where("poId").equals(poId).toArray()
  const kits = lines.find((l) => l.itemId === ITM.cc2Kit)!
  const polish = lines.find((l) => l.itemId === ITM.polish)!
  const got = await run(
    s,
    receiveGoods,
    {
      poId,
      expectedVersion: po.version,
      lots: [
        {
          poLineId: kits.id,
          qtyAccepted: E4_RECEIPT.kitsAccepted,
          qtyRejected: E4_RECEIPT.kitsRejected,
          rejectReason: "short-expiry",
          quarantine: true,
          batchNo: String(p.kitBatch),
          expiry: parseDmy(String(p.kitExpiry)) ?? "",
        },
        { poLineId: polish.id, qtyAccepted: E4_RECEIPT.polishAccepted, quarantine: true, batchNo: String(p.polishBatch), expiry: parseDmy(String(p.polishExpiry)) ?? "" },
      ],
      idempotencyKey: `e4-receive-${poId}`,
    },
    "habib"
  )
  expect(got.poStatus).toBe("partial")
  const j = await expectBalanced(s, got.journalId!)
  expect(j.journal.rule).toBe("R12")
  expect(j.byTag.get("INV_CHEMICAL")).toBe(p.grnValueP)
  expect(j.byTag.get("GRNI")).toBe(-Number(p.grnValueP))
  // "18 accepted · 6 pending" on the kits, the 2 rejected held in quarantine.
  const after = (await s.db.poLines.get(kits.id))!
  const progress = poLineProgress(after, E4_RECEIPT.kitsRejected)
  expect(progress.accepted).toBe(18)
  expect(after.qty - progress.accepted).toBe(6)
  const held = (await s.db.grnLines.where("grnId").equals(got.id).toArray()).find((l) => l.itemId === ITM.cc2Kit)!
  expect(held.quarantineStatus).toBe("held")
  expect(held.qtyRejected).toBe(2)
}

async function ties() {
  const tb = trialBalance(await s.db.accounts.toArray(), await s.db.journalLines.toArray(), { from: "2000-01-01", to: "2999-12-31" })
  expect(tb.balanced).toBe(true)
  await expectStockTies(s)
}

describe("E4 launcher", () => {
  let first: ScenarioLaunch

  it("run 1: a fresh approved PO; the partial receipt with a QC reject", async () => {
    first = await launch()
    await receive(first)
    await ties()
  })

  it("run 2: another fresh PO (the received one stays partial); the receipt works again", async () => {
    const second = await launch()
    expect(second.outcome.params?.poNo).not.toBe(first.outcome.params?.poNo)
    expect((await s.db.purchaseOrders.get(first.outcome.refs?.poId as string))?.status).toBe("partial")
    await receive(second)
    await ties()
  })

  it("run 3 and 4: an untouched PO from the previous run is cancelled", async () => {
    const third = await launch()
    const fourth = await launch()
    expect((await s.db.purchaseOrders.get(third.outcome.refs?.poId as string))?.status).toBe("cancelled")
    await receive(fourth)
    await ties()
  })
})
