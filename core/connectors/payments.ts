import { sha256Hex } from "@/core/audit/chain"
import { rules } from "@/config/rules.config"
import type { Poisha } from "@/core/db/schema"

/**
 * Simulated payment connectors (plan §3.17): card terminal, bKash and Nagad
 * push payments, and merchant settlements. The UI runs the simulated approval
 * BEFORE the commit (the card approves, or the customer approves the push on
 * their phone, or it times out after rules.mfsPendingTimeoutMin); the
 * commands then record the outcome. Every surface shows the Simulated badge.
 */

export type MfsKind = "bkash" | "nagad"

/** A deterministic authorisation code for a simulated card approval. */
export function cardAuthCode(seed: string): string {
  return sha256Hex(`card:${seed}`).slice(0, 6).toUpperCase()
}

/** Card numbers ending in 0002 decline (for demoing a declined card); all others approve. */
export function cardApproves(last4: string): boolean {
  return last4 !== "0002"
}

/** A bKash/Nagad push request reference ("BK8F3A21C9"). */
export function mfsRequestRef(kind: MfsKind, seed: string): string {
  return `${kind === "bkash" ? "BK" : "NG"}${sha256Hex(`mfs:${kind}:${seed}`).slice(0, 8).toUpperCase()}`
}

/** Merchant fee of a settlement (demo rates: card 1.5%, bKash 1.0%, Nagad 0.9%). */
export function merchantFeeP(kind: "card" | MfsKind, grossP: Poisha): Poisha {
  const pct = rules.merchantFeesPct[kind]
  return Math.round((grossP * pct) / 100)
}

/** How long a pending MFS receipt waits before it times out (demo minutes). */
export const MFS_TIMEOUT_MIN = rules.mfsPendingTimeoutMin
