"use client"

import * as React from "react"
import { toast } from "sonner"

import { locations } from "@/config/brand.config"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { UserRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useLocale } from "@/lib/i18n/provider"

import { saveUser } from "../commands"
import { Field, OptionSelect } from "./kit"

type Draft = {
  username: string
  nameEn: string
  nameBn: string
  designationEn: string
  designationBn: string
  email: string
  phone: string
  employeeNo: string
  homeLocationId: string
  locationIds: string[]
  mfaEnabled: boolean
  sex: "M" | "F"
}

function draftOf(user: UserRow | null): Draft {
  return user
    ? {
        username: user.username,
        nameEn: user.nameEn,
        nameBn: user.nameBn,
        designationEn: user.designationEn,
        designationBn: user.designationBn,
        email: user.email,
        phone: user.phone,
        employeeNo: user.employeeNo,
        homeLocationId: user.homeLocationId,
        locationIds: [...user.locationIds],
        mfaEnabled: user.mfaEnabled,
        sex: user.sex,
      }
    : {
        username: "",
        nameEn: "",
        nameBn: "",
        designationEn: "",
        designationBn: "",
        email: "",
        phone: "",
        employeeNo: "",
        homeLocationId: "loc_hq",
        locationIds: ["loc_hq"],
        mfaEnabled: false,
        sex: "M",
      }
}

/**
 * Create or edit a user (`sac.saveUser`: new needs sac.user.create, edit
 * sac.user.edit). A new user gets a one-time temporary password, shown by
 * the caller. Edits carry the row's version, so a stale edit shows the
 * conflict dialog.
 */
export function UserFormDialog({
  open,
  onOpenChange,
  user,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The user to edit; null to create */
  user: UserRow | null
  onCreated?: (result: { userId: string; name: string; tempPassword: string }) => void
}) {
  const { t, locale } = useLocale()
  const command = useCommand(saveUser)
  const [draft, setDraft] = React.useState<Draft>(() => draftOf(user))
  const [openedFor, setOpenedFor] = React.useState<string | null>(null)
  const key = open ? (user?.id ?? "new") : null
  if (key !== openedFor) {
    setOpenedFor(key)
    if (open) setDraft(draftOf(user))
  }
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((d) => ({ ...d, [field]: value }))
  const toggleLocation = (id: string, on: boolean) =>
    setDraft((d) => {
      const ids = on ? [...new Set([...d.locationIds, id])] : d.locationIds.filter((x) => x !== id)
      const home = ids.includes(d.homeLocationId) ? d.homeLocationId : (ids[0] ?? d.homeLocationId)
      return { ...d, locationIds: ids, homeLocationId: home }
    })

  const valid =
    draft.username.trim().length >= 3 &&
    draft.nameEn.trim().length >= 2 &&
    draft.nameBn.trim().length >= 1 &&
    draft.locationIds.length > 0

  const submit = async () => {
    const result = await command.run({
      ...draft,
      id: user?.id,
      expectedVersion: user?.version,
    })
    if (!result) return
    const name = locale === "bn" ? draft.nameBn : draft.nameEn
    onOpenChange(false)
    if (!user && result.tempPassword) {
      toast.success(t("sac.form.created", { name }))
      onCreated?.({ userId: result.userId, name, tempPassword: result.tempPassword })
    } else {
      toast.success(t("sac.form.saved", { name }))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="user-form">
        <DialogHeader>
          <DialogTitle className="text-[1.0625rem] font-semibold">
            {user ? t("sac.form.editTitle", { name: locale === "bn" ? user.nameBn : user.nameEn }) : t("sac.form.newTitle")}
          </DialogTitle>
          {!user ? <DialogDescription>{t("sac.form.newHint")}</DialogDescription> : null}
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("sac.form.username")} hint={!user ? t("sac.form.usernameHint") : undefined}>
            <Input
              lang="en"
              value={draft.username}
              disabled={!!user}
              autoComplete="off"
              onChange={(e) => set("username", e.target.value.toLowerCase().replace(/\s/g, ""))}
              className="font-mono"
              data-testid="user-username"
            />
          </Field>
          <Field label={t("sac.form.employeeNo")}>
            <Input
              lang="en"
              value={draft.employeeNo}
              onChange={(e) => set("employeeNo", e.target.value)}
              className="font-mono"
            />
          </Field>
          <Field label={t("sac.form.nameEn")}>
            <Input value={draft.nameEn} onChange={(e) => set("nameEn", e.target.value)} data-testid="user-name-en" />
          </Field>
          <Field label={t("sac.form.nameBn")}>
            <Input value={draft.nameBn} onChange={(e) => set("nameBn", e.target.value)} data-testid="user-name-bn" />
          </Field>
          <Field label={t("sac.form.designationEn")}>
            <Input value={draft.designationEn} onChange={(e) => set("designationEn", e.target.value)} />
          </Field>
          <Field label={t("sac.form.designationBn")}>
            <Input value={draft.designationBn} onChange={(e) => set("designationBn", e.target.value)} />
          </Field>
          <Field label={t("sac.form.email")}>
            <Input lang="en" type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label={t("sac.form.phone")}>
            <Input lang="en" inputMode="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} className="font-mono" />
          </Field>
          <Field label={t("sac.form.locations")} className="sm:col-span-2">
            <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-md border border-border p-3">
              {locations.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-[0.8125rem]">
                  <Checkbox
                    checked={draft.locationIds.includes(l.id)}
                    onCheckedChange={(on) => toggleLocation(l.id, !!on)}
                    data-testid="user-location"
                    data-location={l.code}
                  />
                  {l.name[locale]}
                  <span lang="en" className="font-mono text-xs text-muted-foreground">
                    {l.code}
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <Field label={t("sac.form.home")}>
            <OptionSelect
              value={draft.homeLocationId}
              onChange={(v) => set("homeLocationId", v)}
              label={t("sac.form.home")}
              options={locations
                .filter((l) => draft.locationIds.includes(l.id))
                .map((l) => ({ value: l.id, label: l.name[locale] }))}
              className="w-full"
            />
          </Field>
          <Field label={t("sac.form.sex")}>
            <OptionSelect
              value={draft.sex}
              onChange={(v) => set("sex", v as Draft["sex"])}
              label={t("sac.form.sex")}
              options={[
                { value: "M", label: t("sac.form.sexM") },
                { value: "F", label: t("sac.form.sexF") },
              ]}
              className="w-full"
            />
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-[0.8125rem] sm:col-span-2">
            {t("sac.form.mfa")}
            <Switch checked={draft.mfaEnabled} onCheckedChange={(on) => set("mfaEnabled", !!on)} data-testid="user-mfa" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!valid || command.pending} data-testid="user-save">
            {user ? t("sac.form.save") : t("sac.form.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
