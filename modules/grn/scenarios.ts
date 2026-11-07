import { decideApproval } from "@/core/approvals/decide"
import { addDaysISO } from "@/core/clock/dates"
import { previousRuns } from "@/core/scenarios/helpers"
import type { ScenarioDef, ScenarioKit } from "@/core/scenarios/types"
import { ITM, LOC, VND } from "@/core/seed/content/seed-refs"
import { addMonthsISO } from "@/core/seed/time"
import { cueDate, runKey } from "@/modules/ic/scenario-kit"
import { cancelPo, issuePo } from "@/modules/ptl/commands"

/**
 * E4 Partial GRN with QC reject (plan §10): a fresh PO to Gloss & Guard for
 * 24 ceramic coating 2-year kits and 12 finishing polish (1 L), issued by
 * Nusrat and, above her purchase limit, approved by Farzana. Habib receives
 * 20 kits (2 rejected for short expiry, into quarantine) and 12 polish:
 * "18 accepted · 6 pending".
 */

export const E4_KITS = 24
export const E4_POLISH = 12
/** What the cue asks the presenter to enter */
export const E4_RECEIPT = { kitsAccepted: 18, kitsRejected: 2, polishAccepted: 12 } as const
const REASON = "Superseded by a new E4 demo order"

/** Earlier E4 orders nothing was received against are cancelled (re-run rules). */
async function clearEarlierRuns(kit: ScenarioKit): Promise<void> {
  for (const run of await previousRuns(kit.db, "E4")) {
    const po = run.refs.poId ? await kit.db.purchaseOrders.get(run.refs.poId) : undefined
    if (!po || (po.status !== "issued" && po.status !== "pending-approval")) continue
    const lines = await kit.db.poLines.where("poId").equals(po.id).toArray()
    if (lines.some((l) => l.qtyReceived > 0)) continue
    await kit.run(cancelPo, { poId: po.id, expectedVersion: po.version, reason: REASON }, "nusrat")
  }
}

export const e4PartialGrn: ScenarioDef = {
  id: "E4",
  kind: "scenario",
  module: "grn",
  titleKey: "grn.scenarios.e4.title",
  summaryKey: "grn.scenarios.e4.summary",
  user: "habib",
  async setup(kit) {
    const db = kit.db
    const today = kit.today()
    await clearEarlierRuns(kit)

    const [kits, polish] = await Promise.all([db.items.get(ITM.cc2Kit), db.items.get(ITM.polish)])
    if (!kits || !polish) throw new Error("E4: ceramic coating or polish missing from the item master")
    const out = await kit.run(
      issuePo,
      {
        locationId: LOC.CST,
        orders: [
          {
            vendorId: VND.glossGuard,
            expectedDate: addDaysISO(today, 3),
            lines: [
              { itemId: kits.id, qty: E4_KITS, unitCostP: kits.standardCostP },
              { itemId: polish.id, qty: E4_POLISH, unitCostP: polish.standardCostP },
            ],
          },
        ],
        idempotencyKey: runKey(kit, "po"),
      },
      "nusrat"
    )
    const created = out.pos[0]
    let po = await db.purchaseOrders.get(created.id)
    // Above Nusrat's purchase limit the PO waits: Farzana approves it from her inbox.
    if (po?.status === "pending-approval" && po.approvalId) {
      const approval = await db.approvals.get(po.approvalId)
      if (approval) {
        await kit.run(
          decideApproval,
          { approvalId: approval.id, decision: "approve", reason: "Coating stock for the month", expectedVersion: approval.version },
          "farzana"
        )
      }
      po = await db.purchaseOrders.get(created.id)
    }
    if (!po) throw new Error("E4: the PO was not saved")

    const serial = po.poNo.split("-").pop() ?? "1"
    const kitExpiry = cueDate(addMonthsISO(today, 18))
    const polishExpiry = cueDate(addMonthsISO(today, 24))
    return {
      refs: { poId: po.id, partyId: VND.glossGuard, locationId: LOC.CST },
      params: {
        poNo: po.poNo,
        poTotalP: po.totalP,
        kitSku: kits.sku,
        polishSku: polish.sku,
        kitBatch: `CN-CC2-${serial}`,
        polishBatch: `LM-POL-${serial}`,
        kitExpiry: kitExpiry.en,
        kitExpiryBn: kitExpiry.bn,
        polishExpiry: polishExpiry.en,
        polishExpiryBn: polishExpiry.bn,
        grnValueP: E4_RECEIPT.kitsAccepted * kits.standardCostP + E4_RECEIPT.polishAccepted * polish.standardCostP,
      },
    }
  },
  route: (outcome) => `/grn/receive/${outcome.refs?.poId ?? ""}`,
  cueKeys: ["grn.scenarios.e4.cue1", "grn.scenarios.e4.cue2", "grn.scenarios.e4.cue3", "grn.scenarios.e4.cue4", "grn.scenarios.e4.cue5"],
}

/** GRN scenario launchers (implementation_plan.md §10). */
export const grnScenarios: ScenarioDef[] = [e4PartialGrn]
