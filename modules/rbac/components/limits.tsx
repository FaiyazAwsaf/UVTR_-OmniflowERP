"use client"

import * as React from "react"
import Link from "next/link"
import { Lock } from "lucide-react"
import { toast } from "sonner"

import { ScrollX } from "@/components/shared/scroll-x"
import { MoneyInput } from "@/components/shared/money-input"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import type { ApprovalLimitRow, RoleRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { APPROVAL_KINDS, type ApprovalKind } from "@/core/security/types"
import { usePermissions } from "@/core/security/useCan"
import { latinDigits } from "@/lib/i18n/dmy"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { Field, Mono } from "@/modules/sac/components/kit"
import { roleName } from "@/modules/sac/queries"

import { limitValueValid, setLimit } from "../commands"
import { useRbacFormat } from "../format"
import { useRbacData } from "../queries"

/**
 * /rbac/limits: approval limits per role and kind (seed_data.md §2.2):
 * poisha for amounts, percent for discounts, yes or no for credit overrides,
 * -1 for unlimited (`rbac.setLimit`). A user never edits a role they hold.
 */
export function LimitsScreen() {
  const { t, tk, locale } = useLocale()
  const data = useRbacData()
  const { can, security } = usePermissions()
  const { limitText } = useRbacFormat()
  const canEdit = can("rbac.limits.edit")

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("rbac.limits.title")}
        subtitle={t("rbac.limits.subtitle")}
      />
      <section className="surface-card @container/limits min-w-0 p-4 md:p-5">
        <ScrollX>
          <table className="w-full min-w-[52rem] border-separate border-spacing-0 text-[0.8125rem]">
            <thead>
              <tr>
                <th className="h-10 rounded-l-md bg-surface-raised px-3 text-left font-medium">
                  {t("rbac.limits.role")}
                </th>
                {APPROVAL_KINDS.map((kind, i) => (
                  <th
                    key={kind}
                    className={cn(
                      "h-10 bg-surface-raised px-2 text-right font-medium whitespace-nowrap",
                      i === APPROVAL_KINDS.length - 1 && "rounded-r-md"
                    )}
                  >
                    {tk(`rbac.kinds.${kind}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.roles ?? []).map((role) => {
                const own = !!security?.roleIds.includes(role.id)
                return (
                  <tr
                    key={role.id}
                    className={cn(
                      "hover:bg-primary-soft/40",
                      !role.active && "opacity-60"
                    )}
                    data-testid="limit-row"
                    data-role={role.code}
                  >
                    <td className="h-11 border-b border-hairline px-3">
                      <Link
                        href={`/rbac/roles/${role.id}`}
                        className="flex min-w-0 items-center gap-2 hover:underline"
                      >
                        <span className="truncate font-medium">
                          {roleName(role, locale)}
                        </span>
                        {own ? (
                          <span title={t("rbac.limits.own")}>
                            <Lock className="size-3.5 text-muted-foreground" />
                          </span>
                        ) : null}
                      </Link>
                      <Mono className="text-muted-foreground">{role.code}</Mono>
                    </td>
                    {APPROVAL_KINDS.map((kind) => {
                      const row = data?.limits.find(
                        (l) => l.roleId === role.id && l.kind === kind
                      )
                      return (
                        <LimitCell
                          key={kind}
                          role={role}
                          kind={kind}
                          row={row}
                          text={limitText(kind, row?.value ?? 0)}
                          editable={canEdit && !own}
                        />
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ScrollX>
      </section>
    </div>
  )
}

function LimitCell({
  role,
  kind,
  row,
  text,
  editable,
}: {
  role: RoleRow
  kind: ApprovalKind
  row: ApprovalLimitRow | undefined
  text: string
  editable: boolean
}) {
  const { t, tk, locale } = useLocale()
  const command = useCommand(setLimit)
  const [open, setOpen] = React.useState(false)
  const value = row?.value ?? 0
  const [draft, setDraft] = React.useState<number | null>(value)
  const [unlimited, setUnlimited] = React.useState(value < 0)
  const [wasOpen, setWasOpen] = React.useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDraft(value < 0 ? null : value)
      setUnlimited(value < 0)
    }
  }
  const next =
    kind === "credit-override" ? (draft ? 1 : 0) : unlimited ? -1 : (draft ?? 0)
  const valid = limitValueValid(kind, next)
  const zero = value === 0
  const cellClass = cn(
    "h-11 border-b border-hairline px-2 text-right font-mono tabular-nums",
    zero && "text-muted-foreground"
  )

  const save = async () => {
    const result = await command.run({
      roleId: role.id,
      kind,
      value: next,
      expectedVersion: row?.version,
    })
    if (!result) return
    setOpen(false)
    if (result.changed)
      toast.success(
        t("rbac.limits.saved", {
          kind: tk(`rbac.kinds.${kind}`),
          role: roleName(role, locale),
        })
      )
  }

  if (!editable) {
    return (
      <td
        className={cellClass}
        data-testid="limit-cell"
        data-role={role.code}
        data-kind={kind}
        data-value={value}
      >
        <span className="block px-1.5 py-1">{text}</span>
      </td>
    )
  }
  return (
    <td
      className={cellClass}
      data-testid="limit-cell"
      data-role={role.code}
      data-kind={kind}
      data-value={value}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          data-testid="limit-edit"
          className="w-full rounded-md px-1.5 py-1 text-right outline-none hover:bg-surface-raised hover:text-link focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {text}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-72 gap-3"
          data-testid="limit-popover"
        >
          <p className="text-[0.8125rem] font-semibold">
            {t("rbac.limits.edit", {
              kind: tk(`rbac.kinds.${kind}`),
              role: roleName(role, locale),
            })}
          </p>
          {kind === "credit-override" ? (
            <label className="flex items-center justify-between gap-3 text-[0.8125rem]">
              {t("rbac.limits.allowed")}
              <Switch
                checked={!!draft}
                onCheckedChange={(on) => setDraft(on ? 1 : 0)}
                data-testid="limit-yes"
              />
            </label>
          ) : kind === "discount-pct" ? (
            <Field label={t("rbac.limits.percent")}>
              <Input
                inputMode="numeric"
                value={draft === null ? "" : String(draft)}
                onChange={(e) => {
                  const digits = latinDigits(e.target.value).replace(/\D/g, "")
                  setDraft(digits === "" ? null : Number(digits))
                }}
                className="text-right font-mono"
                data-testid="limit-input"
              />
            </Field>
          ) : (
            <>
              <label className="flex items-center justify-between gap-3 text-[0.8125rem]">
                {t("rbac.limits.unlimitedSwitch")}
                <Switch
                  checked={unlimited}
                  onCheckedChange={(on) => setUnlimited(!!on)}
                  data-testid="limit-unlimited"
                />
              </label>
              {!unlimited ? (
                <Field label={t("rbac.limits.amount")}>
                  <MoneyInput
                    valueP={draft}
                    onChange={setDraft}
                    data-testid="limit-input"
                  />
                </Field>
              ) : null}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" size="sm" onClick={() => setOpen(false)}>
              {t("rbac.common.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={!valid || command.pending}
              onClick={save}
              data-testid="limit-save"
            >
              {t("rbac.common.save")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </td>
  )
}
