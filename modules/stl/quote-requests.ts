import type { QuotationLineRow } from "@/core/db/schema"
import type { LineRequest } from "@/modules/pc/pricing"

/**
 * The line requests a saved quotation was priced from (packages once each,
 * their exploded lines folded back), so a revision re-prices exactly what
 * the customer was quoted.
 */
export function requestsFromLines(lines: Pick<QuotationLineRow, "kind" | "refId" | "packageId" | "qty" | "lineNo">[]): LineRequest[] {
  const seen = new Set<string>()
  const out: LineRequest[] = []
  for (const l of [...lines].sort((a, b) => a.lineNo - b.lineNo)) {
    if (l.packageId) {
      if (!seen.has(l.packageId)) out.push({ kind: "package", packageId: l.packageId })
      seen.add(l.packageId)
    } else if (l.kind === "service") out.push({ kind: "service", serviceId: l.refId })
    else if (l.kind === "add-on") out.push({ kind: "add-on", addOnId: l.refId, qty: l.qty })
    else out.push({ kind: "item", itemId: l.refId, qty: l.qty })
  }
  return out
}
