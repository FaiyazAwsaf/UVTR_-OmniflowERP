"use client"

import * as React from "react"
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

/**
 * A list table column: header, cell, right-aligned figures, container-width
 * hiding (so 960x600 keeps the essentials) and optional sorting.
 */
export type Column<T> = {
  key: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  align?: "right"
  /** Hide below this container width (960x600 keeps the table readable) */
  hide?: "sm" | "md" | "lg"
  className?: string
  /** Enables sorting on this column */
  sortValue?: (row: T) => string | number
}

const HIDE: Record<"sm" | "md" | "lg", string> = {
  sm: "hidden @min-[30rem]/list:table-cell",
  md: "hidden @min-[42rem]/list:table-cell",
  lg: "hidden @min-[56rem]/list:table-cell",
}

/**
 * The guideline table (ui_guidelines.md §4): raised header band, hairline
 * rows, money right-aligned, status as coloured text. Rows carry a test id
 * and extra data attributes for e2e tests; columns hide by container width.
 */
export function ListTable<T>({
  rows,
  columns,
  rowKey,
  rowTestId,
  rowAttrs,
  onRowClick,
  rowClassName,
  pageSize = 25,
  footer,
  empty,
  dense = false,
  className,
}: {
  rows: T[] | undefined
  columns: Column<T>[]
  rowKey: (row: T) => string
  rowTestId?: string
  rowAttrs?: (row: T) => Record<string, string | number | boolean | undefined>
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string | undefined
  pageSize?: number
  /** Cells of a totals row, keyed by column key */
  footer?: Partial<Record<string, React.ReactNode>>
  empty?: React.ReactNode
  dense?: boolean
  className?: string
}) {
  const { t, num } = useLocale()
  const [sort, setSort] = React.useState<{ key: string; dir: 1 | -1 } | null>(
    null
  )
  const [page, setPage] = React.useState(0)
  const list = React.useMemo(() => {
    const base = rows ?? []
    if (!sort) return base
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return base
    return [...base].sort((a, b) => {
      const x = col.sortValue!(a)
      const y = col.sortValue!(b)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
  }, [rows, sort, columns])
  const pages = Math.max(1, Math.ceil(list.length / pageSize))
  const current = Math.min(page, pages - 1)
  const shown = list.slice(current * pageSize, current * pageSize + pageSize)
  const h = dense ? "h-9" : "h-11"

  return (
    <div
      className={cn("@container/list flex min-w-0 flex-col", className)}
      data-slot="list-table"
    >
      <div className="min-w-0 overflow-x-auto">
        {/* Document numbers, codes and amounts (mono) never wrap mid-identifier. */}
        <table className="w-full border-separate border-spacing-0 text-[0.8125rem] [&_td_.font-mono]:whitespace-nowrap">
          <thead>
            <tr>
              {columns.map((c) => {
                const sorted = sort?.key === c.key ? sort.dir : 0
                return (
                  <th
                    key={c.key}
                    scope="col"
                    onClick={
                      c.sortValue
                        ? () =>
                            setSort((s) =>
                              s?.key === c.key
                                ? s.dir === 1
                                  ? { key: c.key, dir: -1 }
                                  : null
                                : { key: c.key, dir: 1 }
                            )
                        : undefined
                    }
                    className={cn(
                      "bg-surface-raised px-3 font-medium whitespace-nowrap first:rounded-l-md last:rounded-r-md",
                      h,
                      c.align === "right" ? "text-right" : "text-left",
                      c.sortValue &&
                        "cursor-pointer select-none hover:text-link",
                      c.hide && HIDE[c.hide]
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        c.align === "right" && "flex-row-reverse"
                      )}
                    >
                      {c.header}
                      {sorted === 1 ? (
                        <ArrowUp className="size-3.5 text-primary" />
                      ) : sorted === -1 ? (
                        <ArrowDown className="size-3.5 text-primary" />
                      ) : null}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const attrs = rowAttrs?.(row) ?? {}
              const data: Record<string, string> = {}
              for (const [k, v] of Object.entries(attrs))
                if (v !== undefined) data[`data-${k}`] = String(v)
              return (
                <tr
                  key={rowKey(row)}
                  data-testid={rowTestId}
                  {...data}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "transition-colors hover:bg-primary-soft",
                    onRowClick && "cursor-pointer",
                    rowClassName?.(row)
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "border-b border-hairline px-3 align-middle",
                        h,
                        c.align === "right" &&
                          "nums text-right whitespace-nowrap tabular-nums",
                        c.hide && HIDE[c.hide],
                        c.className
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          {footer && shown.length ? (
            <tfoot>
              <tr>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "bg-surface-raised px-3 font-semibold first:rounded-l-md last:rounded-r-md",
                      h,
                      c.align === "right" &&
                        "nums text-right whitespace-nowrap tabular-nums",
                      c.hide && HIDE[c.hide]
                    )}
                  >
                    {footer[c.key] ?? null}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {rows && !list.length
        ? (empty ?? (
            <EmptyState
              icon={<Search />}
              title={t("common.noResults")}
              description={t("common.noResultsHint")}
              size="sm"
            />
          ))
        : null}
      {pages > 1 ? (
        <div className="flex h-11 items-center gap-2 pt-2">
          <span className="nums text-xs text-muted-foreground">
            {num(current * pageSize + 1)} -{" "}
            {num(Math.min((current + 1) * pageSize, list.length))}{" "}
            {t("common.of")} {num(list.length)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("common.previous")}
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              <ChevronLeft />
            </Button>
            <span className="nums px-1 text-xs text-muted-foreground">
              {num(current + 1)} / {num(pages)}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("common.next")}
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
