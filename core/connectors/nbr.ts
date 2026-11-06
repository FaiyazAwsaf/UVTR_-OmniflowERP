import { sha256Hex } from "@/core/audit/chain"

/**
 * Simulated NBR connectors (plan §3.17): e-VAT return submission and the
 * treasury challan for tax deposits. Deterministic references, shown with
 * the Simulated badge; nothing leaves the browser.
 */

const digits = (seed: string, n: number) => {
  const hex = sha256Hex(seed).slice(0, 12)
  return String(parseInt(hex, 16) % 10 ** n).padStart(n, "0")
}

/** "NBR-EVAT-202610-418273" for the October 2026 return. */
export function evatSubmissionRef(month: string, salt: string = ""): string {
  return `NBR-EVAT-${month.replace("-", "")}-${digits(`evat:${month}:${salt}`, 6)}`
}

/** "TC-VAT-202610-55120934" for a treasury challan. */
export function treasuryChallanRef(kind: "vat" | "vds" | "ait", month: string, salt: string = ""): string {
  return `TC-${kind.toUpperCase()}-${month.replace("-", "")}-${digits(`challan:${kind}:${month}:${salt}`, 8)}`
}
