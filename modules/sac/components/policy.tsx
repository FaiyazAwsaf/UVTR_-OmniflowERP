"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { KeyRound, Save, ShieldCheck, Timer, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/shared/page-header"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { SecurityPolicy } from "@/core/db/schema"
import { DEFAULT_SECURITY_POLICY } from "@/core/db/settings"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { latinDigits } from "@/lib/i18n/dmy"
import { useLocale } from "@/lib/i18n/provider"

import { POLICY_BOUNDS, savePolicy } from "../commands"
import { roleName, useUserDirectory } from "../queries"
import { Field } from "./kit"

type NumberField = keyof typeof POLICY_BOUNDS

/** /sac/policy: password, lockout, idle timeout and MFA roles (`sac.savePolicy`). */
export function PolicyScreen() {
  const { t, num, locale, digits } = useLocale()
  const db = useDb()
  const directory = useUserDirectory()
  const canEdit = useCan("sac.policy.configure")
  const save = useCommand(savePolicy)
  const nowMs = useNow(60_000)
  const row = useLiveQuery(async () => (await db.settings.get("security")) ?? null, [db])
  const stored = (row?.value as SecurityPolicy | undefined) ?? DEFAULT_SECURITY_POLICY
  const [draft, setDraft] = React.useState<SecurityPolicy | null>(null)
  const policy = draft ?? stored
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(stored)

  const set = <K extends keyof SecurityPolicy>(key: K, value: SecurityPolicy[K]) =>
    setDraft((d) => ({ ...(d ?? stored), [key]: value }))

  const numberInput = (key: NumberField, testId: string) => {
    const [min, max] = POLICY_BOUNDS[key]
    const value = policy[key]
    const invalid = !Number.isInteger(value) || value < min || value > max
    return (
      <Input
        inputMode="numeric"
        value={Number.isFinite(value) ? digits(String(value)) : ""}
        onChange={(e) => {
          const text = latinDigits(e.target.value).replace(/\D/g, "")
          set(key, text === "" ? Number.NaN : Number(text))
        }}
        disabled={!canEdit}
        aria-invalid={invalid || undefined}
        className="max-w-32 text-right font-mono"
        data-testid={testId}
      />
    )
  }
  const valid = (Object.keys(POLICY_BOUNDS) as NumberField[]).every((key) => {
    const [min, max] = POLICY_BOUNDS[key]
    const value = policy[key]
    return Number.isInteger(value) && value >= min && value <= max
  })

  const submit = async () => {
    const result = await save.run({ ...policy, expectedVersion: row?.version })
    if (!result) return
    setDraft(null)
    toast.success(t("sac.policy.saved"))
    if (result.mfaTurnedOn) toast.info(t("sac.policy.mfaTurnedOn", { count: num(result.mfaTurnedOn) }))
  }

  const users = directory?.users ?? []
  const expiryMs = stored.passwordExpiryDays * 86_400_000
  const stats = [
    { label: t("sac.policy.mustChange"), value: users.filter((u) => u.mustChangePassword).length },
    {
      label: t("sac.policy.pastExpiry"),
      value: expiryMs && nowMs ? users.filter((u) => nowMs - u.passwordSetAt > expiryMs).length : 0,
    },
    { label: t("sac.policy.mfaUsers"), value: users.filter((u) => u.mfaEnabled).length },
    { label: t("sac.policy.lockedUsers"), value: users.filter((u) => u.status === "locked").length },
  ]
  const range = (key: NumberField) =>
    t("sac.policy.range", { min: num(POLICY_BOUNDS[key][0]), max: num(POLICY_BOUNDS[key][1]) })

  return (
    <div className="flex flex-col gap-5" data-testid="policy">
      <PageHeader
        title={t("sac.policy.title")}
        subtitle={t("sac.policy.subtitle")}
        actions={
          canEdit ? (
            <>
              <Button variant="neutral" onClick={() => setDraft(null)} disabled={!dirty}>
                <Undo2 />
                {t("sac.policy.revert")}
              </Button>
              <Button onClick={submit} disabled={!dirty || !valid || save.pending} data-testid="policy-save">
                <Save />
                {t("sac.policy.save")}
              </Button>
            </>
          ) : null
        }
      />
      {!canEdit ? <p className="rounded-md bg-surface-raised px-4 py-3 text-sm text-muted-foreground">{t("sac.policy.readOnly")}</p> : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <SectionCard title={t("sac.policy.passwords")} icon={KeyRound} size="sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("sac.policy.minLength")} hint={range("minLength")}>
                {numberInput("minLength", "policy-min-length")}
              </Field>
              <Field label={t("sac.policy.expiry")} hint={t("sac.policy.expiryHint")}>
                {numberInput("passwordExpiryDays", "policy-expiry")}
              </Field>
              <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-[0.8125rem] sm:col-span-2">
                {t("sac.policy.requireDigit")}
                <Switch
                  checked={policy.requireDigit}
                  onCheckedChange={(on) => set("requireDigit", !!on)}
                  disabled={!canEdit}
                  data-testid="policy-digit"
                />
              </label>
            </div>
          </SectionCard>
          <SectionCard title={t("sac.policy.lockout")} icon={Timer} size="sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("sac.policy.lockoutThreshold")} hint={t("sac.policy.lockoutHint")}>
                {numberInput("lockoutThreshold", "policy-lockout")}
              </Field>
              <Field label={t("sac.policy.idle")} hint={t("sac.policy.idleHint")}>
                {numberInput("idleTimeoutMin", "policy-idle")}
              </Field>
            </div>
          </SectionCard>
          <SectionCard
            title={t("sac.policy.mfa")}
            subtitle={t("sac.policy.mfaHint")}
            icon={ShieldCheck}
            size="sm"
            action={<SimulatedBadge />}
          >
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {(directory?.roles ?? [])
                .filter((r) => r.active)
                .map((r) => (
                  <label key={r.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[0.8125rem] hover:bg-surface-raised">
                    <Checkbox
                      checked={policy.mfaRequiredRoles.includes(r.code)}
                      disabled={!canEdit}
                      onCheckedChange={(on) =>
                        set(
                          "mfaRequiredRoles",
                          on ? [...policy.mfaRequiredRoles, r.code] : policy.mfaRequiredRoles.filter((c) => c !== r.code)
                        )
                      }
                      data-testid="policy-mfa-role"
                      data-role={r.code}
                    />
                    <span className="min-w-0 flex-1 truncate">{roleName(r, locale)}</span>
                    <span lang="en" className="font-mono text-[0.6875rem] text-muted-foreground">
                      {r.code}
                    </span>
                  </label>
                ))}
            </div>
          </SectionCard>
        </div>
        <SectionCard title={t("sac.policy.stats")} size="sm" className="h-fit">
          <dl className="flex flex-col divide-y divide-hairline">
            {stats.map((s) => (
              <div key={s.label} className="flex items-center justify-between py-2.5 text-[0.8125rem]">
                <dt className="text-muted-foreground">{s.label}</dt>
                <dd className="nums font-semibold">{num(s.value)}</dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      </div>
    </div>
  )
}
