"use client"

import * as React from "react"
import { Check, Copy, KeyRound } from "lucide-react"

import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useLocale } from "@/lib/i18n/provider"

/**
 * The one-time temporary password (plan §6.2 sac.resetPassword): shown once
 * to the administrator, never stored in clear; the user must change it at
 * the next sign-in. Delivery is simulated.
 */
export function TempPasswordDialog({
  value,
  onClose,
}: {
  value: { name: string; password: string } | null
  onClose: () => void
}) {
  const { t } = useLocale()
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value.password)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Dialog
      open={!!value}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false)
          onClose()
        }
      }}
    >
      <DialogContent data-testid="temp-password-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[1.0625rem] font-semibold">
            <KeyRound className="size-4 text-primary" />
            {value ? t("sac.temp.title", { name: value.name }) : null}
          </DialogTitle>
          <DialogDescription>{t("sac.temp.body")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md bg-surface-raised p-3">
          <code
            lang="en"
            data-testid="temp-password"
            className="min-w-0 flex-1 truncate font-mono text-xl font-semibold tracking-wider select-all"
          >
            {value?.password}
          </code>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? t("sac.temp.copied") : t("sac.temp.copy")}
          </Button>
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <SimulatedBadge label={t("sac.temp.delivery")} />
          <Button
            onClick={() => {
              setCopied(false)
              onClose()
            }}
            data-testid="temp-password-done"
          >
            {t("sac.temp.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
