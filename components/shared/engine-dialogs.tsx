"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { Ban, RefreshCw, ShieldX, UserRoundX } from "lucide-react"

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
import { useDb } from "@/core/db/DbProvider"
import { PERMISSION_BY_KEY } from "@/core/security/registry"
import { usePermissions } from "@/core/security/useCan"
import { userName } from "@/core/security/users"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/** A user's name in the window's language (live from the users table). */
function useUserName(userId: string): string {
  const { t, locale } = useLocale()
  const db = useDb()
  const row = useLiveQuery(
    () => (userId === "system" || userId === "demo-setup" ? undefined : db.users.get(userId)),
    [db, userId]
  )
  if (userId === "system" || userId === "demo-setup") return t("shell.feedback.system")
  if (row) return userName(row, locale)
  return t("shell.feedback.someone")
}

function DialogIcon({
  tone,
  children,
}: {
  tone: "info" | "destructive" | "warning"
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5",
        tone === "info" &&
          "bg-[color-mix(in_oklch,var(--info)_16%,transparent)] text-info",
        tone === "destructive" &&
          "bg-[color-mix(in_oklch,var(--destructive)_16%,transparent)] text-destructive",
        tone === "warning" &&
          "bg-[color-mix(in_oklch,var(--warning)_18%,transparent)] text-warning"
      )}
    >
      {children}
    </span>
  )
}

export type ConflictInfo = {
  updatedBy: string
  updatedAt: number
  expectedVersion: number
  actualVersion: number
}

/**
 * Optimistic-concurrency conflict (plan §3.3, scenario E15): "Record changed by
 * <name> at <time> (v3 to v4). Reload to see the latest." Screens read through
 * live queries, so "Reload" only has to dismiss the dialog.
 */
export function ConflictDialog({
  open,
  conflict,
  onReload,
}: {
  open: boolean
  /** A ConflictError (or the same fields) */
  conflict: ConflictInfo
  onReload: () => void
}) {
  const { t, num, time } = useLocale()
  const name = useUserName(conflict.updatedBy)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (!next ? onReload() : undefined)}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogIcon tone="info">
              <RefreshCw />
            </DialogIcon>
            <DialogTitle>{t("shell.feedback.conflictTitle")}</DialogTitle>
          </div>
          <DialogDescription className="pt-1 text-sm text-foreground/85">
            {t("shell.feedback.conflictBody", {
              name,
              time: time(conflict.updatedAt),
              from: num(conflict.expectedVersion),
              to: num(conflict.actualVersion),
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onReload} autoFocus>
            <RefreshCw />
            {t("shell.feedback.reload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type RuleInfo = {
  code: string
  params?: Record<string, string | number>
  /** The blocked attempt was audited */
  audit?: boolean
}

/**
 * A business rule refused the commit (invariant or command check): the rule's
 * message from `rules.<CODE>`, the code itself, and whether the attempt was
 * written to the audit log.
 */
export function RuleViolationDialog({
  open,
  violation,
  command,
  onClose,
}: {
  open: boolean
  /** A RuleViolation (or the same fields) */
  violation: RuleInfo
  /** The refused command's name; its module's rule messages are tried first */
  command?: string
  onClose: () => void
}) {
  const { t, tk, num, money, dmy, locale } = useLocale()
  const params = violation.params ?? {}
  const message = ruleMessage(
    violation.code,
    params,
    { locale, tk, num: (value) => num(value), money, dmy },
    command
  )
  const rule = typeof params.rule === "string" ? params.rule : undefined
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (!next ? onClose() : undefined)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogIcon tone="destructive">
              <Ban />
            </DialogIcon>
            <DialogTitle>{t("shell.feedback.ruleTitle")}</DialogTitle>
          </div>
          <DialogDescription className="pt-1 text-sm leading-relaxed text-foreground/90">
            {message}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span
            lang="en"
            className="rounded-sm bg-surface-raised px-2 py-1 font-mono text-[0.6875rem] text-foreground/80"
          >
            {violation.code}
            {rule ? ` · ${rule}` : ""}
          </span>
          {violation.audit ? <span>{t("shell.feedback.audited")}</span> : null}
        </div>
        <DialogFooter>
          <Button onClick={onClose} autoFocus>
            {t("shell.feedback.ok")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The signed-in user lacks a command's permission: "You need the permission
 * <label>. An administrator can grant it in RBAC." Always audited.
 */
export function DeniedDialog({
  open,
  permissions,
  onClose,
}: {
  open: boolean
  /** The key(s) the command needs */
  permissions?: readonly string[]
  onClose: () => void
}) {
  const { t, tk, locale } = useLocale()
  const { user } = usePermissions()
  const labels = (permissions ?? [])
    .map((key) => {
      const def = PERMISSION_BY_KEY.get(key)
      return def ? tk(def.labelKey) : key
    })
    .join(" / ")
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogIcon tone="warning">
              <ShieldX />
            </DialogIcon>
            <DialogTitle>{t("shell.feedback.deniedTitle")}</DialogTitle>
          </div>
          <DialogDescription className="pt-1 text-sm leading-relaxed text-foreground/90">
            {labels
              ? t("shell.feedback.deniedBody", { permission: labels })
              : t("shell.feedback.deniedUnknown")}{" "}
            {user ? t("shell.feedback.signedInAs", { user: userName(user, locale) }) : null}
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("shell.feedback.audited")}</p>
        <DialogFooter>
          <Button onClick={onClose} autoFocus>
            {t("shell.feedback.ok")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A command ran before anyone signed in to the window. */
export function NoUserDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { t } = useLocale()
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (!next ? onClose() : undefined)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogIcon tone="warning">
              <UserRoundX />
            </DialogIcon>
            <DialogTitle>{t("shell.feedback.noUserTitle")}</DialogTitle>
          </div>
          <DialogDescription className="pt-1 text-sm leading-relaxed text-foreground/90">
            {t("shell.feedback.noUserBody")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/" />}
            onClick={onClose}
          >
            {t("shell.userMenu.openLauncher")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
