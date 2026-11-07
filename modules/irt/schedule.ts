import { addDaysISO, atDhaka, dhakaDate } from "@/core/clock/dates"
import type { HHMM, ISODate, Ms, ReportScheduleRow } from "@/core/db/schema"

/**
 * When a report schedule is next due (plan §3.13 `irt.schedules`), in Dhaka
 * time: daily at its time, weekly on Sundays (the first working day of the
 * Bangladeshi week), monthly on the 1st. Pure.
 */

export const SCHEDULE_WEEKDAY = 0 // Sunday

function weekday(day: ISODate): number {
  return new Date(`${day}T00:00:00.000Z`).getUTCDay()
}

export function nextRunAfter(frequency: ReportScheduleRow["frequency"], time: HHMM, after: Ms): Ms {
  const today = dhakaDate(after)
  if (frequency === "daily") {
    const at = atDhaka(today, time)
    return at > after ? at : atDhaka(addDaysISO(today, 1), time)
  }
  if (frequency === "weekly") {
    for (let i = 0; i <= 7; i++) {
      const day = addDaysISO(today, i)
      if (weekday(day) !== SCHEDULE_WEEKDAY) continue
      const at = atDhaka(day, time)
      if (at > after) return at
    }
    return atDhaka(addDaysISO(today, 7), time)
  }
  const first = `${today.slice(0, 7)}-01`
  const at = atDhaka(first, time)
  if (at > after) return at
  const [y, m] = today.split("-").map(Number)
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`
  return atDhaka(next, time)
}

/** HH:MM validation (24 hours). */
export const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
