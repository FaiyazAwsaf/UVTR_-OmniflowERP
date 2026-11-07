"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Landmark } from "lucide-react"

import { DateField } from "@/components/shared/date-field"
import { DocLink } from "@/components/shared/doc-link"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { addDaysISO } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { Id } from "@/core/db/schema"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import {
  CsvButton,
  Field,
  ListTable,
  Stat,
  useToday,
  type Column,
} from "@/modules/par/components/kit"

import { canSeeAccount } from "../lib"
import { accountBook, type BookRow } from "../queries"

/** /cab/accounts/[id]: the cash or bank book of one account with its running balance (plan §9). */
export function AccountBookView({ accountId }: { accountId: Id }) {
  const db = useDb()
  const today = useToday()
  const { t, tk, locale, dmy, num, narration } = useLocale()
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const start = from || (today ? addDaysISO(today, -30) : "")
  const end = to || today
  const { can, loading } = usePermissions()
  const data = useLiveQuery(async () => {
    const account = await db.cashBankAccounts.get(accountId)
    // Another location's till or petty cash (or a Head Office bank) is not this user's to read.
    if (!account || (!loading && !canSeeAccount(can, account))) return null
    if (!start) return undefined
    const book = await accountBook(db, account, start, end)
    return { account, book }
  }, [db, accountId, start, end, can, loading])

  if (data === undefined || loading) return null
  if (data === null)
    return (
      <EmptyState
        icon={Landmark}
        title={t("cab.book.notFound")}
        action={{ label: t("cab.pages.home"), href: "/cab" }}
      />
    )
  const { account, book } = data
  const rows = [...book.rows].reverse()

  const columns: Column<BookRow>[] = [
    {
      key: "date",
      header: t("cab.book.colDate"),
      cell: (r) => <span className="nums">{dmy(r.line.date)}</span>,
    },
    {
      key: "ref",
      header: t("cab.book.colRef"),
      cell: (r) =>
        r.journal?.source && r.journal.source.docType !== "journals" ? (
          <DocLink
            docType={r.journal.source.docType}
            docId={r.journal.source.docId}
            docNo={r.journal.source.docNo}
          />
        ) : (
          <span lang="en" className="font-mono">
            {r.ref}
          </span>
        ),
    },
    {
      key: "narration",
      header: t("cab.book.colNarration"),
      hide: "lg",
      cell: (r) => (
        <span className="line-clamp-1 text-muted-foreground">
          {narration(r.journal?.narration ?? "")}
        </span>
      ),
    },
    {
      key: "voucher",
      header: t("cab.book.colVoucher"),
      hide: "md",
      cell: (r) =>
        r.journal ? (
          <DocLink
            docType="journals"
            docId={r.journal.id}
            docNo={r.journal.journalNo}
            showApp={false}
          />
        ) : null,
    },
    {
      key: "in",
      header: t("cab.book.colReceived"),
      align: "right",
      cell: (r) =>
        r.receivedP ? (
          <MoneyText poisha={r.receivedP} className="font-mono text-success" />
        ) : (
          ""
        ),
    },
    {
      key: "out",
      header: t("cab.book.colPaid"),
      align: "right",
      cell: (r) =>
        r.paidP ? <MoneyText poisha={r.paidP} className="font-mono" /> : "",
    },
    {
      key: "bal",
      header: t("cab.book.colBalance"),
      align: "right",
      hide: "sm",
      cell: (r) => (
        <MoneyText
          poisha={r.runningP}
          className={cn("font-mono", r.runningP < 0 && "text-destructive")}
        />
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4" data-testid="account-book">
      <PageHeader
        title={nameOf(account, locale)}
        subtitle={`${tk(`reports.enum.cashKind.${account.kind}`)} · ${t("cab.book.subtitle")}`}
        actions={
          <CsvButton
            exportKey="cab.export"
            fileName={`book-${account.code}`}
            rows={book.rows.map((r) => ({
              date: r.line.date,
              reference: r.ref,
              voucher: r.journal?.journalNo ?? "",
              receivedP: r.receivedP,
              paidP: r.paidP,
              runningP: r.runningP,
            }))}
            columns={[
              { key: "date", label: t("cab.book.colDate") },
              { key: "reference", label: t("cab.book.colRef") },
              { key: "voucher", label: t("cab.book.colVoucher") },
              { key: "receivedP", label: t("cab.book.colReceived") },
              { key: "paidP", label: t("cab.book.colPaid") },
              { key: "runningP", label: t("cab.book.colBalance") },
            ]}
          />
        }
      />
      <section className="surface-card flex flex-wrap items-end gap-x-6 gap-y-3 p-4">
        <Field label={t("cab.book.from")} className="w-40">
          <DateField value={start} onChange={setFrom} max={end || undefined} />
        </Field>
        <Field label={t("cab.book.to")} className="w-40">
          <DateField value={end} onChange={setTo} max={today || undefined} />
        </Field>
        <Stat
          label={t("cab.book.opening")}
          value={<MoneyText poisha={book.openingP} />}
        />
        <Stat
          label={t("cab.book.closing")}
          value={<MoneyText poisha={book.closingP} />}
          tone="info"
          testId="book-closing"
        />
        <span className="ml-auto text-xs text-muted-foreground">
          {t("cab.book.count", { count: num(book.rows.length) })}
        </span>
      </section>
      <section className="surface-card p-4 md:p-5">
        <ListTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.line.id}
          rowTestId="book-row"
          dense
          pageSize={40}
        />
      </section>
    </div>
  )
}
