import type { DatasetRow } from "./types"

/**
 * CSV export (plan §3.19), built client-side. Money columns (`...P`) are
 * written in taka with two decimals; identifiers stay as stored (Latin).
 * A UTF-8 BOM keeps Bangla readable in spreadsheet apps.
 */
export function toCsv(rows: DatasetRow[], columns: { key: string; label: string }[]): string {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const cell = (key: string, value: DatasetRow[string]) =>
    key.endsWith("P") && typeof value === "number" ? (value / 100).toFixed(2) : value
  const head = columns.map((c) => escape(c.label)).join(",")
  const body = rows.map((row) => columns.map((c) => escape(cell(c.key, row[c.key]))).join(","))
  return `﻿${[head, ...body].join("\r\n")}\r\n`
}

/** Start a browser download of a CSV string. */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
