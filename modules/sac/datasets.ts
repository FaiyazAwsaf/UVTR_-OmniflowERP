import { DAY, dhakaDate, dhakaTime, startOfDhakaDay } from "@/core/clock/dates"
import type { OmniflowDb } from "@/core/db/database"
import type { DatasetLoaders, DatasetParams } from "@/core/reports/types"

/**
 * SAC report dataset loaders (implementation_plan.md §3.19.1): `sac.logins`
 * (one row per login event) and `sac.audit` (one row per audit row), newest
 * first, inside the run's date range. Names are the stored English names;
 * rows also carry `userHref` and `time` for drill-down and display.
 */

function msRange(params: DatasetParams): [number, number] {
  const from = typeof params.from === "string" && params.from ? startOfDhakaDay(params.from) : 0
  const to = typeof params.to === "string" && params.to ? startOfDhakaDay(params.to) + DAY - 1 : Number.MAX_SAFE_INTEGER
  return [from, to]
}

async function userNames(db: OmniflowDb): Promise<Map<string, string>> {
  return new Map((await db.users.toArray()).map((u) => [u.id, u.nameEn]))
}

export const sacDatasetLoaders: DatasetLoaders = {
  "sac.logins": async (db, params) => {
    const [from, to] = msRange(params)
    const [events, names] = await Promise.all([
      db.loginEvents.where("at").between(from, to, true, true).reverse().sortBy("at"),
      userNames(db),
    ])
    return events.map((e) => ({
      date: dhakaDate(e.at),
      time: dhakaTime(e.at),
      user: (e.userId && names.get(e.userId)) || e.username,
      username: e.username,
      result: e.result,
      method: e.method,
      userHref: e.userId ? `/sac/users/${e.userId}` : undefined,
    }))
  },
  "sac.audit": async (db, params) => {
    const [from, to] = msRange(params)
    const rows = await db.audit.where("at").between(from, to, true, true).reverse().sortBy("seq")
    return rows.map((row) => ({
      date: dhakaDate(row.at),
      time: dhakaTime(row.at),
      seq: row.seq,
      user: row.actor?.userId === "system" ? "System" : (row.actor?.name ?? row.actor?.username ?? ""),
      app: row.app,
      action: row.action,
      entity: row.entity,
      docNo: row.docNo ?? "",
      command: row.command,
      userHref: row.actor && row.actor.userId !== "system" ? `/sac/users/${row.actor.userId}` : undefined,
    }))
  },
}
