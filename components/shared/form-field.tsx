"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/** A labelled form field (label above, hint or error below). */
export function Field({
  label,
  hint,
  error,
  group = false,
  children,
  className,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  /** A group of controls (pills, checkboxes): a labelled group instead of a <label> */
  group?: boolean
  children: React.ReactNode
  className?: string
}) {
  const id = React.useId()
  const foot = error ? (
    <span className="text-xs text-destructive">{error}</span>
  ) : hint ? (
    <span className="text-xs text-muted-foreground">{hint}</span>
  ) : null
  if (group) {
    return (
      <div
        role="group"
        aria-labelledby={id}
        className={cn("flex min-w-0 flex-col gap-1.5", className)}
      >
        <span id={id} className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        {children}
        {foot}
      </div>
    )
  }
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {foot}
    </label>
  )
}
