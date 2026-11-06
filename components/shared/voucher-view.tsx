"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Check } from "lucide-react"

import { DocLink } from "@/components/shared/doc-link"
import { DocStatus } from "@/components/shared/doc-status"
import { MoneyText } from "@/components/shared/money-text"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useDb } from "@/core/db/DbProvider"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

/**
 * A posted voucher (ui_guidelines.md §4 "Voucher lines"): account (code mono
 * + name), party or item, cost centre, debit and credit right-aligned mono,
 * a footer with totals and "Balanced ✓", the source document and reversal
 * links. Live: a reversal in another window shows at once.
 */
export function VoucherView({ journalId, className }: { journalId: string; className?: string }) {
  const db = useDb()
  const { t, locale, dmy } = useLocale()
  const data = useLiveQuery(async () => {
    const journal = await db.journals.get(journalId)
    if (!journal) return null
    const lines = (await db.journalLines.where("journalId").equals(journalId).toArray()).sort((a, b) => a.lineNo - b.lineNo)
    const accounts = new Map((await db.accounts.bulkGet([...new Set(lines.map((l) => l.accountId))])).filter(Boolean).map((a) => [a!.id, a!]))
    const parties = new Map(
      (await db.parties.bulkGet([...new Set(lines.flatMap((l) => (l.partyId ? [l.partyId] : [])))])).filter(Boolean).map((p) => [p!.id, p!])
    )
    const items = new Map(
      (await db.items.bulkGet([...new Set(lines.flatMap((l) => (l.itemId ? [l.itemId] : [])))])).filter(Boolean).map((i) => [i!.id, i!])
    )
    const centres = new Map((await db.costCentres.toArray()).map((c) => [c.id, c]))
    const reversal = journal.reversedById ? await db.journals.get(journal.reversedById) : undefined
    const original = journal.reversalOfId ? await db.journals.get(journal.reversalOfId) : undefined
    return { journal, lines, accounts, parties, items, centres, reversal, original }
  }, [db, journalId])

  if (data === undefined) return null
  if (data === null) return <p className="text-sm text-muted-foreground">{t("shared.voucher.notFound")}</p>
  const { journal, lines, accounts, parties, items, centres, reversal, original } = data
  const debit = lines.reduce((s, l) => s + l.debitP, 0)
  const credit = lines.reduce((s, l) => s + l.creditP, 0)

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="voucher-view" data-journal-no={journal.journalNo}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span lang="en" className="font-mono text-base font-semibold">
          {journal.journalNo}
        </span>
        <DocStatus status={journal.status} />
        <span className="text-muted-foreground">{dmy(journal.date)}</span>
        {journal.source && journal.source.docType !== "journals" ? (
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{t("shared.voucher.source")}</span>
            <DocLink docType={journal.source.docType} docId={journal.source.docId} docNo={journal.source.docNo} />
          </span>
        ) : null}
        {original ? (
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{t("shared.voucher.reversalOf")}</span>
            <DocLink docType="journals" docId={original.id} docNo={original.journalNo} />
          </span>
        ) : null}
        {reversal ? (
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{t("shared.voucher.reversedBy")}</span>
            <DocLink docType="journals" docId={reversal.id} docNo={reversal.journalNo} />
          </span>
        ) : null}
      </div>
      {journal.narration ? <p className="text-sm text-muted-foreground">{journal.narration}</p> : null}
      <div className="@container overflow-x-auto rounded-md">
        <Table className="text-[0.8125rem]">
          <TableHeader className="bg-surface-raised [&_tr]:border-0">
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("shared.voucher.account")}</TableHead>
              <TableHead className="hidden @[40rem]:table-cell">{t("shared.voucher.partyItem")}</TableHead>
              <TableHead className="hidden @[52rem]:table-cell">{t("shared.voucher.costCentre")}</TableHead>
              <TableHead className="text-right">{t("shared.voucher.debit")}</TableHead>
              <TableHead className="text-right">{t("shared.voucher.credit")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => {
              const account = accounts.get(l.accountId)
              const party = l.partyId ? parties.get(l.partyId) : undefined
              const item = l.itemId ? items.get(l.itemId) : undefined
              return (
                <TableRow key={l.id} className="h-9 border-hairline">
                  <TableCell>
                    <span lang="en" className="font-mono text-muted-foreground">
                      {account?.code}
                    </span>{" "}
                    {nameOf(account, locale)}
                  </TableCell>
                  <TableCell className="hidden @[40rem]:table-cell">
                    {party ? nameOf(party, locale) : item ? <span lang="en" className="font-mono">{item.sku}</span> : null}
                  </TableCell>
                  <TableCell className="hidden @[52rem]:table-cell">
                    {l.costCentreId ? <span lang="en" className="font-mono">{centres.get(l.costCentreId)?.code}</span> : null}
                  </TableCell>
                  <TableCell className="text-right font-mono">{l.debitP ? <MoneyText poisha={l.debitP} /> : null}</TableCell>
                  <TableCell className="text-right font-mono">{l.creditP ? <MoneyText poisha={l.creditP} /> : null}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
          <TableFooter className="bg-surface-raised font-semibold">
            <TableRow>
              <TableCell>
                {debit === credit ? (
                  <span className="inline-flex items-center gap-1 text-success" data-testid="voucher-balanced">
                    {t("shared.voucher.balanced")} <Check className="size-4" />
                  </span>
                ) : (
                  <span className="text-destructive">
                    {t("shared.voucher.difference", { amount: String(debit - credit) })}
                  </span>
                )}
              </TableCell>
              <TableCell className="hidden @[40rem]:table-cell" />
              <TableCell className="hidden @[52rem]:table-cell" />
              <TableCell className="text-right font-mono">
                <MoneyText poisha={debit} />
              </TableCell>
              <TableCell className="text-right font-mono">
                <MoneyText poisha={credit} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  )
}
