"use client"

import * as React from "react"
import { CreditCard, Loader2, Smartphone } from "lucide-react"

import { MoneyText } from "@/components/shared/money-text"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cardApproves, cardAuthCode, MFS_TIMEOUT_MIN, mfsRequestRef } from "@/core/connectors/payments"
import { newId } from "@/core/db/ids"
import { useLocale } from "@/lib/i18n/provider"

export type SimMethod = "card" | "bkash" | "nagad"

export type SimRequest = {
  method: SimMethod
  amountP: number
  /** The customer's wallet number for a push (MFS) */
  phone?: string
  /**
   * After the customer approves: the caller commits (deposit) or confirms
   * a pending receipt (counter). Resolves true when it worked.
   */
  onApproved: (ref: string) => Promise<boolean>
}

/**
 * The simulated card terminal and bKash/Nagad push (plan §3.17). The card
 * approves unless it ends in 0002; the push waits until the presenter clicks
 * "Customer approved" (or it times out after the demo minutes in the rules).
 * Every surface carries the Simulated badge.
 */
export function PaymentSimDialog({ request, onClose }: { request: SimRequest | null; onClose: () => void }) {
  const { t } = useLocale()
  const [last4, setLast4] = React.useState("4242")
  const [busy, setBusy] = React.useState(false)
  const [declined, setDeclined] = React.useState(false)
  const seed = React.useMemo(() => newId("pay"), [request])
  const mfs = request?.method === "bkash" || request?.method === "nagad"
  const brand = request?.method === "bkash" ? "bKash" : request?.method === "nagad" ? "Nagad" : t("si.tender.card")

  const approve = async () => {
    if (!request) return
    if (request.method === "card" && !cardApproves(last4)) {
      setDeclined(true)
      return
    }
    setBusy(true)
    const ref = request.method === "card" ? cardAuthCode(seed) : mfsRequestRef(request.method, seed)
    const ok = await request.onApproved(ref)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog
      open={!!request}
      onOpenChange={(open) => {
        if (!open && !busy) {
          setDeclined(false)
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="payment-sim">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="icon-well flex size-10 shrink-0 items-center justify-center text-link">
              {mfs ? <Smartphone className="size-5" /> : <CreditCard className="size-5" />}
            </span>
            <DialogTitle className="mr-auto">{mfs ? t("si.sim.pushTitle", { brand }) : t("si.sim.cardTitle")}</DialogTitle>
            <SimulatedBadge />
          </div>
          <DialogDescription>
            {mfs ? t("si.sim.pushBody", { brand, phone: request?.phone ?? "", minutes: MFS_TIMEOUT_MIN }) : t("si.sim.cardBody")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between rounded-md bg-surface-raised px-4 py-3">
          <span className="text-sm text-muted-foreground">{t("common.amount")}</span>
          <span className="font-mono text-lg font-semibold">
            <MoneyText poisha={request?.amountP ?? 0} />
          </span>
        </div>
        {request?.method === "card" ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{t("si.sim.cardLast4")}</span>
            <Input
              value={last4}
              inputMode="numeric"
              maxLength={4}
              data-testid="card-last4"
              onChange={(e) => {
                setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))
                setDeclined(false)
              }}
              className="w-28 font-mono tracking-[0.3em]"
            />
            <span className="text-xs text-muted-foreground">{t("si.sim.cardHint")}</span>
          </label>
        ) : (
          <div className="flex items-center gap-3 rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("si.sim.waiting")}
          </div>
        )}
        {declined ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {t("si.sim.declined")}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="neutral" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={approve} disabled={busy} data-testid={mfs ? "mfs-approve" : "card-approve"}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
            {mfs ? t("si.sim.customerApproved") : t("si.sim.approveCard")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
