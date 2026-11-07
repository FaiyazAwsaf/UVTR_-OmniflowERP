"use client"

import type { ApprovalKind } from "@/core/security/types"
import { PERMISSION_BY_KEY } from "@/core/security/registry"
import { useLocale } from "@/lib/i18n/provider"

import { ANY_APPROVE } from "./sod"
import { appOfKey } from "./matrix"

/** Display helpers for RBAC values in the window's language. */
export function useRbacFormat() {
  const { t, tk, money, num } = useLocale()

  /** The catalogue label of a key ("Issue invoices"), or the key itself. */
  const keyLabel = (key: string): string => {
    if (key === ANY_APPROVE) return t("rbac.common.anyApprove")
    const def = PERMISSION_BY_KEY.get(key)
    if (!def) return key
    const label = tk(def.labelKey)
    return label === def.labelKey ? key : label
  }

  /** The app's name ("Sale Invoice"), the dashboard included. */
  const appName = (app: string): string => {
    const key = `${app}.name`
    const label = tk(key)
    if (label !== key) return label
    const extra = tk(`rbac.apps.${app}`)
    return extra === `rbac.apps.${app}` ? app.toUpperCase() : extra
  }

  /** A limit value as shown in the limits grid. */
  const limitText = (kind: ApprovalKind, value: number): string => {
    if (kind === "credit-override") return value >= 1 || value < 0 ? t("rbac.common.yes") : t("rbac.common.no")
    if (value < 0 || value === Infinity) return t("rbac.common.unlimited")
    if (kind === "discount-pct") return t("rbac.limits.percentValue", { value: num(value) })
    return money(value)
  }

  return { keyLabel, appName, limitText, appOfKey }
}
