"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Plus, Save, Send, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { DateField } from "@/components/shared/date-field"
import { MoneyInput } from "@/components/shared/money-input"
import { MoneyText } from "@/components/shared/money-text"
import { PageHeader } from "@/components/shared/page-header"
import { AccountPicker, PartyPicker } from "@/components/shared/pickers"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Id, JournalRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan, useLimit } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"

import { discardJournal, saveJournal, submitJournal } from "../commands"
import { useCostCentres, useToday } from "../queries"
import { MANUAL_VOUCHER_TYPES, type ManualVoucherType } from "../types"
import { BalanceCheck, Field } from "./common"

type EditorLine = {
  key: string
  account: Id | null
  partyId: Id | null
  costCentreId: Id | null
  description: string
  debitP: number | null
  creditP: number | null
}

let lineSeq = 0
const blankLine = (): EditorLine => ({
  key: `l${++lineSeq}`,
  account: null,
  partyId: null,
  costCentreId: null,
  description: "",
  debitP: null,
  creditP: null,
})

const freshKey = () => `fa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * JV entry (plan §9 `/fa/journals/new`, and a draft's own page): voucher
 * type, date, narration and lines with account (never a control account),
 * party, cost centre, debit and credit; a live "Balanced ✓"; save draft,
 * submit (posts within the preparer's journal limit, else waits for an
 * approver) and discard.
 */
export function JournalEditor({ journal }: { journal?: JournalRow }) {
  const { t, money, locale } = useLocale()
  const router = useRouter()
  const today = useToday()
  const canCreate = useCan("fa.journal.create")
  const limit = useLimit("journal")
  const centres = useCostCentres()
  const save = useCommand(saveJournal)
  const submit = useCommand(submitJournal)
  const discard = useCommand(discardJournal)

  const [voucherType, setVoucherType] = React.useState<ManualVoucherType>(
    (journal?.voucherType as ManualVoucherType | undefined) ?? "JV"
  )
  const [date, setDate] = React.useState(journal?.date ?? "")
  const [narration, setNarration] = React.useState(journal?.narration ?? "")
  const [lines, setLines] = React.useState<EditorLine[]>(() =>
    journal?.draftLines?.length
      ? journal.draftLines.map((l) => ({
          key: `l${++lineSeq}`,
          account: l.account,
          partyId: l.partyId ?? null,
          costCentreId: l.costCentreId ?? null,
          description: l.description ?? "",
          debitP: l.debitP || null,
          creditP: l.creditP || null,
        }))
      : [blankLine(), blankLine()]
  )
  const [dirty, setDirty] = React.useState(!journal)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)
  const busy = save.pending || submit.pending || discard.pending

  // The date starts at today on the demo clock (it is 1970 until the clock is read).
  const effectiveDate = date || (today > "2000" ? today : "")

  const debitP = lines.reduce((s, l) => s + (l.debitP ?? 0), 0)
  const creditP = lines.reduce((s, l) => s + (l.creditP ?? 0), 0)
  const filled = lines.filter((l) => l.account && ((l.debitP ?? 0) > 0 || (l.creditP ?? 0) > 0))
  const ready = filled.length >= 2 && !!narration.trim() && !!effectiveDate

  const update = (key: string, patch: Partial<EditorLine>) => {
    setDirty(true)
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  const payload = () => ({
    voucherType,
    date: effectiveDate,
    narration: narration.trim(),
    lines: filled.map((l) => ({
      account: l.account!,
      debitP: l.debitP ?? 0,
      creditP: l.creditP ?? 0,
      partyId: l.partyId ?? undefined,
      costCentreId: l.costCentreId ?? undefined,
      description: l.description.trim() || undefined,
    })),
  })

  const doSave = async (): Promise<{ journalId: string; journalNo: string; version: number } | undefined> => {
    if (!ready) {
      toast.error(t("fa.editor.needLines"))
      return undefined
    }
    const result = await save.run({
      ...payload(),
      journalId: journal?.id,
      expectedVersion: journal?.version,
    })
    if (result) setDirty(false)
    return result
  }

  const onSave = async () => {
    const result = await doSave()
    if (!result) return
    toast.success(t("fa.editor.saved", { no: result.journalNo }))
    if (!journal) router.replace(`/fa/journals/${result.journalId}`)
  }

  const onSubmit = async () => {
    let target: { journalId: string; version: number } | undefined =
      journal && !dirty ? { journalId: journal.id, version: journal.version } : undefined
    if (!target) {
      const saved = await doSave()
      if (!saved) return
      target = saved
    }
    const result = await submit.run({ journalId: target.journalId, expectedVersion: target.version, idempotencyKey: freshKey() })
    if (!result) {
      if (!journal) router.replace(`/fa/journals/${target.journalId}`)
      return
    }
    toast.success(
      result.status === "posted"
        ? t("fa.editor.posted", { no: result.journalNo })
        : t("fa.editor.submitted", { no: result.journalNo })
    )
    router.replace(`/fa/journals/${target.journalId}`)
  }

  const onDiscard = async () => {
    if (!journal) return
    const result = await discard.run({ journalId: journal.id, expectedVersion: journal.version })
    setConfirmDiscard(false)
    if (result) toast.success(t("fa.editor.discarded", { no: result.journalNo }))
  }

  const limitText =
    limit === Infinity
      ? t("fa.editor.unlimited")
      : limit > 0
        ? t("fa.editor.limitHint", { limit: money(limit) })
        : t("fa.editor.noLimit")

  return (
    <div className="flex flex-col gap-5" data-testid="journal-editor">
      <PageHeader
        title={journal ? t("fa.editor.titleEdit", { no: journal.journalNo }) : t("fa.editor.titleNew")}
        subtitle={t("fa.editor.subtitle")}
        actions={
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/fa/journals" />}>
            <ArrowLeft />
            {t("fa.editor.back")}
          </Button>
        }
      />

      <section className="surface-card @container flex flex-col gap-4 p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-3 @[34rem]:grid-cols-2 @[56rem]:grid-cols-[14rem_10rem_1fr]">
          <Field label={t("fa.editor.voucherType")}>
            <Select
              value={voucherType}
              onValueChange={(v) => {
                if (!v) return
                setVoucherType(v as ManualVoucherType)
                setDirty(true)
              }}
            >
              <SelectTrigger data-testid="journal-type" className="w-full">
                <SelectValue>{() => t(`fa.voucherTypes.${voucherType}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MANUAL_VOUCHER_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`fa.voucherTypes.${type}`)}
                    <span lang="en" className="ml-auto pl-3 font-mono text-xs text-muted-foreground">
                      {type}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("fa.editor.date")}>
            <DateField
              value={effectiveDate}
              onChange={(iso) => {
                setDate(iso)
                setDirty(true)
              }}
              data-testid="journal-date"
            />
          </Field>
          <Field label={t("fa.editor.narration")} className="@[34rem]:col-span-2 @[56rem]:col-span-1">
            <Input
              value={narration}
              placeholder={t("fa.editor.narrationPlaceholder")}
              maxLength={300}
              onChange={(e) => {
                setNarration(e.target.value)
                setDirty(true)
              }}
              data-testid="journal-narration"
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="journal-limit">
          {limitText}
        </p>
      </section>

      <section className="surface-card @container flex flex-col gap-3 p-4 sm:p-6" data-testid="journal-lines-editor">
        <h2 className="text-[1.0625rem] font-semibold">{t("fa.editor.lines")}</h2>
        <div className="hidden gap-2 rounded-md bg-surface-raised px-3 py-2 text-xs font-medium @[56rem]:grid @[56rem]:grid-cols-[minmax(13rem,2fr)_minmax(10rem,1.4fr)_9.5rem_9rem_9rem_2.25rem]">
          <span>{t("fa.common.account")}</span>
          <span>{t("fa.editor.partyOptional")}</span>
          <span>{t("fa.common.costCentre")}</span>
          <span className="text-right">{t("fa.common.debit")}</span>
          <span className="text-right">{t("fa.common.credit")}</span>
          <span />
        </div>
        <ul className="flex flex-col gap-2">
          {lines.map((line) => (
            <li
              key={line.key}
              data-testid="journal-line"
              className="grid grid-cols-2 gap-2 rounded-md border border-hairline p-2 @[56rem]:grid-cols-[minmax(13rem,2fr)_minmax(10rem,1.4fr)_9.5rem_9rem_9rem_2.25rem] @[56rem]:border-0 @[56rem]:p-0"
            >
              <div className="col-span-2 @[56rem]:col-span-1">
                <AccountPicker
                  value={line.account}
                  onChange={(id) => update(line.key, { account: id })}
                  excludeControl
                  testId="journal-line-account"
                />
              </div>
              <PartyPicker
                value={line.partyId}
                onChange={(id) => update(line.key, { partyId: id })}
                kind="all"
                testId="journal-line-party"
              />
              <Select
                value={line.costCentreId ?? "none"}
                onValueChange={(v) => update(line.key, { costCentreId: !v || v === "none" ? null : (v as string) })}
              >
                <SelectTrigger className="w-full" data-testid="journal-line-cc" aria-label={t("fa.common.costCentre")}>
                  <SelectValue>
                    {() => {
                      const c = centres?.find((x) => x.id === line.costCentreId)
                      return c ? (
                        <span lang="en" className="font-mono">
                          {c.code}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t("fa.editor.noCostCentre")}</span>
                      )
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("fa.editor.noCostCentre")}</SelectItem>
                  {(centres ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span lang="en" className="font-mono">
                        {c.code}
                      </span>
                      <span className="ml-2 text-muted-foreground">{nameOf(c, locale)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <MoneyInput
                valueP={line.debitP}
                onChange={(v) => update(line.key, { debitP: v, creditP: v ? null : line.creditP })}
                aria-label={t("fa.common.debit")}
                data-testid="journal-line-debit"
              />
              <MoneyInput
                valueP={line.creditP}
                onChange={(v) => update(line.key, { creditP: v, debitP: v ? null : line.debitP })}
                aria-label={t("fa.common.credit")}
                data-testid="journal-line-credit"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="self-center justify-self-end text-muted-foreground hover:text-destructive"
                aria-label={t("fa.editor.removeLine")}
                disabled={lines.length <= 2}
                onClick={() => {
                  setDirty(true)
                  setLines((prev) => prev.filter((l) => l.key !== line.key))
                }}
              >
                <X />
              </Button>
              <Input
                value={line.description}
                placeholder={t("fa.editor.description")}
                maxLength={200}
                className="col-span-2 h-8 text-xs @[56rem]:col-span-6"
                onChange={(e) => update(line.key, { description: e.target.value })}
              />
            </li>
          ))}
        </ul>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDirty(true)
              setLines((prev) => [...prev, blankLine()])
            }}
            disabled={lines.length >= 40}
            data-testid="journal-add-line"
          >
            <Plus />
            {t("fa.editor.addLine")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md bg-surface-raised px-3 py-2.5 text-sm">
          <BalanceCheck debitP={debitP} creditP={creditP} testId="journal-balance" />
          <span className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground">{t("fa.common.debit")}</span>
            <MoneyText poisha={debitP} className="font-mono font-semibold" />
          </span>
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">{t("fa.common.credit")}</span>
            <MoneyText poisha={creditP} className="font-mono font-semibold" />
          </span>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onSubmit} disabled={!canCreate || busy || !ready || debitP !== creditP} data-testid="journal-submit">
          <Send />
          {limit >= debitP && debitP > 0 ? t("fa.editor.submitPost") : t("fa.editor.submit")}
        </Button>
        <Button variant="outline" onClick={onSave} disabled={!canCreate || busy || !ready} data-testid="journal-save">
          <Save />
          {t("fa.editor.saveDraft")}
        </Button>
        {journal ? (
          <Button
            variant="destructive-outline"
            onClick={() => setConfirmDiscard(true)}
            disabled={busy}
            data-testid="journal-discard"
            className="ml-auto"
          >
            <Trash2 />
            {t("fa.editor.discard")}
          </Button>
        ) : null}
        {!canCreate ? <span className="text-xs text-muted-foreground">{t("fa.editor.noPermission")}</span> : null}
      </div>

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent data-testid="journal-discard-dialog">
          <DialogHeader>
            <DialogTitle>{t("fa.editor.discardTitle", { no: journal?.journalNo ?? "" })}</DialogTitle>
            <DialogDescription>{t("fa.editor.discardBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="neutral" onClick={() => setConfirmDiscard(false)}>
              {t("fa.common.cancel")}
            </Button>
            <Button variant="destructive" onClick={onDiscard} disabled={discard.pending} data-testid="journal-discard-confirm">
              <Trash2 />
              {t("fa.editor.discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
