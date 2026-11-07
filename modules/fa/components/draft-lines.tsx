"use client"

import { useLiveQuery } from "dexie-react-hooks"

import { MoneyText } from "@/components/shared/money-text"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useDb } from "@/core/db/DbProvider"
import type { TemplateLine } from "@/core/db/schema"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { BalanceCheck } from "./common"

/**
 * The lines of a draft or pending manual voucher (kept on the voucher until
 * it posts), laid out like VoucherView: account, party, cost centre, debit,
 * credit and the balance check.
 */
export function DraftLines({ lines }: { lines: TemplateLine[] }) {
  const db = useDb()
  const { t, locale } = useLocale()
  const data = useLiveQuery(async () => {
    const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a]))
    const byTag = new Map((await db.accounts.toArray()).flatMap((a) => (a.tag ? [[a.tag as string, a] as const] : [])))
    const parties = new Map(
      (await db.parties.bulkGet([...new Set(lines.flatMap((l) => (l.partyId ? [l.partyId] : [])))]))
        .filter(Boolean)
        .map((p) => [p!.id, p!])
    )
    const centres = new Map((await db.costCentres.toArray()).map((c) => [c.id, c]))
    return { accounts, byTag, parties, centres }
  }, [db, lines])
  const debit = lines.reduce((s, l) => s + l.debitP, 0)
  const credit = lines.reduce((s, l) => s + l.creditP, 0)
  return (
    <div className="@container overflow-x-auto rounded-md" data-testid="draft-lines">
      <Table className="text-[0.8125rem]">
        <TableHeader className="bg-surface-raised [&_tr]:border-0">
          <TableRow className="hover:bg-transparent">
            <TableHead>{t("fa.common.account")}</TableHead>
            <TableHead className="hidden @[40rem]:table-cell">{t("fa.common.party")}</TableHead>
            <TableHead className="hidden @[52rem]:table-cell">{t("fa.common.costCentre")}</TableHead>
            <TableHead className="text-right">{t("fa.common.debit")}</TableHead>
            <TableHead className="text-right">{t("fa.common.credit")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l, i) => {
            const account = data?.accounts.get(l.account) ?? data?.byTag.get(l.account)
            return (
              <TableRow key={i} className="h-9 border-hairline" data-testid="draft-line">
                <TableCell>
                  <span lang="en" className="font-mono text-muted-foreground">
                    {account?.code}
                  </span>{" "}
                  {nameOf(account, locale)}
                  {l.description ? <span className="block text-xs text-muted-foreground">{l.description}</span> : null}
                </TableCell>
                <TableCell className="hidden @[40rem]:table-cell">{l.partyId ? nameOf(data?.parties.get(l.partyId), locale) : null}</TableCell>
                <TableCell className="hidden @[52rem]:table-cell">
                  {l.costCentreId ? (
                    <span lang="en" className="font-mono">
                      {data?.centres.get(l.costCentreId)?.code}
                    </span>
                  ) : null}
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
              <BalanceCheck debitP={debit} creditP={credit} />
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
  )
}
