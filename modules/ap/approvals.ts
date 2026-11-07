import type { ApprovalHandlerMap } from "@/core/approvals/types"

import { taka } from "@/modules/ar/lib"

import { postBill, postPayment } from "./commands"

/**
 * AP approval handlers by document type (implementation_plan.md §3.7),
 * registered in core/approvals/registry.ts. Each posts exactly as the
 * maker's command would have within limit.
 */
export const apApprovalHandlers: ApprovalHandlerMap = {
  /** A bill held by the three-way match: release posts R13 at the bill price, the difference to PPV. */
  vendorBills: {
    async onApproved(tx, docId, approval) {
      const bill = await tx.get("vendorBills", docId)
      if (bill.status !== "on-hold") tx.reject("BILL_NOT_ON_HOLD", { no: bill.billNo })
      await postBill(tx, bill.id, { approvalId: approval.id, preparedBy: approval.requestedBy })
      tx.emit("BillReleased", {
        refs: { billId: bill.id, partyId: bill.partyId, approvalId: approval.id },
        params: { no: bill.billNo, amount: taka(bill.totalP) },
        locationId: bill.locationId,
      })
    },
    async onRejected(tx, docId) {
      // The bill stays on hold as disputed; its quantities are free to bill again.
      const bill = await tx.get("vendorBills", docId)
      if (bill.status !== "on-hold") tx.reject("BILL_NOT_ON_HOLD", { no: bill.billNo })
    },
  },
  /** A payment above the preparer's limit: approval posts R15, the cheque and the certificates. */
  vendorPayments: {
    async onApproved(tx, docId, approval) {
      await postPayment(tx, docId, { approvalId: approval.id })
    },
    async onRejected(tx, docId) {
      const payment = await tx.get("vendorPayments", docId)
      if (payment.status !== "pending-approval") tx.reject("PAYMENT_NOT_PENDING", { no: payment.paymentNo })
      await tx.update("vendorPayments", payment.id, { status: "rejected" })
    },
  },
}
