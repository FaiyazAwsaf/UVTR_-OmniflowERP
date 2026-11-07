"use client"

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { VehicleClass, VehicleRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useLocale } from "@/lib/i18n/provider"

import { addVehicle, updateVehicle } from "../commands"
import { normalizeRegNo, regNoToBangla, VEHICLE_CLASS_LIST } from "../lib"
import { Field, NativeSelect, TextInput } from "./kit"

type State = { regNo: string; make: string; model: string; year: string; colour: string; vehicleClass: VehicleClass; vin: string; active: boolean }

const blank = (year: number): State => ({ regNo: "", make: "Toyota", model: "", year: String(year), colour: "", vehicleClass: "SD", vin: "", active: true })

/** Add or edit a customer's vehicle (par.addVehicle / par.updateVehicle); the registration is unique. */
export function VehicleDialog({
  open,
  onOpenChange,
  partyId,
  vehicle,
  thisYear,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  partyId: string
  vehicle?: VehicleRow
  thisYear: number
}) {
  const { t, tk } = useLocale()
  const add = useCommand(addVehicle)
  const update = useCommand(updateVehicle)
  const [s, setS] = React.useState<State>(() => blank(thisYear))
  const [seen, setSeen] = React.useState<string | null>(null)
  const key = open ? (vehicle?.id ?? "new") : null
  if (key !== seen) {
    setSeen(key)
    if (open) {
      setS(
        vehicle
          ? {
              regNo: vehicle.regNo,
              make: vehicle.make,
              model: vehicle.model,
              year: String(vehicle.year),
              colour: vehicle.colour,
              vehicleClass: vehicle.vehicleClass,
              vin: vehicle.vin ?? "",
              active: vehicle.active,
            }
          : blank(thisYear)
      )
    }
  }
  const set = <K extends keyof State>(k: K, v: State[K]) => setS((p) => ({ ...p, [k]: v }))
  const reg = normalizeRegNo(s.regNo)
  const valid = reg.length >= 4 && s.make.trim() && s.model.trim() && Number(s.year) > 1950

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    const fields = {
      regNo: reg,
      make: s.make,
      model: s.model,
      year: Number(s.year),
      colour: s.colour,
      vehicleClass: s.vehicleClass,
      vin: s.vin,
    }
    const result = vehicle
      ? await update.run({ ...fields, vehicleId: vehicle.id, expectedVersion: vehicle.version, active: s.active })
      : await add.run({ ...fields, partyId })
    if (result) {
      toast.success(vehicle ? t("par.vehicle.saved") : t("par.vehicle.added", { regNo: reg }))
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="vehicle-dialog">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{vehicle ? t("par.v360.editVehicle") : t("par.v360.addVehicle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("par.vehicle.regNo")} hint={reg ? regNoToBangla(reg) : t("par.vehicle.regNoHint")} className="sm:col-span-2">
              <TextInput value={s.regNo} onChange={(e) => set("regNo", e.target.value)} lang="en" className="font-mono uppercase" testId="vehicle-reg" required />
            </Field>
            <Field label={t("par.vehicle.make")}>
              <TextInput value={s.make} onChange={(e) => set("make", e.target.value)} testId="vehicle-make" />
            </Field>
            <Field label={t("par.vehicle.model")}>
              <TextInput value={s.model} onChange={(e) => set("model", e.target.value)} testId="vehicle-model" />
            </Field>
            <Field label={t("par.vehicle.class")}>
              <NativeSelect
                value={s.vehicleClass}
                onChange={(v) => set("vehicleClass", v as VehicleClass)}
                testId="vehicle-class"
                options={VEHICLE_CLASS_LIST.map((c) => ({ value: c, label: tk(`reports.enum.vehicleClass.${c}`) }))}
              />
            </Field>
            <Field label={t("par.vehicle.year")}>
              <TextInput value={s.year} onChange={(e) => set("year", e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" className="font-mono" />
            </Field>
            <Field label={t("par.vehicle.colour")}>
              <TextInput value={s.colour} onChange={(e) => set("colour", e.target.value)} />
            </Field>
            <Field label={t("par.vehicle.vin")}>
              <TextInput value={s.vin} onChange={(e) => set("vin", e.target.value)} lang="en" className="font-mono" />
            </Field>
            {vehicle ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={s.active} onCheckedChange={(v) => set("active", !!v)} />
                {t("par.vehicle.active")}
              </label>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="neutral" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || add.pending || update.pending} data-testid="vehicle-save">
              {t("par.vehicle.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
