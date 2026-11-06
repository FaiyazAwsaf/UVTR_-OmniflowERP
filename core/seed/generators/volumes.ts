import type { ISODate } from "@/core/db/schema"

import type { World } from "../engine/world"

/**
 * Retail volumes (seed_data.md §7.1): about 12 retail jobs a day at Gulshan
 * and 8 at Uttara, by weekday, with ±12% noise and a slow 0.15% daily
 * growth. The growth is anchored at today (today's level is the base) and
 * looks back at most 150 days, so a long history never starts below 80% of
 * today's volume (the fixed costs stay covered every month).
 */

export const STUDIO_BASE = { GUL: 12, UTT: 8 } as const

/** By isoWeekday (0 = Sunday ... 5 = Friday, 6 = Saturday). */
export const WEEKDAY_FACTOR: Record<number, number> = { 0: 0.9, 1: 0.85, 2: 0.85, 3: 0.9, 4: 1.05, 5: 1.35, 6: 1.25 }

export function growthFactor(w: World, day: ISODate): number {
  const back = Math.round((Date.parse(w.cal.today) - Date.parse(day)) / 86_400_000)
  return Math.pow(1.0015, -Math.min(150, Math.max(0, back)))
}
