"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ArrowLeft,
  Check,
  CircleCheck,
  CircleX,
  FilePen,
  Info,
  Lock,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { AmountInWords } from "@/components/shared/amount-in-words"
import { ApprovalChip } from "@/components/shared/approval-chip"
import { DateField } from "@/components/shared/date-field"
import { DateText } from "@/components/shared/date-text"
import { DocLink } from "@/components/shared/doc-link"
import { DocStatus, useStatusLabel } from "@/components/shared/doc-status"
import { EmptyState } from "@/components/shared/empty-state"
import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { SectionCard } from "@/components/shared/section-card"
import { Timeline, type TimelineItem } from "@/components/shared/timeline"
import { VoucherView } from "@/components/shared/voucher-view"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { canDecide } from "@/core/approvals/approvals"
import { decideApproval } from "@/core/approvals/decide"
import { useDb } from "@/core/db/DbProvider"
import type { ApprovalRow, JournalRow, TemplateLine } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { usePermissions } from "@/core/security/useCan"
import { nameOf, useUserMap, userName } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { discardJournal, reverseJournal } from "../commands"
import { useToday } from "../queries"
import { DraftLines } from "./draft-lines"
import { JournalEditor } from "./journal-editor"
import { PaperTable, PrintPreview } from "./print-preview"

