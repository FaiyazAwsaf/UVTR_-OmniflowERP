import type { ApprovalRow, Id } from "@/core/db/schema"
import type { Tx } from "@/core/engine/types"

/**
 * A module's handler for one document type (plan §3.7). `approvals.decide`
 * runs it in the same commit as the decision: `onApproved` posts the document
 * (and its journal) exactly as the maker's command would have within limit;
 * `onRejected` marks it rejected and releases anything it reserved.
 */
export type ApprovalHandler = {
  onApproved: (tx: Tx, docId: Id, approval: ApprovalRow) => Promise<void>
  onRejected: (tx: Tx, docId: Id, approval: ApprovalRow) => Promise<void>
}

/** docType (the document's table name) to its handler. */
export type ApprovalHandlerMap = Record<string, ApprovalHandler>
