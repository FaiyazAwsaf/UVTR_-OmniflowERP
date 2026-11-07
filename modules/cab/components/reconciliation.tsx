"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import {
  CheckCircle2,
  FileUp,
  Link2,
  ReceiptText,
  Sparkles,
  Undo2,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { DocStatus } from "@/components/shared/doc-status"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusText } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { addDaysISO } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { BankStatementRow, Id, StatementLine } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { usePermissions } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { accountIdOfTag, glBalanceP } from "@/modules/ar/queries"
import {
  Field,
  NativeSelect,
  Pills,
  Stat,
  useToday,
} from "@/modules/par/components/kit"
import { ReasonDialog } from "@/modules/par/components/reason-dialog"

import {
  autoMatchStatement,
  completeReconciliation,
  explainLine,
  importStatement,
  matchLine,
  postBankCharge,
  unmatchLine,
} from "../commands"
import { canSeeAccount, lastMonthRange, lineSettled } from "../lib"

function monthOptions(today: string, count = 6) {
  const out: { from: string; to: string }[] = []
  let ref = today
  for (let i = 0; i < count; i++) {
    const r = lastMonthRange(ref)
    out.push(r)
    ref = r.from
  }
  return out
}

/** /cab/reconciliation: import, auto-match, manual match, post charges, complete (plan §9, E7). */
export function Reconciliation() {
  const db = useDb()
  const router = useRouter()
  const params = useSearchParams()
  const today = useToday()
  const { t, locale, dmy, num } = useLocale()
  const { can } = usePermissions()
  const canRecon = can("cab.reconcile")
  const importCmd = useCommand(importStatement)
  const autoCmd = useCommand(autoMatchStatement)
  const completeCmd = useCommand(completeReconciliation)
  const chargeCmd = useCommand(postBankCharge)
  const unmatchCmd = useCommand(unmatchLine)
  const explainCmd = useCommand(explainLine)
  const [accountId, setAccountId] = React.useState("cba_brac")
  const months = React.useMemo(
    () => (today ? monthOptions(today) : []),
    [today]
  )
  const [monthFrom, setMonthFrom] = React.useState("")
  const month = months.find((m) => m.from === monthFrom) ?? months[0]
  const [selected, setSelected] = React.useState<Id | null>(params.get("id"))
  const [matching, setMatching] = React.useState<StatementLine | null>(null)
  const [explaining, setExplaining] = React.useState<StatementLine | null>(null)
  const [show, setShow] = React.useState<"all" | "open">("all")

  const data = useLiveQuery(async () => {
    const accounts = (await db.cashBankAccounts.toArray()).filter(
      (a) => a.kind === "bank" && a.active && canSeeAccount(can, a)
    )
    const ids = new Set(accounts.map((a) => a.id))
    const statements = (await db.bankStatements.toArray())
      .filter((s) => ids.has(s.cashBankAccountId))
      .sort((a, b) => b.importedAt - a.importedAt)
    return { accounts, statements }
  }, [db, can])
  const forParam = data?.statements.find((s) => s.id === selected)
  const account =
    data?.accounts.find(
      (a) => a.id === (forParam?.cashBankAccountId ?? accountId)
    ) ?? data?.accounts[0]
  const statements = (data?.statements ?? []).filter(
    (s) => s.cashBankAccountId === account?.id
  )
  const statement: BankStatementRow | undefined =
    forParam ??
    statements.find(
      (s) => month && s.fromDate === month.from && s.status !== "superseded"
    ) ??
    undefined

  const book = useLiveQuery(async () => {
    if (!statement || !account) return undefined
    const balance = await glBalanceP(db, account.accountTag, statement.toDate)
    return { balance }
  }, [db, statement?.id, statement?.version, account?.id])

  const open = statement
    ? statement.lines.filter((l) => !lineSettled(l)).length
    : 0
  const settled = statement ? statement.lines.length - open : 0
  const editable = canRecon && statement?.status === "imported"

  const doImport = async () => {
    if (!account || !month) return
    const r = await importCmd.run({
      cashBankAccountId: account.id,
      fromDate: month.from,
      toDate: month.to,
    })
    if (r) {
      toast.success(t("cab.recon.imported", { count: num(r.lines) }))
      setSelected(r.statementId)
      router.replace(`/cab/reconciliation?id=${r.statementId}`, {
        scroll: false,
      })
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="reconciliation">
      <PageHeader
        title={t("cab.pages.reconciliation")}
        subtitle={t("cab.recon.subtitle")}
      />
      <section className="surface-card flex flex-wrap items-end gap-3 p-4">
        <Field label={t("cab.recon.account")} className="w-64">
          <NativeSelect
            value={account?.id ?? ""}
            onChange={(v) => {
              setAccountId(v)
              setSelected(null)
            }}
            testId="recon-account"
            options={(data?.accounts ?? []).map((a) => ({
              value: a.id,
              label: nameOf(a, locale),
            }))}
          />
        </Field>
        <Field label={t("cab.recon.month")} className="w-48">
          <NativeSelect
            value={month?.from ?? ""}
            onChange={(v) => {
              setMonthFrom(v)
              setSelected(null)
            }}
            testId="recon-month"
            options={months.map((m) => ({
              value: m.from,
              label: `${dmy(m.from).slice(3)}`,
            }))}
          />
        </Field>
        {canRecon ? (
          <Button
            onClick={doImport}
            disabled={!account || !month || importCmd.pending}
            data-testid="recon-import"
          >
            <FileUp />
            {t("cab.recon.import")}
          </Button>
        ) : null}
        <SimulatedBadge />
      </section>

      {statement ? (
        <section
          className="surface-card flex flex-col gap-4 p-4 md:p-5"
          data-testid="recon-statement"
          data-status={statement.status}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 lang="en" className="font-mono text-base font-semibold">
                  {statement.fileName}
                </h2>
                <DocStatus status={statement.status} />
              </div>
              <p className="text-sm text-muted-foreground">
                {dmy(statement.fromDate)} - {dmy(statement.toDate)} ·{" "}
                {t("cab.recon.openLines", { count: num(open) })} ·{" "}
                {t("cab.recon.settled", { count: num(settled) })}
              </p>
            </div>
            {editable ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  data-testid="recon-auto"
                  disabled={autoCmd.pending}
                  onClick={async () => {
                    const r = await autoCmd.run({ statementId: statement.id })
                    if (r)
                      toast.success(
                        t("cab.recon.autoDone", {
                          matched: num(r.matched),
                          open: num(r.open),
                        })
                      )
                  }}
                >
                  <Sparkles />
                  {t("cab.recon.auto")}
                </Button>
                <Button
                  data-testid="recon-complete"
                  disabled={open > 0 || completeCmd.pending}
                  onClick={async () => {
                    const r = await completeCmd.run({
                      statementId: statement.id,
                    })
                    if (r) toast.success(t("cab.recon.completed"))
                  }}
                >
                  <CheckCircle2 />
                  {t("cab.recon.complete")}
                </Button>
              </div>
            ) : statement.status !== "imported" ? (
              <span className="text-sm text-muted-foreground">
                {t("cab.recon.readOnly", {
                  status: t(
                    `shared.status.${statement.status}` as "shared.status.reconciled"
                  ),
                })}
              </span>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-4 rounded-lg bg-surface-raised/50 p-3 sm:grid-cols-4">
            <Stat
              label={t("cab.recon.opening")}
              value={<MoneyText poisha={statement.openingBalanceP} />}
            />
            <Stat
              label={t("cab.recon.statementClosing")}
              value={<MoneyText poisha={statement.closingBalanceP} />}
            />
            <Stat
              label={t("cab.recon.bookBalance", {
                date: dmy(statement.toDate),
              })}
              value={book ? <MoneyText poisha={book.balance} /> : "…"}
            />
            <Stat
              label={t("cab.recon.difference")}
              value={
                book ? (
                  <MoneyText
                    poisha={statement.closingBalanceP - book.balance}
                  />
                ) : (
                  "…"
                )
              }
              tone={
                book && statement.closingBalanceP - book.balance === 0
                  ? "success"
                  : "warning"
              }
              testId="recon-difference"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Pills
              value={show}
              onChange={(v) => setShow(v as "all" | "open")}
              testId="recon-filter"
              options={[
                {
                  value: "all",
                  label: `${t("cab.recon.showAll")} · ${num(statement.lines.length)}`,
                },
                {
                  value: "open",
                  label: `${t("cab.recon.showOpen")} · ${num(open)}`,
                },
              ]}
            />
          </div>
          {show === "open" && open === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              {t("cab.recon.noOpen")}
            </p>
          ) : null}
          <div className="@container/recon min-w-0 overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
              <thead>
                <tr className="[&>th]:h-9 [&>th]:bg-surface-raised [&>th]:px-2 [&>th]:font-medium [&>th]:whitespace-nowrap">
                  <th className="rounded-l-md text-left">
                    {t("cab.recon.colDate")}
                  </th>
                  <th className="hidden text-left @min-[48rem]/recon:table-cell">
                    {t("cab.recon.colDescription")}
                  </th>
                  <th className="text-left">{t("cab.recon.colRef")}</th>
                  <th className="text-right">{t("cab.recon.colAmount")}</th>
                  <th className="text-left">{t("cab.recon.colMatch")}</th>
                  <th className="rounded-r-md" />
                </tr>
              </thead>
              <tbody>
                {statement.lines
                  .filter((l) => show === "all" || !lineSettled(l))
                  .map((l) => {
                    const done = lineSettled(l)
                    return (
                      <tr
                        key={l.lineId}
                        data-testid="recon-line"
                        data-matched={done ? "true" : "false"}
                        data-ref={l.ref}
                        data-amount={l.amountP}
                        className={cn(
                          "[&>td]:border-b [&>td]:border-hairline [&>td]:px-2 [&>td]:py-1.5",
                          !done &&
                            "bg-[color-mix(in_oklch,var(--warning)_7%,transparent)]"
                        )}
                      >
                        <td className="nums whitespace-nowrap">
                          {dmy(l.date)}
                        </td>
                        {/* The bank file's own narration (banks issue statements in English). */}
                        <td
                          lang="en"
                          title={l.description}
                          className="hidden max-w-[22rem] truncate text-muted-foreground @min-[48rem]/recon:table-cell"
                        >
                          {l.description}
                        </td>
                        <td
                          lang="en"
                          className="font-mono text-xs whitespace-nowrap"
                        >
                          {l.ref}
                        </td>
                        <td className="text-right whitespace-nowrap">
                          <MoneyText
                            poisha={l.amountP}
                            className={cn(
                              "font-mono",
                              l.amountP > 0 ? "text-success" : undefined
                            )}
                            signed
                          />
                        </td>
                        <td>
                          {l.note ? (
                            <StatusText tone="info" dot title={l.note}>
                              {t("cab.recon.explained")}
                            </StatusText>
                          ) : done ? (
                            <StatusText tone="success" dot>
                              {l.matchedBy === "charge"
                                ? t("cab.recon.matchedCharge")
                                : l.matchedBy === "manual"
                                  ? t("cab.recon.matchedManual")
                                  : t("cab.recon.matchedAuto")}
                            </StatusText>
                          ) : (
                            <StatusText tone="warning" dot>
                              {t("cab.recon.unmatched")}
                            </StatusText>
                          )}
                        </td>
                        <td>
                          {editable ? (
                            <div className="flex justify-end gap-1">
                              {!done ? (
                                <>
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    onClick={() => setMatching(l)}
                                    data-testid="recon-match"
                                  >
                                    <Link2 />
                                    <span className="hidden @min-[40rem]/recon:inline">
                                      {t("cab.recon.matchHand")}
                                    </span>
                                  </Button>
                                  {l.amountP < 0 ? (
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      data-testid="recon-post-charge"
                                      disabled={chargeCmd.pending}
                                      onClick={async () => {
                                        const r = await chargeCmd.run({
                                          statementId: statement.id,
                                          lineId: l.lineId,
                                        })
                                        if (r)
                                          toast.success(
                                            t("cab.recon.chargePosted")
                                          )
                                      }}
                                    >
                                      <ReceiptText />
                                      <span className="hidden @min-[40rem]/recon:inline">
                                        {t("cab.recon.postCharge")}
                                      </span>
                                    </Button>
                                  ) : null}
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => setExplaining(l)}
                                    data-testid="recon-explain"
                                  >
                                    {t("cab.recon.explain")}
                                  </Button>
                                </>
                              ) : l.matchedBy !== "charge" ? (
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  aria-label={t("cab.recon.unmatch")}
                                  onClick={() =>
                                    unmatchCmd.run({
                                      statementId: statement.id,
                                      lineId: l.lineId,
                                    })
                                  }
                                >
                                  <Undo2 />
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="surface-card p-4">
          <EmptyState
            icon={FileUp}
            title={t("cab.recon.noStatement")}
            size="sm"
          />
        </section>
      )}

      <SectionCard
        title={t("cab.recon.statements")}
        size="sm"
        subtitle={t("cab.recon.superseded")}
      >
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
            <thead>
              <tr className="[&>th]:h-9 [&>th]:bg-surface-raised [&>th]:px-2 [&>th]:font-medium">
                <th className="rounded-l-md text-left">
                  {t("cab.recon.colFile")}
                </th>
                <th className="text-left">{t("cab.recon.colPeriod")}</th>
                <th className="hidden text-right sm:table-cell">
                  {t("cab.recon.colLines")}
                </th>
                <th className="rounded-r-md text-left">
                  {t("cab.recon.colStatus")}
                </th>
              </tr>
            </thead>
            <tbody>
              {statements.slice(0, 12).map((s) => (
                <tr
                  key={s.id}
                  data-testid="recon-statement-row"
                  onClick={() => {
                    setSelected(s.id)
                    router.replace(`/cab/reconciliation?id=${s.id}`, {
                      scroll: false,
                    })
                  }}
                  className={cn(
                    "cursor-pointer hover:bg-primary-soft [&>td]:border-b [&>td]:border-hairline [&>td]:px-2 [&>td]:py-1.5",
                    s.id === statement?.id && "bg-primary-soft"
                  )}
                >
                  <td lang="en" className="font-mono text-xs">
                    {s.fileName}
                  </td>
                  <td className="nums">
                    {dmy(s.fromDate)} - {dmy(s.toDate)}
                  </td>
                  <td className="hidden text-right sm:table-cell">
                    {num(s.lines.length)}
                  </td>
                  <td>
                    <DocStatus status={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {statement && matching && account ? (
        <MatchDialog
          statement={statement}
          line={matching}
          accountTag={account.accountTag}
          onClose={() => setMatching(null)}
        />
      ) : null}
      <ReasonDialog
        open={!!explaining}
        onOpenChange={(o) => !o && setExplaining(null)}
        title={t("cab.recon.explainTitle", {
          ref: explaining?.ref || dmy(explaining?.date ?? today),
        })}
        body={t("cab.recon.explainBody")}
        confirmLabel={t("cab.recon.explain")}
        pending={explainCmd.pending}
        onConfirm={async (note) => {
          if (!statement || !explaining) return
          const r = await explainCmd.run({
            statementId: statement.id,
            lineId: explaining.lineId,
            note,
          })
          if (r) setExplaining(null)
        }}
      />
    </div>
  )
}

function MatchDialog({
  statement,
  line,
  accountTag,
  onClose,
}: {
  statement: BankStatementRow
  line: StatementLine
  accountTag: Parameters<typeof accountIdOfTag>[1]
  onClose: () => void
}) {
  const db = useDb()
  const { t, dmy, money, narration } = useLocale()
  const match = useCommand(matchLine)
  const [picked, setPicked] = React.useState<Set<Id>>(new Set())
  const candidates = useLiveQuery(async () => {
    const glId = await accountIdOfTag(db, accountTag)
    if (!glId) return []
    const from = addDaysISO(line.date, -15)
    const to = addDaysISO(line.date, 15)
    const used = new Set(
      statement.lines.flatMap((l) => l.matchedJournalLineIds)
    )
    const lines = (
      await db.journalLines.where("accountId").equals(glId).toArray()
    ).filter(
      (l) =>
        l.date >= from &&
        l.date <= to &&
        !l.reconciledStatementLineId &&
        !used.has(l.id)
    )
    const journals = new Map(
      (await db.journals.bulkGet([...new Set(lines.map((l) => l.journalId))]))
        .filter(Boolean)
        .map((j) => [j!.id, j!])
    )
    return lines
      .map((l) => ({
        line: l,
        amountP: l.debitP - l.creditP,
        journal: journals.get(l.journalId),
      }))
      .filter((c) => Math.sign(c.amountP) === Math.sign(line.amountP))
      .sort(
        (a, b) =>
          Math.abs(a.amountP - line.amountP) -
          Math.abs(b.amountP - line.amountP)
      )
  }, [db, accountTag, line.lineId])
  const sum = (candidates ?? [])
    .filter((c) => picked.has(c.line.id))
    .reduce((s, c) => s + c.amountP, 0)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl" data-testid="recon-match-dialog">
        <DialogHeader>
          <DialogTitle>
            {t("cab.recon.matchTitle", { ref: line.ref || dmy(line.date) })}
          </DialogTitle>
          <DialogDescription>
            {t("cab.recon.matchBody", { amount: money(line.amountP) })}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto">
          {candidates?.length ? (
            <ul className="flex flex-col">
              {candidates.map((c) => (
                <li key={c.line.id}>
                  <label
                    className="flex cursor-pointer items-center gap-3 border-b border-hairline px-1 py-2 text-[0.8125rem] hover:bg-primary-soft"
                    data-testid="recon-candidate"
                    data-ref={c.journal?.source?.docNo ?? c.journal?.journalNo}
                  >
                    <Checkbox
                      checked={picked.has(c.line.id)}
                      onCheckedChange={(v) =>
                        setPicked((p) => {
                          const n = new Set(p)
                          if (v) n.add(c.line.id)
                          else n.delete(c.line.id)
                          return n
                        })
                      }
                    />
                    <span className="nums w-20 shrink-0">
                      {dmy(c.line.date)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span lang="en" className="font-mono text-xs">
                        {c.journal?.source?.docNo || c.journal?.journalNo}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {narration(c.journal?.narration ?? "")}
                      </span>
                    </span>
                    <MoneyText
                      poisha={c.amountP}
                      className="font-mono"
                      signed
                    />
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">
              {t("cab.recon.noCandidates")}
            </p>
          )}
        </div>
        <p
          className={cn(
            "flex items-center gap-1.5 text-sm",
            sum === line.amountP ? "text-success" : "text-muted-foreground"
          )}
        >
          {sum === line.amountP ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <XCircle className="size-4" />
          )}
          {t("cab.recon.matchSelected", {
            amount: money(sum),
            target: money(line.amountP),
          })}
        </p>
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={sum !== line.amountP || match.pending}
            data-testid="recon-match-save"
            onClick={async () => {
              const r = await match.run({
                statementId: statement.id,
                lineId: line.lineId,
                journalLineIds: [...picked],
              })
              if (r) onClose()
            }}
          >
            {t("cab.recon.matchSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
