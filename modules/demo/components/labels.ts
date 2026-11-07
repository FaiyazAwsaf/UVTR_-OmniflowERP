import { locations } from "@/config/brand.config"
import type { ActorRef } from "@/core/db/schema"
import { EVENT_CATALOG } from "@/core/events/registry"
import type { EventDef } from "@/core/events/types"
import { findSeedUser, SEED_USERS } from "@/core/security/seed-users"
import type { Locale } from "@/lib/i18n/config"
import { noBreak } from "@/lib/i18n/format"

/**
 * Display helpers shared by the launcher, Demo Wall, event stream, demo panel
 * and audit trail. Every lookup degrades to a readable fallback so a missing
 * key or an unknown id never breaks a screen.
 */

export type Tk = (
  key: string,
  params?: Record<string, string | number>
) => string
export type Num = (value: number) => string

/** A user's name by id, in the active language (static directory, then the id). */
export function userNameById(
  userId: string | undefined,
  locale: Locale,
  tk: Tk
): string {
  if (!userId || userId === "system") return tk("demo.common.system")
  if (userId === "demo-setup") return tk("demo.common.demoSetup")
  const seed = findSeedUser(userId)
  if (seed) return locale === "bn" ? seed.nameBn : seed.nameEn
  return userId
}

/** Name of the actor on an event or audit row, in the active language. */
export function actorName(
  actor: ActorRef | undefined,
  locale: Locale,
  tk: Tk
): string {
  if (!actor) return tk("demo.common.system")
  if (actor.userId === "system") return tk("demo.common.system")
  if (actor.userId === "demo-setup") return tk("demo.common.demoSetup")
  const seed = findSeedUser(actor.userId)
  if (seed) return locale === "bn" ? seed.nameBn : seed.nameEn
  return actor.name || actor.username
}

/** "GUL" for a location id. */
export function locationCode(
  id: string | null | undefined
): string | undefined {
  if (!id) return undefined
  return locations.find((l) => l.id === id)?.code ?? id
}

/** "Gulshan Studio (GUL)", or "All locations" for none. */
export function locationLabel(
  id: string | null | undefined,
  locale: Locale
): string {
  const location = id ? locations.find((l) => l.id === id) : undefined
  if (!location) return locale === "bn" ? "সব অবস্থান" : "All locations"
  return `${location.name[locale]} (${location.code})`
}

const BANGLA_NAME = new Map(SEED_USERS.map((u) => [u.nameEn, u.nameBn]))

/**
 * Event and notice params in the window's language: counts in its digits and
 * a staff member's name (recorded in English when it happened) in Bangla in
 * a Bangla window; ids and document numbers stay Latin.
 */
export function localizeParams(
  params: Record<string, string | number> | undefined,
  num: Num,
  locale: Locale = "en",
  dmy?: (iso: string) => string
): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === "number") out[key] = num(value)
    // A day stored as 2026-11-10 reads DD-MM-YYYY in the window's digits.
    else if (dmy && /^\d{4}-\d{2}-\d{2}$/.test(value))
      out[key] = noBreak(dmy(value))
    // Codes and document numbers (C-000003, INV-GUL-2627-000470) never break at a hyphen.
    else if (/^[A-Z0-9]+(-[A-Z0-9]+)+$/.test(value)) out[key] = noBreak(value)
    else out[key] = locale === "bn" ? (BANGLA_NAME.get(value) ?? value) : value
  }
  return out
}

/**
 * The event's label in the active language. `known` is false when the label
 * key has no translation yet, in which case the raw event type is shown.
 */
export function eventLabel(
  event: {
    type?: string
    summaryKey?: string
    params?: Record<string, string | number>
  },
  tk: Tk,
  num: Num,
  locale: Locale = "en",
  dmy?: (iso: string) => string
): { text: string; known: boolean } {
  const fallback = event.type || "Event"
  const key = event.summaryKey
  if (typeof key !== "string" || !key) return { text: fallback, known: false }
  try {
    const text = tk(key, localizeParams(event.params, num, locale, dmy))
    if (!text || text === key) return { text: fallback, known: false }
    return { text, known: true }
  } catch {
    return { text: fallback, known: false }
  }
}

/** A consumer chip label; falls back to the key's last segment. */
export function consumerLabel(key: string, tk: Tk): string {
  try {
    const text = tk(key)
    if (text && text !== key) return text
  } catch {
    // fall through to the readable fallback
  }
  return key.split(".").pop() ?? key
}

export function eventDef(type: string | undefined): EventDef | undefined {
  return type ? EVENT_CATALOG[type] : undefined
}

export const SEVERITY_TEXT: Record<
  NonNullable<EventDef["severity"]>,
  string
> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  critical: "text-destructive",
}

export const SEVERITY_DOT: Record<NonNullable<EventDef["severity"]>, string> = {
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  critical: "bg-destructive",
}
