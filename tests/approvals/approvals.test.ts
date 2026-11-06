import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { requireApproval } from "@/core/approvals/approvals"
import { decideApproval } from "@/core/approvals/decide"
import { APPROVAL_HANDLERS } from "@/core/approvals/registry"
import type { OmniflowDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Actor } from "@/core/engine/types"

import { foundationDb, signedIn } from "../helpers/foundation"

/** A pretend document type whose approval handler records the outcome. */
const decided: { docId: string; outcome: string }[] = []
APPROVAL_HANDLERS.testDocs = {
  async onApproved(_tx, docId) {
    decided.push({ docId, outcome: "approved" })
  },
  async onRejected(_tx, docId) {
    decided.push({ docId, outcome: "rejected" })
  },
}

const spend = defineCommand({
  name: "cab.testSpend",
  permission: "cab.pettycash.create",
  input: z.object({
    docId: z.string(),
    amountP: z.number(),
    locationId: z.string(),
    inline: z.object({ approverId: z.string(), pin: z.string(), reason: z.string() }).optional(),
  }),
  async run(tx, input) {
    tx.requireLocation(input.locationId)
    return requireApproval(tx, {
      kind: "petty-cash",
      docType: "testDocs",
      docId: input.docId,
      docNo: `PCV-TEST-${input.docId}`,
      locationId: input.locationId,
      amountP: input.amountP,
      reason: "test",
      inline: input.inline,
    })
  },
})

let db: OmniflowDb
let tania: Actor
beforeEach(async () => {
  decided.length = 0
  db = await foundationDb("approvals")
  tania = await signedIn(db, "tania")
})
afterEach(async () => {
  await db.delete()
})

describe("approvals (plan §3.7)", () => {
  it("posts within the maker's own limit without an approval", async () => {
    const out = await commit(spend, { docId: "d1", amountP: 800_00, locationId: "loc_gul" }, { db, actor: tania })
    expect(out.result).toEqual({ status: "within-limit" })
    expect(await db.approvals.count()).toBe(0)
  })

  it("queues above the limit, routed to eligible approvers only, never the requester", async () => {
    const out = await commit(spend, { docId: "d2", amountP: 3_500_00, locationId: "loc_gul" }, { db, actor: tania })
    expect(out.result.status).toBe("pending")
    const approval = await db.approvals.get((out.result as { approvalId: string }).approvalId)
    expect(approval?.approveKey).toBe("cab.pettycash.approve")
    // Shahriar (GUL studio manager, 5,000), Farzana (20,000), Rashed (owner); not Arif (UTT), not Tania.
    expect(new Set(approval?.routedTo)).toEqual(new Set(["usr_shahriar", "usr_farzana", "usr_rashed"]))
    expect(await db.notifications.where("userId").equals("usr_shahriar").count()).toBe(1)
    expect(await db.events.where("type").equals("ApprovalRequested").count()).toBe(1)
  })

  it("lets an eligible approver decide, running the module handler in the same commit", async () => {
    const out = await commit(spend, { docId: "d3", amountP: 3_500_00, locationId: "loc_gul" }, { db, actor: tania })
    const approvalId = (out.result as { approvalId: string }).approvalId
    const arif = await signedIn(db, "arif")
    await expect(
      commit(decideApproval, { approvalId, decision: "approve", reason: "", expectedVersion: 1 }, { db, actor: arif })
    ).rejects.toMatchObject({ code: "NOT_APPROVER" })
    await expect(
      commit(decideApproval, { approvalId, decision: "approve", reason: "", expectedVersion: 1 }, { db, actor: tania })
    ).rejects.toMatchObject({ code: "SELF_APPROVAL" })
    const shahriar = await signedIn(db, "shahriar")
    await commit(decideApproval, { approvalId, decision: "approve", reason: "ok", expectedVersion: 1 }, { db, actor: shahriar })
    expect(await db.approvals.get(approvalId)).toMatchObject({ status: "approved", decidedBy: "usr_shahriar" })
    expect(decided).toEqual([{ docId: "d3", outcome: "approved" }])
    expect(await db.notifications.where("userId").equals(tania.userId).count()).toBe(1)
    await expect(
      commit(decideApproval, { approvalId, decision: "reject", reason: "", expectedVersion: 2 }, { db, actor: shahriar })
    ).rejects.toMatchObject({ code: "APPROVAL_DECIDED" })
  })

  it("refuses an approver whose limit does not cover the amount", async () => {
    const out = await commit(spend, { docId: "d4", amountP: 8_000_00, locationId: "loc_gul" }, { db, actor: tania })
    const approval = await db.approvals.get((out.result as { approvalId: string }).approvalId)
    expect(approval?.routedTo).not.toContain("usr_shahriar")
    const shahriar = await signedIn(db, "shahriar")
    await expect(
      commit(decideApproval, { approvalId: approval!.id, decision: "approve", reason: "", expectedVersion: 1 }, { db, actor: shahriar })
    ).rejects.toMatchObject({ code: "NOT_APPROVER" })
  })

  it("approves inline with the approver's PIN, recording the approval", async () => {
    await expect(
      commit(
        spend,
        { docId: "d5", amountP: 3_500_00, locationId: "loc_gul", inline: { approverId: "usr_shahriar", pin: "0000", reason: "r" } },
        { db, actor: tania }
      )
    ).rejects.toMatchObject({ code: "BAD_PIN" })
    await expect(
      commit(
        spend,
        { docId: "d5", amountP: 3_500_00, locationId: "loc_gul", inline: { approverId: "usr_arif", pin: "1234", reason: "r" } },
        { db, actor: tania }
      )
    ).rejects.toMatchObject({ code: "NOT_APPROVER" })
    const out = await commit(
      spend,
      { docId: "d5", amountP: 3_500_00, locationId: "loc_gul", inline: { approverId: "usr_shahriar", pin: "1234", reason: "urgent" } },
      { db, actor: tania }
    )
    expect(out.result.status).toBe("approved")
    const audit = await db.audit.where("commitId").equals(out.commitId).toArray()
    expect(audit.every((r) => r.approvedBy === "usr_shahriar")).toBe(true)
  })
})
