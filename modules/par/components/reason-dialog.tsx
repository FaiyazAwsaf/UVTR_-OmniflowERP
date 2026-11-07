"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useLocale } from "@/lib/i18n/provider"

import { Field } from "./kit"

/** A confirm dialog with an optional (or required) reason: holds, releases, bounces. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  requireReason = true,
  destructive = false,
  pending = false,
  onConfirm,
  testId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  body?: React.ReactNode
  confirmLabel: React.ReactNode
  requireReason?: boolean
  destructive?: boolean
  pending?: boolean
  onConfirm: (reason: string) => void | Promise<void>
  testId?: string
}) {
  const { t } = useLocale()
  const [reason, setReason] = React.useState("")
  const ok = !requireReason || reason.trim().length >= 3
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("")
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid={testId}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!ok) return
            await onConfirm(reason.trim())
            setReason("")
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {body ? <DialogDescription>{body}</DialogDescription> : null}
          </DialogHeader>
          <Field label={t("common.reason")}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} data-testid="reason-input" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="neutral" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={!ok || pending} data-testid="reason-confirm">
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
