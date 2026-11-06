"use client"

import Link from "next/link"

import { AppChip } from "@/components/shared/app-frame"
import { docApp, docHref } from "@/components/shared/doc-routes"
import { usePermissions } from "@/core/security/useCan"
import { cn } from "@/lib/utils"

/**
 * A link to a document with its app code chip (ui_guidelines.md §4: "SI ·
 * INV-GUL-2627-002981"). The number is mono and always Latin. Plain text
 * (no link) when the user cannot open the target app.
 */
export function DocLink({
  docType,
  docId,
  docNo,
  showApp = true,
  className,
}: {
  docType: string
  docId: string
  docNo: string
  showApp?: boolean
  className?: string
}) {
  const { can } = usePermissions()
  const app = docApp(docType)
  const href = docHref(docType, docId)
  const allowed = !app || can(`${app}.app.view`)
  const content = (
    <>
      {showApp && app ? <AppChip app={app} className="text-[0.625rem]" /> : null}
      <span lang="en" className="font-mono">
        {docNo}
      </span>
    </>
  )
  if (!href || !allowed) {
    return <span className={cn("inline-flex items-center gap-1.5", className)}>{content}</span>
  }
  return (
    <Link
      href={href}
      data-testid="doc-link"
      data-doc-type={docType}
      className={cn("inline-flex items-center gap-1.5 text-link hover:underline", className)}
    >
      {content}
    </Link>
  )
}
