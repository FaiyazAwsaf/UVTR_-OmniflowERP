"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import { rules } from "@/config/rules.config"
import { useApprovalInbox } from "@/core/approvals/useInbox"
import { addDaysISO, dhakaDate, startOfDhakaDay } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { Id } from "@/core/db/schema"
import type { AppCode } from "@/core/security/types"
import { usePermissions } from "@/core/security/useCan"

import { docApp } from "./doc-routes"

/** Ids of what waits in one app (a set, so a bill on hold that is also my approval counts once). */
type Waiting = Partial<Record<AppCode, string[]>>

const NONE: Waiting = {}

/**
 * What waits in each app for this user, from cheap live queries (each reads a
 * small index range or a small table). They re-run in every window when the
 * underlying rows change, so a badge moves the moment another window commits:
 * - every app: approvals routed to me for its document types;
 * - AP: bills on hold; GRN: lots held in quarantine;
 * - STL: orders waiting for QC at my studios (QC checkers) or my open tasks
 *   today (technicians); SD: vehicles ready for handover;
 * - IC: items at or below their reorder minimum at my locations;
 * - CAB: received cheques due for deposit within the PDC warning days;
 * - SAC: locked user accounts.
 * Before the seed fills these tables every count is 0. `undefined` while loading.
 */
function useOperationalWaiting(): Waiting | undefined {
  const db = useDb()
  const { user, can } = usePermissions()
  const nowMs = useNow(60_000)
  const today = nowMs ? dhakaDate(nowMs) : ""
  const userId = user?.id

  // `can` changes only when this user's grants, roles or limits change (one
  // live permissions query per window), so it is a cheap dependency.
  const result = useLiveQuery(async (): Promise<Waiting> => {
    if (!userId || !today) return NONE
    const flags = {
      ap: can("ap.app.view"),
      ic: can("ic.app.view"),
      qc: can("stl.qc.check"),
      work: can("stl.job.work"),
      sd: can("sd.delivery.handover"),
      grn: can("grn.quarantine.decide"),
      cab: can("cab.cheque.update"),
      sac: can("sac.user.edit"),
    }
    const out: Waiting = {}
    const at = (key: string) => (locationId: Id) => can(key, locationId)

    if (flags.ap) {
      const held = await db.vendorBills.where("status").equals("on-hold").primaryKeys()
      out.ap = held.map((id) => `vendorBills:${id}`)
    }
    if (flags.grn) {
      const held = await db.grnLines.where("quarantineStatus").equals("held").primaryKeys()
      out.grn = held.map((id) => `grnLines:${id}`)
    }
    if (flags.qc) {
      const allowed = at("stl.qc.check")
      const qc = await db.salesOrders.where("status").equals("qc").toArray()
      out.stl = qc.filter((o) => allowed(o.locationId)).map((o) => `salesOrders:${o.id}`)
    } else if (flags.work) {
      const endOfDay = startOfDhakaDay(addDaysISO(today, 1))
      const tasks = await db.jobTasks
        .where("[technicianId+status]")
        .anyOf([userId, "queued"], [userId, "in-progress"])
        .toArray()
      out.stl = tasks.filter((task) => task.plannedStart < endOfDay).map((task) => `jobTasks:${task.id}`)
    }
    if (flags.sd) {
      const allowed = at("sd.delivery.handover")
      const ready = await db.salesOrders.where("status").equals("ready").toArray()
      out.sd = ready.filter((o) => allowed(o.locationId)).map((o) => `salesOrders:${o.id}`)
    }
    if (flags.ic) {
      const allowed = at("ic.app.view")
      const [ruleRows, values] = await Promise.all([db.reorderRules.toArray(), db.stockValues.toArray()])
      const onHand = new Map(values.map((v) => [`${v.itemId}:${v.locationId}`, v.qtyBase]))
      out.ic = ruleRows
        .filter((r) => r.minQty > 0 && allowed(r.locationId))
        .filter((r) => (onHand.get(`${r.itemId}:${r.locationId}`) ?? 0) <= r.minQty)
        .map((r) => `reorderRules:${r.id}`)
    }
    if (flags.cab) {
      const due = addDaysISO(today, rules.pdcWarnDays)
      const inHand = await db.cheques.where("status").equals("in-hand").toArray()
      out.cab = inHand
        .filter((c) => c.direction === "received" && c.chequeDate <= due)
        .map((c) => `cheques:${c.id}`)
    }
    if (flags.sac) {
      const locked = await db.users.where("status").equals("locked").primaryKeys()
      out.sac = locked.map((id) => `users:${id}`)
    }
    return out
  }, [db, userId, today, can])

  return result
}

/**
 * Live counts of what waits, keyed by sidebar href (`/approvals`, `/ap`,
 * `/ic`, ...): the yellow badges of the sidebar and the "waiting" line of the
 * /apps tiles (ui_guidelines.md §3, §4). `undefined` until every query has
 * loaded once, so callers can tell a first load from a live change.
 */
export function useNavCounts(): Record<string, number> | undefined {
  const inbox = useApprovalInbox()
  const operational = useOperationalWaiting()
  return React.useMemo(() => {
    if (!inbox || !operational) return undefined
    const sets = new Map<string, Set<string>>()
    const add = (app: string, key: string) => {
      const set = sets.get(app) ?? new Set<string>()
      set.add(key)
      sets.set(app, set)
    }
    for (const approval of inbox.forMe) {
      const app = docApp(approval.docType)
      if (app) add(app, `${approval.docType}:${approval.docId}`)
    }
    for (const [app, keys] of Object.entries(operational)) {
      for (const key of keys ?? []) add(app, key)
    }
    const counts: Record<string, number> = { "/approvals": inbox.forMe.length }
    for (const [app, set] of sets) counts[`/${app}`] = set.size
    return counts
  }, [inbox, operational])
}
