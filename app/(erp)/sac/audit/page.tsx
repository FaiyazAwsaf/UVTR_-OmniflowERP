import { AuditViewer } from "@/modules/sac/components/audit/audit-viewer"

/** /sac/audit: the hash-chained audit trail (plan §3.11, `sac.audit.view`). */
export default function Page() {
  return <AuditViewer />
}
