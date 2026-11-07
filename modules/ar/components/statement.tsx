"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Printer, UserX } from "lucide-react"

import { DateField } from "@/components/shared/date-field"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { PrintLayout } from "@/components/shared/print-layout"
import { Button } from "@/components/ui/button"
import { tenant } from "@/config/brand.config"
import { addDaysISO } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { Id } from "@/core/db/schema"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { Field, LinkButton, useToday } from "@/modules/par/components/kit"
import { PrintDialog } from "@/modules/par/components/print-dialog"

import { addToBuckets, BUCKETS, emptyBuckets } from "../lib"
import { accountIdOfTag, arOpenItems, customerAdvances } from "../queries"

/** /ar/statements/[partyId]: the customer statement from the receivables ledger, with its print. */
export function CustomerStatement({ partyId }: { partyId: Id }) {
  const db = useDb()
  const today = useToday()
  const { t, tk, locale, dmy, narration } = useLocale()
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [printing, setPrinting] = React.useState(false)
  const start = from || (today ? `${addDaysISO(today, -90).slice(0, 8)}01` : "")
  const end = to || today

  const data = useLiveQuery(async () => {
    if (!today) return undefined
    const party = await db.parties.get(partyId)
    if (!party) return null
    const arId = await accountIdOfTag(db, "AR_CONTROL")
    const lines = (
      await db.journalLines.where("partyId").equals(partyId).toArray()
    )
      .filter((l) => l.accountId === arId)
      .sort((a, b) =>
        a.date < b.date
          ? -1
          : a.date > b.date
            ? 1
            : a.createdAt - b.createdAt || a.lineNo - b.lineNo
      )
    const journals = new Map(
      (await db.journals.bulkGet([...new Set(lines.map((l) => l.journalId))]))
        .filter(Boolean)
        .map((j) => [j!.id, j!])
    )
    let opening = 0
    let running = 0
    const rows: {
      id: string
      date: string
      docNo: string
      details: string
      debitP: number
      creditP: number
      balanceP: number
    }[] = []
    for (const l of lines) {
      if (start && l.date < start) {
        opening += l.debitP - l.creditP
        continue
      }
      if (end && l.date > end) continue
      if (!rows.length) running = opening
      running += l.debitP - l.creditP
      const j = journals.get(l.journalId)
      rows.push({
        id: l.id,
        date: l.date,
        docNo: j?.source?.docNo || j?.journalNo || "",
        details: narration(j?.narration ?? ""),
        debitP: l.debitP,
        creditP: l.creditP,
        balanceP: running,
      })
    }
    if (!rows.length) running = opening
    const items = await arOpenItems(db, today, partyId)
    const aging = emptyBuckets()
    for (const i of items) addToBuckets(aging, i.bucket, i.openP)
    const advance = (await customerAdvances(db)).get(partyId) ?? 0
    return { party, opening, rows, closing: running, aging, advance }
  }, [db, partyId, today, start, end])

  if (data === undefined) return null
  if (data === null)
    return (
      <EmptyState
        icon={UserX}
        title={t("ar.statement.notFound")}
        action={{ label: t("par.v360.backToList"), href: "/par" }}
      />
    )

  const sheet = (
    <PrintLayout
      title={t("ar.statement.statementOf")}
      docNo={data.party.code}
      meta={`${dmy(start)} - ${dmy(end)}`}
      footer={t("ar.statement.footer", { helpline: tenant.helpline })}
    >
      <div
        className="flex flex-col gap-4 text-[0.8125rem]"
        data-testid="statement-sheet"
      >
        <div className="flex flex-wrap justify-between gap-4">
          <div>
            <div className="font-semibold">{nameOf(data.party, locale)}</div>
            {data.party.addresses[0] ? (
              <div className="text-xs text-[#555]">
                {[
                  data.party.addresses[0].line,
                  data.party.addresses[0].area,
                  data.party.addresses[0].city,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            ) : null}
            {data.party.bin ? (
              <div lang="en" className="text-xs">
                BIN {data.party.bin}
              </div>
            ) : null}
          </div>
          <div className="text-right text-xs">
            <div>
              {t("ar.statement.opening")}:{" "}
              <MoneyText poisha={data.opening} className="font-mono" />
            </div>
            <div className="font-semibold">
              {t("ar.statement.closing")}:{" "}
              <MoneyText poisha={data.closing} className="font-mono" />
            </div>
          </div>
        </div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b-2 border-[#111]">
              <th className="py-1 pr-2 text-left">
                {t("ar.statement.colDate")}
              </th>
              <th className="py-1 pr-2 text-left">
                {t("ar.statement.colDoc")}
              </th>
              <th className="hidden py-1 pr-2 text-left sm:table-cell">
                {t("ar.statement.colDetails")}
              </th>
              <th className="py-1 pr-2 text-right">
                {t("ar.statement.colDebit")}
              </th>
              <th className="py-1 pr-2 text-right">
                {t("ar.statement.colCredit")}
              </th>
              <th className="py-1 text-right">
                {t("ar.statement.colBalance")}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[#e0e0e0]">
              <td className="py-1 pr-2">{dmy(start)}</td>
              <td className="py-1 pr-2" colSpan={4}>
                {t("ar.statement.opening")}
              </td>
              <td className="py-1 text-right">
                <MoneyText poisha={data.opening} className="font-mono" />
              </td>
            </tr>
            {data.rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-[#e0e0e0]"
                data-testid="statement-line"
              >
                <td className="py-1 pr-2 whitespace-nowrap">{dmy(r.date)}</td>
                <td lang="en" className="py-1 pr-2 font-mono whitespace-nowrap">
                  {r.docNo}
                </td>
                <td className="hidden py-1 pr-2 sm:table-cell">{r.details}</td>
                <td className="py-1 pr-2 text-right">
                  {r.debitP ? (
                    <MoneyText poisha={r.debitP} className="font-mono" />
                  ) : (
                    ""
                  )}
                </td>
                <td className="py-1 pr-2 text-right">
                  {r.creditP ? (
                    <MoneyText poisha={r.creditP} className="font-mono" />
                  ) : (
                    ""
                  )}
                </td>
                <td className="py-1 text-right">
                  <MoneyText poisha={r.balanceP} className="font-mono" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#111] font-semibold">
              <td className="py-1 pr-2" colSpan={5}>
                {t("ar.statement.closing")}
              </td>
              <td className="py-1 text-right">
                <MoneyText poisha={data.closing} className="font-mono" />
              </td>
            </tr>
          </tfoot>
        </table>
        <div>
          <div className="mb-1 font-semibold">
            {t("ar.statement.agingTitle")}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
            {BUCKETS.map((b) => (
              <div key={b} className="border border-[#e0e0e0] p-1.5">
                <div className="text-[#555]">
                  {tk(`reports.enum.bucket.${b}`)}
                </div>
                <MoneyText poisha={data.aging[b]} className="font-mono" />
              </div>
            ))}
            <div className="border border-[#111] p-1.5 font-semibold">
              <div>{t("ar.aging.total")}</div>
              <MoneyText poisha={data.aging.total} className="font-mono" />
            </div>
          </div>
          {data.advance ? (
            <div className="mt-2 text-xs">
              {t("ar.statement.advance")}:{" "}
              <MoneyText poisha={data.advance} className="font-mono" />
            </div>
          ) : null}
        </div>
      </div>
    </PrintLayout>
  )

  return (
    <div className="flex flex-col gap-4" data-testid="customer-statement">
      <PageHeader
        title={t("ar.statement.title")}
        subtitle={nameOf(data.party, locale)}
        actions={
          <>
            <LinkButton href={`/par/${partyId}`} variant="neutral" size="sm">
              {t("par.pages.party")}
            </LinkButton>
            <Button
              size="sm"
              onClick={() => setPrinting(true)}
              data-testid="statement-print"
            >
              <Printer />
              {t("ar.statement.print")}
            </Button>
          </>
        }
      />
      <section className="surface-card flex flex-wrap items-end gap-3 p-4">
        <Field label={t("ar.statement.from")} className="w-40">
          <DateField value={start} onChange={setFrom} max={end || undefined} />
        </Field>
        <Field label={t("ar.statement.to")} className="w-40">
          <DateField value={end} onChange={setTo} max={today || undefined} />
        </Field>
      </section>
      {!printing ? (
        <div className="min-w-0 overflow-x-auto rounded-lg">{sheet}</div>
      ) : null}
      <PrintDialog
        open={printing}
        onOpenChange={setPrinting}
        title={t("ar.statement.title")}
        docNo={data.party.code}
      >
        {sheet}
      </PrintDialog>
    </div>
  )
}
