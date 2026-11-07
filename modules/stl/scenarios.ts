import type { ScenarioDef } from "@/core/scenarios/types"
import { PTY, SVC, USR, VEH } from "@/core/seed/content/seed-refs"
import { readCatalogue } from "@/modules/pc/catalogue"
import { priceRequests, type LineRequest } from "@/modules/pc/pricing"
import { unlockUser } from "@/modules/sac/commands"

import { saveQuotation } from "./commands"

/**
 * STL scenario launchers (implementation_plan.md §10).
 *
 * E1 Discount override: Shuvo (advisor, Uttara, discount limit 5%) has a
 * fresh sedan quotation for the E1 customer's Toyota Allion; the customer
 * asks for 12%, so the quotation screen asks for an approver: Arif (studio
 * manager, limit 15%) confirms with the PIN. Each run saves a new draft
 * quotation, so nothing from an earlier run is in the way.
 */

/** Paint correction 1-step and sealant on the sedan (৳20,000 on the retail list). */
export const E1_REQUESTS: LineRequest[] = [
  { kind: "service", serviceId: SVC.PNT_C1 },
  { kind: "service", serviceId: SVC.PRT_SLN },
]
/** The percent the customer asks for (above the advisor's 5%, within the manager's 15%) */
export const E1_DISCOUNT_PCT = 12

const e1: ScenarioDef = {
  id: "E1",
  kind: "scenario",
  module: "stl",
  titleKey: "stl.scenarios.e1.title",
  summaryKey: "stl.scenarios.e1.summary",
  user: "shuvo",
  async setup(kit) {
    // The window signs in as Shuvo; a lockout left over from E14 would stop it.
    const shuvo = await kit.db.users.get(USR.shuvo)
    if (shuvo?.status === "locked") await kit.run(unlockUser, { userId: USR.shuvo, reason: "Demo: E1 needs Shuvo's window" }, "tahmid")
    const { quotationId, quoteNo } = await kit.run(
      saveQuotation,
      { partyId: PTY.e1Customer, vehicleId: VEH.e1Allion, requests: E1_REQUESTS, discountPct: 0 },
      "shuvo"
    )
    const [quote, party, vehicle, catalogue] = await Promise.all([
      kit.db.quotations.get(quotationId),
      kit.db.parties.get(PTY.e1Customer),
      kit.db.vehicles.get(VEH.e1Allion),
      readCatalogue(kit.db),
    ])
    if (!quote || !party || !vehicle) throw new Error("E1: the quotation, customer or vehicle is missing")
    const asked = priceRequests(catalogue, {
      priceListId: party.priceListId,
      date: kit.today(),
      vehicleClass: vehicle.vehicleClass,
      requests: E1_REQUESTS,
      discountPct: E1_DISCOUNT_PCT,
    })
    return {
      refs: { quotationId, partyId: party.id, vehicleId: vehicle.id },
      params: {
        quoteNo,
        regNo: vehicle.regNo,
        nameEn: party.nameEn,
        nameBn: party.nameBn,
        pct: E1_DISCOUNT_PCT,
        subtotalP: quote.subtotalP,
        discountP: asked.discountP,
        totalP: asked.totalP,
      },
    }
  },
  route: (outcome) => `/stl/quotations/${outcome.refs?.quotationId ?? ""}`,
  cueKeys: ["stl.scenarios.e1.cue1", "stl.scenarios.e1.cue2", "stl.scenarios.e1.cue3", "stl.scenarios.e1.cue4"],
}

export const stlScenarios: ScenarioDef[] = [e1]
