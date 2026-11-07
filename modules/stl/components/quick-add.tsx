"use client"

import * as React from "react"
import { UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { VEHICLE_CLASSES, type Id, type VehicleClass } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { useLocale } from "@/lib/i18n/provider"

import { quickAddCustomer } from "../commands"
import { Field } from "./kit"

/**
 * "+ New customer" on the quotation and booking screens: a retail customer
 * with a vehicle in one step (hidden live when par.customer.create is
 * revoked, plan §10 E13).
 */
export function QuickAddCustomer({ onAdded }: { onAdded: (partyId: Id, vehicleId?: Id) => void }) {
  const { t, tk } = useLocale()
  const allowed = useCan("par.customer.create")
  const add = useCommand(quickAddCustomer)
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState({ nameEn: "", nameBn: "", phone: "", regNo: "", make: "Toyota", model: "", vehicleClass: "SD" as VehicleClass })
  if (!allowed) return null
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const valid = form.nameEn.trim().length >= 2 && /^01\d{3}-?\d{6}$/.test(form.phone.trim()) && (!form.regNo || form.model.trim())

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const out = await add.run({
      nameEn: form.nameEn,
      nameBn: form.nameBn || undefined,
      phone: form.phone,
      vehicle: form.regNo.trim()
        ? { regNo: form.regNo, make: form.make, model: form.model, vehicleClass: form.vehicleClass, colour: "" }
        : undefined,
    })
    if (out) {
      onAdded(out.partyId, out.vehicleId)
      setOpen(false)
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="quick-add">
        <UserPlus data-icon="inline-start" />
        {t("stl.quick.button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("stl.quick.title")}</DialogTitle>
              <DialogDescription>{t("stl.quick.body")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("stl.quick.nameEn")}>
                <Input value={form.nameEn} onChange={(e) => set({ nameEn: e.target.value })} data-testid="quick-name" />
              </Field>
              <Field label={t("stl.quick.nameBn")}>
                <Input value={form.nameBn} onChange={(e) => set({ nameBn: e.target.value })} />
              </Field>
              <Field label={t("common.phone")} hint={t("stl.quick.phoneHint")}>
                <Input value={form.phone} inputMode="tel" onChange={(e) => set({ phone: e.target.value })} data-testid="quick-phone" className="font-mono" />
              </Field>
              <Field label={t("stl.quick.regNo")}>
                <Input value={form.regNo} onChange={(e) => set({ regNo: e.target.value })} placeholder="DHAKA METRO-GA 27-4419" className="font-mono uppercase" data-testid="quick-reg" />
              </Field>
              <Field label={t("stl.quick.make")}>
                <Input value={form.make} onChange={(e) => set({ make: e.target.value })} />
              </Field>
              <Field label={t("stl.quick.model")}>
                <Input value={form.model} onChange={(e) => set({ model: e.target.value })} data-testid="quick-model" />
              </Field>
              <Field label={t("stl.quick.class")}>
                <Select value={form.vehicleClass} onValueChange={(v) => v && set({ vehicleClass: v as VehicleClass })}>
                  <SelectTrigger>
                    <SelectValue>{() => tk(`reports.enum.vehicleClass.${form.vehicleClass}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {VEHICLE_CLASSES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {tk(`reports.enum.vehicleClass.${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="neutral" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={!valid || add.pending} data-testid="quick-save">
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
