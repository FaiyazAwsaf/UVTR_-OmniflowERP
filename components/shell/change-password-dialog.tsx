"use client"

import * as React from "react"
import { KeyRound } from "lucide-react"
import { toast } from "sonner"

import { ruleMessage } from "@/components/shared/rule-message"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDb } from "@/core/db/DbProvider"
import { commit } from "@/core/engine/commit"
import { RuleViolation } from "@/core/engine/errors"
import { feedbackFor, useEngineFeedback } from "@/core/engine/feedback"
import { changePassword } from "@/core/security/signin"
import { useActor } from "@/core/session/actor"
import { useLocale } from "@/lib/i18n/provider"

/**
 * "Change password" from the user menu (plan §3.9: any signed-in user, the
 * `sac.changePassword` command). The policy's rules are the command's; its
 * refusals (wrong current password, policy) show inline in the dialog.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="change-password-dialog">
        {/* The popup unmounts when closed, so the form starts empty each time. */}
        <PasswordForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const { t, tk, num, money, dmy, locale } = useLocale()
  const db = useDb()
  const actor = useActor()
  const show = useEngineFeedback((state) => state.show)
  const [current, setCurrent] = React.useState("")
  const [next, setNext] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (next !== confirm) {
      setError(t("shell.password.mismatch"))
      return
    }
    if (!actor) {
      show({ kind: "no-user", command: changePassword.name })
      return
    }
    setError(null)
    setBusy(true)
    try {
      await commit(changePassword, { current, next }, { db, actor })
      toast.success(t("shell.password.changed"))
      onDone()
    } catch (caught) {
      if (caught instanceof RuleViolation) {
        setError(ruleMessage(caught.code, caught.params, { locale, tk, num, money, dmy }, changePassword.name))
      } else {
        show(feedbackFor(caught, changePassword.name))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          {t("shell.changePassword")}
        </DialogTitle>
        <DialogDescription>{t("shell.password.hint")}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pw-current">{t("shell.password.current")}</Label>
        <Input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          data-testid="password-current"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pw-next">{t("shell.password.next")}</Label>
        <Input
          id="pw-next"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          data-testid="password-next"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pw-confirm">{t("shell.password.confirm")}</Label>
        <Input
          id="pw-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          data-testid="password-confirm"
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="password-error">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={busy || !current || !next || !confirm} data-testid="password-submit">
          {busy ? t("common.saving") : t("shell.password.submit")}
        </Button>
      </DialogFooter>
    </form>
  )
}
