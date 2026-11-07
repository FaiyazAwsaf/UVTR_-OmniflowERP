"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { RoleRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useLocale } from "@/lib/i18n/provider"
import { Field, OptionSelect } from "@/modules/sac/components/kit"
import { roleName } from "@/modules/sac/queries"

import { saveRole } from "../commands"

type Draft = {
  code: string
  nameEn: string
  nameBn: string
  descriptionEn: string
  descriptionBn: string
  active: boolean
  copyFrom: string
}

const empty: Draft = { code: "", nameEn: "", nameBn: "", descriptionEn: "", descriptionBn: "", active: true, copyFrom: "none" }

/** Create or edit a role (`rbac.saveRole`); a new role may start from an existing one. */
export function RoleFormDialog({
  open,
  onOpenChange,
  role,
  roles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: RoleRow | null
  roles: RoleRow[]
}) {
  const { t, locale } = useLocale()
  const router = useRouter()
  const command = useCommand(saveRole)
  const [draft, setDraft] = React.useState<Draft>(empty)
  const [openedFor, setOpenedFor] = React.useState<string | null>(null)
  const key = open ? (role?.id ?? "new") : null
  if (key !== openedFor) {
    setOpenedFor(key)
    if (open) {
      setDraft(
        role
          ? {
              code: role.code,
              nameEn: role.nameEn,
              nameBn: role.nameBn,
              descriptionEn: role.descriptionEn,
              descriptionBn: role.descriptionBn,
              active: role.active,
              copyFrom: "none",
            }
          : empty
      )
    }
  }
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((d) => ({ ...d, [field]: value }))
  const valid = /^[A-Z][A-Z0-9_]{1,23}$/.test(draft.code) && draft.nameEn.trim().length >= 2 && draft.nameBn.trim().length >= 1

  const submit = async () => {
    const result = await command.run({
      id: role?.id,
      expectedVersion: role?.version,
      code: draft.code,
      nameEn: draft.nameEn,
      nameBn: draft.nameBn,
      descriptionEn: draft.descriptionEn,
      descriptionBn: draft.descriptionBn,
      active: draft.active,
      copyFrom: !role && draft.copyFrom !== "none" ? draft.copyFrom : undefined,
    })
    if (!result) return
    const name = locale === "bn" ? draft.nameBn : draft.nameEn
    onOpenChange(false)
    toast.success(t(role ? "rbac.roleForm.saved" : "rbac.roleForm.created", { name }))
    if (!role) router.push(`/rbac/roles/${result.roleId}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" data-testid="role-form">
        <DialogHeader>
          <DialogTitle className="text-[1.0625rem] font-semibold">
            {role ? t("rbac.roleForm.editTitle", { name: roleName(role, locale) }) : t("rbac.roleForm.newTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("rbac.roleForm.code")} hint={t("rbac.roleForm.codeHint")} className="sm:col-span-2">
            <Input
              lang="en"
              value={draft.code}
              disabled={!!role?.isSystem}
              onChange={(e) => set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
              className="font-mono"
              data-testid="role-code"
            />
          </Field>
          <Field label={t("rbac.roleForm.nameEn")}>
            <Input value={draft.nameEn} onChange={(e) => set("nameEn", e.target.value)} data-testid="role-name-en" />
          </Field>
          <Field label={t("rbac.roleForm.nameBn")}>
            <Input value={draft.nameBn} onChange={(e) => set("nameBn", e.target.value)} data-testid="role-name-bn" />
          </Field>
          <Field label={t("rbac.roleForm.descriptionEn")}>
            <Textarea rows={2} value={draft.descriptionEn} onChange={(e) => set("descriptionEn", e.target.value)} />
          </Field>
          <Field label={t("rbac.roleForm.descriptionBn")}>
            <Textarea rows={2} value={draft.descriptionBn} onChange={(e) => set("descriptionBn", e.target.value)} />
          </Field>
          {!role ? (
            <Field label={t("rbac.roleForm.copyFrom")} hint={t("rbac.roleForm.copyHint")} className="sm:col-span-2">
              <OptionSelect
                value={draft.copyFrom}
                onChange={(v) => set("copyFrom", v)}
                label={t("rbac.roleForm.copyFrom")}
                className="w-full"
                testId="role-copy-from"
                options={[
                  { value: "none", label: t("rbac.roleForm.copyNone") },
                  ...roles.map((r) => ({ value: r.id, label: roleName(r, locale) })),
                ]}
              />
            </Field>
          ) : null}
          <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-[0.8125rem] sm:col-span-2">
            {t("rbac.roleForm.active")}
            <Switch checked={draft.active} onCheckedChange={(on) => set("active", !!on)} data-testid="role-active" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!valid || command.pending} data-testid="role-save">
            {t("rbac.roleForm.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