const freshKey = () => `fa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Vouchers without a source document (manual) or from a recurring template can be reversed (R26). */
function reversible(journal: JournalRow): boolean {
  return journal.status === "posted" && (!journal.source || journal.source.docType === "recurringJournals")
}

/**
 * A voucher (plan §9 `/fa/journals/[id]`): its header with number, status,
 * date and total; the source document link; the approval chip and, for its
 * maker, "You prepared this"; approve or reject for an eligible approver;
 * reverse with a reason for posted manual and recurring vouchers; the
 * posted lines (VoucherView) or the draft lines; history, audit and print.
 * A draft opens in the editor for its preparer.
 */
export function VoucherPage({ id }: { id: string }) {
  const db = useDb()
  const { t, tk, money, dmy, locale } = useLocale()
  const statusLabel = useStatusLabel()
  const { user, security, can } = usePermissions()
  const users = useUserMap()
  const data = useLiveQuery(async () => {
    const journal = await db.journals.get(id)
    if (!journal) return null
    const approval = journal.approvalId ? await db.approvals.get(journal.approvalId) : undefined
    const approvals = (await db.approvals.where("docId").equals(journal.id).toArray()).sort((a, b) => a.requestedAt - b.requestedAt)
    const period = await db.periods.get(journal.periodId)
    const lines = (await db.journalLines.where("journalId").equals(journal.id).toArray()).sort((a, b) => a.lineNo - b.lineNo)
    const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a]))
    const reversal = journal.reversedById ? await db.journals.get(journal.reversedById) : undefined
    const audit = (await db.audit.where("entityId").equals(journal.id).toArray()).sort((a, b) => a.seq - b.seq)
    return { journal, approval, approvals, period, lines, accounts, reversal, audit }
  }, [db, id])

  const [deciding, setDeciding] = React.useState<"approve" | "reject" | null>(null)
  const [reversing, setReversing] = React.useState(false)
  const [discarding, setDiscarding] = React.useState(false)

  if (data === undefined) return <p className="p-6 text-sm text-muted-foreground">{t("fa.common.loading")}</p>
  if (data === null) {
    return (
      <EmptyState
        icon={FilePen}
        title={t("fa.voucher.notFound")}
        action={{ label: t("fa.editor.back"), href: "/fa/journals" }}
      />
    )
  }

  const { journal, approval, approvals, period, lines, accounts, reversal, audit } = data
  const preparer = users.get(journal.preparedBy)
  const isPreparer = user?.id === journal.preparedBy
  if (journal.status === "draft" && isPreparer && can("fa.journal.create")) {
    return (
      <div className="flex flex-col gap-5">
        {approval?.status === "rejected" ? <RejectedNote approval={approval} /> : null}
        <JournalEditor key={journal.id} journal={journal} />
        <VoucherHistory journal={journal} approvals={approvals} reversalNo={reversal?.journalNo} />
      </div>
    )
  }

  const pending = journal.status === "pending-approval" && approval?.status === "pending"
  const mayDecide =
    pending && !!approval && !!user && !!security && user.id !== approval.requestedBy && canDecide(security, user.locationIds, approval)
  const routedNames = (approval?.routedTo ?? []).map((u) => userName(users.get(u), locale)).filter(Boolean).join(", ")
  const closed = period?.status === "closed"
  const printLines: { code: string; name: string; debitP: number; creditP: number; note?: string }[] =
    journal.status === "posted" || journal.status === "reversed"
      ? lines.map((l) => ({
          code: accounts.get(l.accountId)?.code ?? "",
          name: nameOf(accounts.get(l.accountId), locale),
          debitP: l.debitP,
          creditP: l.creditP,
          note: l.description,
        }))
      : (journal.draftLines ?? []).map((l: TemplateLine) => ({
          code: accounts.get(l.account)?.code ?? "",
          name: nameOf(accounts.get(l.account), locale),
          debitP: l.debitP,
          creditP: l.creditP,
          note: l.description,
        }))

  return (
    <div className="flex flex-col gap-5" data-testid="voucher-page" data-journal-no={journal.journalNo} data-status={journal.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/fa/journals" className="mb-1 inline-flex items-center gap-1 text-xs text-link hover:underline">
            <ArrowLeft className="size-3.5" />
            {t("fa.editor.back")}
          </Link>
          <h1 lang="en" className="truncate font-mono text-[1.375rem] leading-tight font-semibold">
            {journal.journalNo}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tk(`fa.voucherTypes.${journal.voucherType}`)} · {journal.narration}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">{t("fa.voucher.header.total")}</div>
          <MoneyText poisha={journal.totalP} className="font-mono text-[1.5rem] font-semibold" />
        </div>
      </div>

      {closed ? (
        <div className="flex items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--info)_14%,transparent)] px-3 py-2 text-sm text-info" data-testid="period-closed-banner">
          <Lock className="size-4" />
          {t("fa.voucher.closedBanner", { period: period?.code ?? "" })}
        </div>
      ) : null}

      <section className="surface-card flex flex-col gap-4 p-4 sm:p-6">
        <KeyValueGrid
          columns={4}
          items={[
            { label: t("fa.common.status"), value: <DocStatus status={journal.status} /> },
            { label: t("fa.voucher.header.date"), value: dmy(journal.date) },
            { label: t("fa.voucher.header.period"), value: period?.code ?? "", mono: true },
            { label: t("fa.voucher.header.rule"), value: journal.rule, mono: true },
            { label: t("fa.common.preparedBy"), value: userName(preparer, locale) },
            {
              label: t("fa.common.postedBy"),
              value: journal.postedBy ? userName(users.get(journal.postedBy), locale) : "-",
            },
            {
              label: t("fa.voucher.source"),
              value:
                journal.source && journal.source.docType !== "journals" ? (
                  <DocLink docType={journal.source.docType} docId={journal.source.docId} docNo={journal.source.docNo} />
                ) : (
                  t("fa.common.manual")
                ),
            },
            {
              label: t("fa.voucher.approval"),
              value: journal.approvalId ? <ApprovalChip approvalId={journal.approvalId} /> : "-",
            },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4" data-testid="voucher-actions">
          {mayDecide ? (
            <>
              <Button onClick={() => setDeciding("approve")} data-testid="voucher-approve">
                <Check />
                {t("fa.voucher.approve")}
              </Button>
              <Button variant="destructive-outline" onClick={() => setDeciding("reject")} data-testid="voucher-reject">
                <X />
                {t("fa.voucher.reject")}
              </Button>
            </>
          ) : null}
          {pending && isPreparer ? (
            <span
              data-testid="voucher-approve-hint"
              className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklch,var(--warning)_18%,transparent)] px-3 py-1.5 text-xs font-medium text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning"
            >
              <Info className="size-3.5" />
              {t("fa.voucher.youPrepared")}
            </span>
          ) : pending && !mayDecide ? (
            <span className="text-xs text-muted-foreground" data-testid="voucher-waiting">
              {t("fa.voucher.waitingFor", { names: routedNames || "-" })}
            </span>
          ) : null}
          {(journal.status === "pending-approval" || journal.status === "draft") && can("fa.journal.create") ? (
            <Button variant="destructive-outline" onClick={() => setDiscarding(true)} data-testid="journal-discard">
              <Trash2 />
              {t("fa.editor.discard")}
            </Button>
          ) : null}
          {reversible(journal) && can("fa.journal.reverse") ? (
            <Button variant="destructive-outline" onClick={() => setReversing(true)} data-testid="journal-reverse">
              <RotateCcw />
              {t("fa.voucher.reverse")}
            </Button>
          ) : null}
          {journal.status === "posted" && journal.source && journal.source.docType !== "recurringJournals" && journal.source.docType !== "journals" ? (
            <span className="text-xs text-muted-foreground">{t("fa.voucher.cantReverseSource")}</span>
          ) : null}
          <div className="ml-auto">
            <PrintPreview
              title={t("fa.voucher.printTitle")}
              docNo={journal.journalNo}
              meta={
                <>
                  <div>{dmy(journal.date)}</div>
                  <div>{tk(`fa.voucherTypes.${journal.voucherType}`)}</div>
                </>
              }
              testId="voucher-print"
            >
              <p className="mb-3 text-[0.8125rem]">{journal.narration}</p>
              <PaperTable
                head={[t("fa.common.account"), t("fa.common.debit"), t("fa.common.credit")]}
                align={["l", "r", "r"]}
                rows={printLines.map((l) => [
                  <span key="a">
                    <span lang="en" className="font-mono">
                      {l.code}
                    </span>{" "}
                    {l.name}
                    {l.note ? <span className="block text-[0.6875rem] text-[#555]">{l.note}</span> : null}
                  </span>,
                  l.debitP ? money(l.debitP) : "",
                  l.creditP ? money(l.creditP) : "",
                ])}
                foot={[
                  t("fa.common.total"),
                  money(printLines.reduce((s, l) => s + l.debitP, 0)),
                  money(printLines.reduce((s, l) => s + l.creditP, 0)),
                ]}
              />
              <p className="mt-3 text-[0.75rem] italic">
                <AmountInWords poisha={journal.totalP} />
              </p>
              <div className="mt-12 grid grid-cols-3 gap-6 text-center text-[0.6875rem]">
                {[
                  [t("fa.voucher.printPrepared"), userName(preparer, locale)],
                  [t("fa.voucher.printApproved"), approval?.status === "approved" ? userName(users.get(approval.decidedBy ?? ""), locale) : ""],
                  [t("fa.voucher.printPosted"), journal.postedBy ? userName(users.get(journal.postedBy), locale) : ""],
                ].map(([label, name]) => (
                  <div key={label} className="border-t border-[#111] pt-1">
                    <div className="font-semibold">{name || " "}</div>
                    <div>{label}</div>
                  </div>
                ))}
              </div>
            </PrintPreview>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="surface-card min-w-0 p-4 sm:p-6">
          {journal.status === "posted" || journal.status === "reversed" ? (
            <VoucherView journalId={journal.id} />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <DocStatus status={journal.status} />
                <span className="text-muted-foreground">{t("fa.voucher.draftLines")}</span>
              </div>
              <DraftLines lines={journal.draftLines ?? []} />
            </div>
          )}
        </section>
        <div className="flex flex-col gap-5">
          <VoucherHistory journal={journal} approvals={approvals} reversalNo={reversal?.journalNo} />
          {audit.length ? (
            <SectionCard title={t("fa.voucher.audit")} size="sm">
              <ul className="flex flex-col gap-2 text-xs" data-testid="voucher-audit">
                {audit.slice(-8).map((row) => (
                  <li key={row.seq} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="font-medium">{tk(`fa.voucher.auditAction.${row.action}`)}</span>{" "}
                      <span className="text-muted-foreground">
                        {userName(users.get(row.actor.userId), locale) || row.actor.name}
                        {row.after && "status" in row.after ? ` · ${statusLabel(String(row.after.status))}` : ""}
                        {row.reason ? ` · ${row.reason}` : ""}
                      </span>
                    </span>
                    <DateText value={row.at} variant="dmyTime" className="shrink-0 text-muted-foreground" />
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </div>
      </div>

      <DecideDialog journal={journal} approval={approval} decision={deciding} onClose={() => setDeciding(null)} preparerName={userName(preparer, locale)} />
      <ReverseDialog journal={journal} open={reversing} onClose={() => setReversing(false)} />
      <DiscardDialog journal={journal} open={discarding} onClose={() => setDiscarding(false)} />
    </div>
  )
}

function RejectedNote({ approval }: { approval: ApprovalRow }) {
  const { t, locale } = useLocale()
  const users = useUserMap()
  return (
    <div className="flex items-start gap-2 rounded-md bg-[color-mix(in_oklch,var(--destructive)_12%,transparent)] px-3 py-2 text-sm text-destructive">
      <CircleX className="mt-0.5 size-4 shrink-0" />
      <span>
        {t("fa.voucher.timeline.rejected", { name: userName(users.get(approval.decidedBy ?? ""), locale) })}
        {approval.decisionReason ? `: ${approval.decisionReason}` : ""}
      </span>
    </div>
  )
}

/** The voucher's life: prepared, submitted, decided, posted, reversed or discarded. */
function VoucherHistory({
  journal,
  approvals,
  reversalNo,
}: {
  journal: JournalRow
  approvals: ApprovalRow[]
  reversalNo?: string
}) {
  const { t, locale } = useLocale()
  const users = useUserMap()
  const name = (id?: string) => userName(users.get(id ?? ""), locale)
  const items: TimelineItem[] = [
    { id: "created", title: t("fa.voucher.timeline.created", { name: name(journal.preparedBy) }), at: journal.createdAt, icon: FilePen, tone: "muted" },
  ]
  for (const a of approvals) {
    items.push({
      id: `${a.id}-req`,
      title: t("fa.voucher.timeline.submitted", { name: name(a.requestedBy) }),
      description: a.reason || undefined,
      at: a.requestedAt,
      icon: Send,
      tone: "warning",
    })
    if (a.status === "approved" || a.status === "rejected") {
      items.push({
        id: `${a.id}-dec`,
        title: t(a.status === "approved" ? "fa.voucher.timeline.approved" : "fa.voucher.timeline.rejected", { name: name(a.decidedBy) }),
        description: a.decisionReason || undefined,
        at: a.decidedAt,
        icon: a.status === "approved" ? CircleCheck : CircleX,
        tone: a.status === "approved" ? "success" : "destructive",
      })
    } else if (a.status === "cancelled") {
      items.push({ id: `${a.id}-cxl`, title: t("fa.voucher.timeline.cancelled"), at: a.decidedAt, icon: Undo2, tone: "muted" })
    }
  }
  if (journal.postedAt) {
    items.push({ id: "posted", title: t("fa.voucher.timeline.posted", { name: name(journal.postedBy) }), at: journal.postedAt, icon: Check, tone: "success" })
  }
  if (journal.status === "reversed" && reversalNo) {
    items.push({ id: "reversed", title: t("fa.voucher.timeline.reversed", { no: reversalNo }), at: journal.updatedAt, icon: RotateCcw, tone: "muted" })
  }
  if (journal.status === "discarded") {
    items.push({ id: "discarded", title: t("fa.voucher.timeline.discarded"), at: journal.updatedAt, icon: Trash2, tone: "muted" })
  }
  items.sort((a, b) => Number(a.at ?? 0) - Number(b.at ?? 0))
  return (
    <SectionCard title={t("fa.voucher.timeline.title")} size="sm">
      <Timeline items={items} />
    </SectionCard>
  )
}

function DecideDialog({
  journal,
  approval,
  decision,
  preparerName,
  onClose,
}: {
  journal: JournalRow
  approval: ApprovalRow | undefined
  decision: "approve" | "reject" | null
  preparerName: string
  onClose: () => void
}) {
  const { t, dmy } = useLocale()
  const command = useCommand(decideApproval)
  const [reason, setReason] = React.useState("")
  const approve = decision === "approve"
  const run = async () => {
    if (!approval || !decision) return
    const result = await command.run({ approvalId: approval.id, decision, reason: reason.trim(), expectedVersion: approval.version })
    onClose()
    setReason("")
    if (result) toast.success(t(approve ? "fa.voucher.approved" : "fa.voucher.rejected", { no: journal.journalNo }))
  }
  return (
    <Dialog open={!!decision} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="voucher-decide-dialog">
        <DialogHeader>
          <DialogTitle>{t(approve ? "fa.voucher.approveTitle" : "fa.voucher.rejectTitle", { no: journal.journalNo })}</DialogTitle>
          <DialogDescription>
            {approve ? t("fa.voucher.approveBody", { date: dmy(journal.date), name: preparerName }) : t("fa.voucher.rejectBody")}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("fa.common.reasonPlaceholder")}
          data-testid="voucher-decide-reason"
        />
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("fa.common.cancel")}
          </Button>
          <Button
            variant={approve ? "default" : "destructive"}
            onClick={run}
            disabled={command.pending || (!approve && !reason.trim())}
            data-testid="voucher-decide-confirm"
          >
            {approve ? <Check /> : <X />}
            {t(approve ? "fa.voucher.approve" : "fa.voucher.reject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReverseDialog({ journal, open, onClose }: { journal: JournalRow; open: boolean; onClose: () => void }) {
  const { t } = useLocale()
  const today = useToday()
  const command = useCommand(reverseJournal)
  const [reason, setReason] = React.useState("")
  const [date, setDate] = React.useState("")
  const run = async () => {
    const result = await command.run({
      journalId: journal.id,
      expectedVersion: journal.version,
      date: date || today,
      reason: reason.trim(),
      idempotencyKey: freshKey(),
    })
    onClose()
    setReason("")
    if (result) toast.success(t("fa.voucher.reversed", { no: result.journalNo }))
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="journal-reverse-dialog">
        <DialogHeader>
          <DialogTitle>{t("fa.voucher.reverseTitle", { no: journal.journalNo })}</DialogTitle>
          <DialogDescription>{t("fa.voucher.reverseBody")}</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{t("fa.voucher.reverseDate")}</span>
          <DateField value={date || today} onChange={setDate} data-testid="journal-reverse-date" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{t("fa.common.reason")}</span>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("fa.common.reasonPlaceholder")}
            data-testid="journal-reverse-reason"
          />
        </label>
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("fa.common.cancel")}
          </Button>
          <Button variant="destructive" onClick={run} disabled={command.pending || reason.trim().length < 3} data-testid="journal-reverse-confirm">
            <RotateCcw />
            {t("fa.voucher.reverse")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DiscardDialog({ journal, open, onClose }: { journal: JournalRow; open: boolean; onClose: () => void }) {
  const { t } = useLocale()
  const command = useCommand(discardJournal)
  const [reason, setReason] = React.useState("")
  const run = async () => {
    const result = await command.run({ journalId: journal.id, expectedVersion: journal.version, reason: reason.trim() || undefined })
    onClose()
    if (result) toast.success(t("fa.editor.discarded", { no: result.journalNo }))
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="journal-discard-dialog">
        <DialogHeader>
          <DialogTitle>{t("fa.editor.discardTitle", { no: journal.journalNo })}</DialogTitle>
          <DialogDescription>{t("fa.editor.discardBody")}</DialogDescription>
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("fa.common.reasonPlaceholder")} />
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("fa.common.cancel")}
          </Button>
          <Button variant="destructive" onClick={run} disabled={command.pending} data-testid="journal-discard-confirm">
            <Trash2 />
            {t("fa.editor.discard")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
