"use client"

import * as React from "react"

import { ApprovalsInbox } from "@/components/shell/approvals/inbox"

/** "/approvals": the signed-in user's approvals inbox (plan §3.7, §9). */
export default function ApprovalsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      {/* `?focus=<id>` (from the bell) reads the URL, so it sits in Suspense. */}
      <React.Suspense fallback={null}>
        <ApprovalsInbox />
      </React.Suspense>
    </div>
  )
}
