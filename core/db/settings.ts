import { defaultTaxSettings, rules } from "@/config/rules.config"
import type { Tx } from "@/core/engine/types"

import type { OmniflowDb } from "./database"
import type { SecurityPolicy, SettingKey, SettingsValues } from "./schema"

/** Defaults used when a settings row is missing (fresh tests, before seeding). */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  minLength: rules.passwordMinLength,
  requireDigit: true,
  lockoutThreshold: rules.lockoutThreshold,
  idleTimeoutMin: rules.idleTimeoutMin,
  passwordExpiryDays: rules.passwordExpiryDays,
  mfaRequiredRoles: ["SYS_ADMIN"],
}

const DEFAULTS: Partial<SettingsValues> = {
  tax: defaultTaxSettings,
  security: DEFAULT_SECURITY_POLICY,
  company: { printFooterEn: "", printFooterBn: "" },
}

/** A typed settings value inside a commit (sees this commit's own writes). */
export async function getSetting<K extends SettingKey>(tx: Tx, key: K): Promise<SettingsValues[K]> {
  const row = await tx.find("settings", key)
  const value = (row?.value ?? DEFAULTS[key]) as SettingsValues[K] | undefined
  if (value === undefined) throw new Error(`settings row "${key}" missing`)
  return value
}

/** A typed settings value from committed data (live queries, sweeper jobs). */
export async function readSetting<K extends SettingKey>(
  db: OmniflowDb,
  key: K
): Promise<SettingsValues[K]> {
  const row = await db.settings.get(key)
  const value = (row?.value ?? DEFAULTS[key]) as SettingsValues[K] | undefined
  if (value === undefined) throw new Error(`settings row "${key}" missing`)
  return value
}
