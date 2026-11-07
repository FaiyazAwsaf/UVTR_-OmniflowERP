"use client"

import * as React from "react"

import { MoneyInput } from "@/components/shared/money-input"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Switch } from "@/components/ui/switch"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { PaymentSimDialog, type SimRequest } from "@/modules/si/components/payment-sim"

import type { DepositInput } from "../orders"
import { Field } from "./kit"

export type DepositMethod = DepositInput["method"]
export type DepositState = { enabled: boolean; method: DepositMethod; amountP: number | null }

export const NO_DEPOSIT: DepositState = { enabled: false, method: "bkash", amountP: null }

const METHODS: DepositMethod[] = ["cash", "card", "bkash", "nagad"]

/** Booking deposit: on or off, the tender and the amount (R3, held as customer advance). */
export function DepositFields({
  value,
  onChange,
  maxP,
}: {
  value: DepositState
  onChange: (value: DepositState) => void
  maxP: number
}) {
  const { t, tk } = useLocale()
  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface-raised/60 p-3" data-testid="order-deposit">
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{t("stl.deposit.take")}</span>
        <Switch
          checked={value.enabled}
          data-testid="deposit-toggle"
          onCheckedChange={(enabled) =>
            onChange({ ...value, enabled, amountP: value.amountP ?? Math.min(maxP, Math.round(maxP * 0.2 / 100_00) * 100_00 || maxP) })
          }
        />
      </label>
      {value.enabled ? (
        <>
          <div className="flex flex-wrap gap-1" role="radiogroup" data-testid="deposit-method">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={value.method === m}
                data-value={m}
                onClick={() => onChange({ ...value, method: m })}
                className={cn(
                  "h-8 rounded-full px-3 text-[0.8125rem] transition-colors",
                  value.method === m ? "bg-primary text-primary-foreground" : "bg-surface-raised text-muted-foreground hover:text-foreground"
                )}
              >
                {tk(`reports.enum.method.${m}`)}
              </button>
            ))}
          </div>
          <Field label={t("stl.deposit.amount")}>
            <MoneyInput valueP={value.amountP} onChange={(amountP) => onChange({ ...value, amountP })} data-testid="deposit-amount" />
          </Field>
          {value.method !== "cash" ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <SimulatedBadge />
              {t("stl.deposit.simHint")}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/**
 * Runs a booking with its deposit: cash commits at once; card, bKash and
 * Nagad first go through the simulated terminal or push, and commit with
 * `confirmed: true` and the reference once approved.
 */
export function useDepositFlow() {
  const [request, setRequest] = React.useState<SimRequest | null>(null)
  const run = React.useCallback(
    async (
      deposit: DepositState,
      phone: string | undefined,
      commit: (deposit: DepositInput | undefined) => Promise<boolean>
    ): Promise<void> => {
      if (!deposit.enabled || !deposit.amountP) {
        await commit(undefined)
        return
      }
      const amountP = deposit.amountP
      if (deposit.method === "cash") {
        await commit({ method: "cash", amountP, confirmed: true })
        return
      }
      const method = deposit.method
      setRequest({
        method,
        amountP,
        phone,
        onApproved: (ref) => commit({ method, amountP, ref, confirmed: true }),
      })
    },
    []
  )
  const dialog = <PaymentSimDialog request={request} onClose={() => setRequest(null)} />
  return { run, dialog }
}
