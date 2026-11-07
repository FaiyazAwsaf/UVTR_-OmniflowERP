"use client"

import * as React from "react"
import Link from "next/link"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Download, Printer } from "lucide-react"

import { MoneyText } from "@/components/shared/money-text"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { downloadCsv, toCsv } from "@/core/reports/csv"
import type { ReportResult } from "@/core/reports/runner"
import type { DatasetField, DatasetRow } from "@/core/reports/types"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

/** A cell's display text (money, dates DD-MM-YYYY, enums in the window's language). */
export function useCellFormatter() {
  const { tk, num, dmy, money } = useLocale()
  return (field: DatasetField | undefined, value: DatasetRow[string]): string => {
    if (value === null || value === undefined || value === "") return ""
    if (!field) return String(value)
    switch (field.type) {
      case "money":
        return money(Number(value))
      case "number":
        return num(Number(value))
      case "date":
        return /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? dmy(String(value).slice(0, 10)) : String(value)
      case "enum": {
        const key = `${field.enumKeys}.${value}`
        const label = tk(key)
        return label === key ? String(value) : label
      }
      default:
        return String(value)
    }
  }
}

/**
 * The report renderer (plan §3.19): grouped table with totals, an optional
 * bar chart, CSV export and print. Rows may carry `<field>Href` links (the
 * dataset's `linkField`) so every figure drills down to its document.
 */
export function ReportView({
  result,
  title,
  chart,
  canExport = true,
  onPrint,
  className,
}: {
  result: ReportResult
  title: string
  chart?: { x: string; y: string } | null
  canExport?: boolean
  /** Opens the caller's print preview on white paper (no button without it: the screen is never printed as is) */
  onPrint?: () => void
  className?: string
}) {
  const { t, tk } = useLocale()
  const format = useCellFormatter()
  const fields = new Map(result.dataset.fields.map((f) => [f.key, f]))
  const columns = result.columns.filter((c) => fields.has(c))
  const label = (key: string) => tk(fields.get(key)?.labelKey ?? key)

  const exportCsv = () => {
    const csv = toCsv(result.rows, columns.map((key) => ({ key, label: label(key) })))
    downloadCsv(title.replace(/[^\w\-]+/g, "-"), csv)
  }

  const chartData = React.useMemo(() => {
    if (!chart) return null
    const sums = new Map<string, number>()
    for (const row of result.rows) {
      const x = format(fields.get(chart.x), row[chart.x]) || "-"
      sums.set(x, (sums.get(x) ?? 0) + (Number(row[chart.y]) || 0))
    }
    return [...sums.entries()].map(([x, y]) => ({ x, y: fields.get(chart.y)?.type === "money" ? y / 100 : y }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, chart])

  const cell = (row: DatasetRow, key: string) => {
    const field = fields.get(key)
    const text = format(field, row[key])
    const href = field?.linkField ? (row[field.linkField] as string | undefined) : undefined
    if (field?.type === "money") return <MoneyText poisha={Number(row[key]) || 0} />
    if (href) {
      return (
        <Link href={href} className="font-mono text-link hover:underline" lang="en">
          {text}
        </Link>
      )
    }
    return text
  }

  const renderRows = (rows: DatasetRow[]) =>
    rows.map((row, i) => (
      <TableRow key={i} className="h-9 border-hairline" data-testid="report-row">
        {columns.map((key) => (
          <TableCell key={key} className={cn(["money", "number"].includes(fields.get(key)?.type ?? "") && "text-right font-mono")}>
            {cell(row, key)}
          </TableCell>
        ))}
      </TableRow>
    ))

  return (
    <div className={cn("flex flex-col gap-4", className)} data-testid="report-view">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("shared.report.rows", { count: result.rowCount })}</span>
        <div className="ml-auto flex gap-2 print:hidden">
          {canExport ? (
            <Button variant="outline" size="sm" onClick={exportCsv} data-testid="report-csv">
              <Download />
              {t("shared.report.exportCsv")}
            </Button>
          ) : null}
          {onPrint ? (
            <Button variant="neutral" size="sm" onClick={onPrint} data-testid="report-print">
              <Printer />
              {t("shared.report.print")}
            </Button>
          ) : null}
        </div>
      </div>
      {chartData && chartData.length ? (
        <div className="surface-card h-64 p-4" data-testid="report-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" vertical={false} />
              <XAxis dataKey="x" tick={{ fill: "#77727b", fontSize: 11 }} />
              <YAxis tick={{ fill: "#77727b", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "var(--tooltip)", border: 0, borderRadius: 8 }} />
              <Bar dataKey="y" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      {result.rowCount === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("shared.report.noRows")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md">
          <Table className="text-[0.8125rem]">
            <TableHeader className="bg-surface-raised [&_tr]:border-0">
              <TableRow className="hover:bg-transparent">
                {columns.map((key) => (
                  <TableHead key={key} className={cn(["money", "number"].includes(fields.get(key)?.type ?? "") && "text-right")}>
                    {label(key)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.groups
                ? result.groups.map((group, gi) => (
                    <React.Fragment key={gi}>
                      <TableRow className="bg-primary-soft/40 hover:bg-primary-soft/40">
                        <TableCell colSpan={columns.length} className="font-semibold">
                          {Object.entries(group.key)
                            .map(([k, v]) => format(fields.get(k), v))
                            .join(" · ")}{" "}
                          <span className="font-normal text-muted-foreground">({group.count})</span>
                        </TableCell>
                      </TableRow>
                      {renderRows(group.rows)}
                      <TableRow className="border-hairline font-semibold">
                        {columns.map((key) => (
                          <TableCell key={key} className="text-right font-mono">
                            {key in group.totals ? cell({ [key]: group.totals[key] }, key) : null}
                          </TableCell>
                        ))}
                      </TableRow>
                    </React.Fragment>
                  ))
                : renderRows(result.rows)}
            </TableBody>
            <TableFooter className="bg-surface-raised font-semibold">
              <TableRow>
                {columns.map((key, i) => (
                  <TableCell key={key} className={cn(key in result.totals && "text-right font-mono")}>
                    {key in result.totals ? cell({ [key]: result.totals[key] }, key) : i === 0 ? t("shared.report.totals") : null}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  )
}
