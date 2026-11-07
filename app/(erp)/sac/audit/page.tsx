import * as React from "react"

import { AuditViewer } from "@/modules/sac/components/audit/audit-viewer"

/** /sac/audit: the hash-chained audit trail (plan §3.11, `sac.audit.view`); `?record=` filters, so Suspense. */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <AuditViewer />
    </React.Suspense>
  )
}
