"use client"

import { usePendingApprovalCount } from "@/core/approvals/useInbox"

/**
 * Yellow count badges in the sidebar (ui_guidelines.md §3), by href. Phase 0
 * counts the approvals waiting for this user (live, permission-aware);
 * WS-Shell adds the per-app counts (jobs in QC at my studio, bills on hold,
 * items below reorder, PDCs due).
 */
export function useNavCounts(): Record<string, number> {
  return { "/approvals": usePendingApprovalCount() }
}
