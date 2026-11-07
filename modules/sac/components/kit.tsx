"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/*
 * Small building blocks shared by the CSC screens (IRT, SAC, RBAC): a list
 * table with per-row test ids and container-query column hiding, a filter
 * select, a confirm dialog with an optional reason, and a labelled field.
 */

export type ListColumn<T> = {
  id: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  align?: "right" | "center"
  /** Hide the column when the table is narrower than this (960x600 keeps the essentials) */
  hideBelow?: "sm" | "md" | "lg" | "xl"
  className?: string
}

const HIDE: Record<NonNullable<ListColumn<unknown>["hideBelow"]>, string> = {
  sm: "hidden @min-[32rem]/list:table-cell",
  md: "hidden @min-[42rem]/list:table-cell",
  lg: "hidden @min-[52rem]/list:table-cell",
  xl: "hidden @min-[64rem]/list:table-cell",
}

/**
 * The guideline table (ui_guidelines.md §4 "Table"): raised header band,
 * hairline rows, turquoise tint on hover; ids and money in mono, figures
 * right-aligned. Each row can carry its own data attributes for tests.
 */
export function ListTable<T>({
  rows,
  columns,
  rowKey,
  rowProps,
  rowClassName,
  onRowClick,
  empty,
  pageSize = 50,
  dense = false,
  className,
  testId,
}: {
  rows: T[] | undefined
  columns: ListColumn<T>[]
  rowKey: (row: T) => string
  rowProps?: (row: T) => Record<string, string | undefined>
  rowClassName?: (row: T) => string | undefined
  onRowClick?: (row: T) => void
  empty?: React.ReactNode
  pageSize?: number
  dense?: boolean
  className?: string
  testId?: string
}) {
  const { t, num } = useLocale()
  const [page, setPage] = React.useState(0)
  const list = rows ?? []
  const pages = Math.max(1, Math.ceil(list.length / pageSize))
  const current = Math.min(page, pages - 1)
  const shown = list.slice(current * pageSize, (current + 1) * pageSize)
  const height = dense ? "h-9" : "h-11"

  return (
    <div className={cn("@container/list flex min-w-0 flex-col", className)} data-testid={testId}>
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className={cn(
                    "bg-surface-raised px-3 text-left font-medium whitespace-nowrap first:rounded-l-md last:rounded-r-md",
                    height,
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                    col.hideBelow && HIDE[col.hideBelow]
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr
                key={rowKey(row)}
                {...(rowProps?.(row) ?? {})}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "transition-colors hover:bg-primary-soft",
                  onRowClick && "cursor-pointer",
                  rowClassName?.(row)
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn(
                      "border-b border-hairline px-3 align-middle",
                      height,
                      col.align === "right" && "nums text-right tabular-nums",
                      col.align === "center" && "text-center",
                      col.hideBelow && HIDE[col.hideBelow],
                      col.className
                    )}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows === undefined ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : list.length === 0 ? (
        (empty ?? <p className="py-8 text-center text-sm text-muted-foreground">{t("common.noResults")}</p>)
      ) : null}
      {pages > 1 ? (
        <div className="flex h-11 items-center gap-2 pt-3">
          <span className="nums text-xs text-muted-foreground">
            {num(current * pageSize + 1)}
            {" - "}
            {num(Math.min((current + 1) * pageSize, list.length))} {t("common.of")} {num(list.length)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
              aria-label={t("common.previous")}
            >
              <ChevronLeft />
            </Button>
            <span className="nums px-1.5 text-xs text-muted-foreground">
              {num(current + 1)} / {num(pages)}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
              aria-label={t("common.next")}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export type Option = { value: string; label: React.ReactNode }

/** An outlined select for filters and small forms. */
export function OptionSelect({
  value,
  onChange,
  options,
  label,
  testId,
  className,
  disabled,
  size = "default",
}: {
  value: string
  onChange: (value: string) => void
  options: Option[]
  label: string
  testId?: string
  className?: string
  disabled?: boolean
  size?: "sm" | "default"
}) {
  const current = options.find((o) => o.value === value)
  return (
    <Select value={value} onValueChange={(next) => next !== null && onChange(String(next))} disabled={disabled}>
      <SelectTrigger className={cn("min-w-32", className)} aria-label={label} data-testid={testId} size={size}>
        <SelectValue>{() => current?.label ?? label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A label above a control, with an optional hint or error. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * A confirmation with an optional reason (recorded on the audit row). The
 * confirm button is destructive for disabling, ending sessions and similar.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  withReason = false,
  reasonRequired = false,
  pending = false,
  onConfirm,
  testId,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel: React.ReactNode
  destructive?: boolean
  withReason?: boolean
  reasonRequired?: boolean
  pending?: boolean
  onConfirm: (reason: string) => void | Promise<void>
  testId?: string
  children?: React.ReactNode
}) {
  const { t } = useLocale()
  const [reason, setReason] = React.useState("")
  const [wasOpen, setWasOpen] = React.useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setReason("")
  }
  const blocked = reasonRequired && !reason.trim()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={testId}>
        <DialogHeader>
          <DialogTitle className="text-[1.0625rem] font-semibold">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        {withReason ? (
          <Field label={t("common.reason")}>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              data-testid="confirm-reason"
            />
          </Field>
        ) : null}
        <DialogFooter>
          <Button variant="neutral" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending || blocked}
            onClick={() => void onConfirm(reason.trim())}
            data-testid="confirm-ok"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** An identifier in mono, always Latin (usernames, keys, codes). */
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span lang="en" translate="no" className={cn("font-mono text-[0.75rem] tracking-tight", className)}>
      {children}
    </span>
  )
}
