"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Check, ChevronsUpDown } from "lucide-react"

import { MoneyText } from "@/components/shared/money-text"
import { RegPlate } from "@/components/shared/reg-plate"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useDb } from "@/core/db/DbProvider"
import type {
  AccountRow,
  Id,
  ItemRow,
  LocationRow,
  PartyRow,
  ServiceRow,
  VehicleClass,
  VehicleRow,
} from "@/core/db/schema"
import { nameOf } from "@/core/security/users"
import { latinDigits } from "@/lib/i18n/dmy"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

/** Lower-case, Latin digits, no spaces or dashes: "ঢাকা মেট্রো-গ ১৫-৭৭৩১" and "15-7731" both match. */
export function searchKey(text: string): string {
  return latinDigits(text).toLowerCase().replace(/[\s\-.,/]/g, "")
}

type SearchPickerProps<T> = {
  items: T[] | undefined
  value: Id | null
  onChange: (id: Id | null, item: T | null) => void
  getId: (item: T) => Id
  /** Text searched (any scripts; normalised by `searchKey`) */
  searchText: (item: T) => string
  /** The trigger's content for the selected item */
  renderValue: (item: T) => React.ReactNode
  renderItem: (item: T) => React.ReactNode
  placeholder: string
  disabled?: boolean
  className?: string
  testId?: string
  /** Most results shown (the list is filtered as you type) */
  limit?: number
}

/**
 * The generic search picker behind every ERP picker (plan P1.10): a button
 * that opens a searchable list in a popover. Filtering is done here (not by
 * cmdk) so Bangla digits, spaces and dashes in registrations still match.
 */
export function SearchPicker<T>({
  items,
  value,
  onChange,
  getId,
  searchText,
  renderValue,
  renderItem,
  placeholder,
  disabled,
  className,
  testId,
  limit = 60,
}: SearchPickerProps<T>) {
  const { t } = useLocale()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const selected = React.useMemo(() => items?.find((i) => getId(i) === value) ?? null, [items, value, getId])
  const shown = React.useMemo(() => {
    const q = searchKey(query)
    const list = items ?? []
    return (q ? list.filter((i) => searchKey(searchText(i)).includes(q)) : list).slice(0, limit)
  }, [items, query, searchText, limit])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        data-testid={testId}
        render={
          <button
            type="button"
            className={cn(
              "flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-input px-3 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60",
              className
            )}
          />
        }
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>
          {selected ? renderValue(selected) : placeholder}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-0">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={placeholder} data-testid={testId ? `${testId}-search` : undefined} />
          <CommandList className="max-h-72">
            <CommandEmpty>{t("shared.picker.none")}</CommandEmpty>
            {shown.map((item) => {
              const id = getId(item)
              return (
                <CommandItem
                  key={id}
                  value={id}
                  data-testid={testId ? `${testId}-option` : undefined}
                  data-id={id}
                  onSelect={() => {
                    onChange(id, item)
                    setOpen(false)
                    setQuery("")
                  }}
                >
                  <span className="min-w-0 flex-1">{renderItem(item)}</span>
                  {id === value ? <Check className="size-4 text-primary" /> : null}
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/* ---------------- Party ---------------- */

export function PartyPicker({
  value,
  onChange,
  kind = "customer",
  className,
  testId = "party-picker",
}: {
  value: Id | null
  onChange: (id: Id | null, party: PartyRow | null) => void
  kind?: "customer" | "vendor" | "all"
  className?: string
  testId?: string
}) {
  const db = useDb()
  const { t, locale } = useLocale()
  const data = useLiveQuery(async () => {
    const parties = await db.parties.toArray()
    const vehicles = await db.vehicles.toArray()
    const counts = new Map<Id, number>()
    for (const v of vehicles) counts.set(v.partyId, (counts.get(v.partyId) ?? 0) + 1)
    return {
      parties: parties.filter((p) => (kind === "all" ? true : kind === "customer" ? p.isCustomer : p.isVendor)),
      counts,
    }
  }, [db, kind])
  return (
    <SearchPicker
      items={data?.parties}
      value={value}
      onChange={onChange}
      getId={(p) => p.id}
      searchText={(p) => `${p.nameEn} ${p.nameBn} ${p.phone} ${p.code}`}
      renderValue={(p) => (
        <>
          {nameOf(p, locale)}{" "}
          <span lang="en" className="font-mono text-xs text-muted-foreground">
            {p.code}
          </span>
        </>
      )}
      renderItem={(p) => (
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{nameOf(p, locale)}</span>
            {p.status !== "active" ? <span className="text-xs text-warning">{t("shared.picker.onHold")}</span> : null}
          </span>
          <span lang="en" className="truncate font-mono text-xs text-muted-foreground">
            {p.code} · {p.phone}
            {data?.counts.get(p.id) ? ` · ${t("shared.picker.vehiclesCount", { count: data.counts.get(p.id)! })}` : ""}
          </span>
        </span>
      )}
      placeholder={t("shared.picker.partyPlaceholder")}
      className={className}
      testId={testId}
    />
  )
}

/* ---------------- Vehicle ---------------- */

export function VehiclePicker({
  value,
  onChange,
  partyId,
  className,
  testId = "vehicle-picker",
}: {
  value: Id | null
  onChange: (id: Id | null, vehicle: VehicleRow | null) => void
  /** Only this party's vehicles */
  partyId?: Id | null
  className?: string
  testId?: string
}) {
  const db = useDb()
  const { t, locale } = useLocale()
  const data = useLiveQuery(async () => {
    const vehicles = partyId ? await db.vehicles.where("partyId").equals(partyId).toArray() : await db.vehicles.toArray()
    const owners = new Map((await db.parties.bulkGet([...new Set(vehicles.map((v) => v.partyId))])).filter(Boolean).map((p) => [p!.id, p!]))
    return vehicles.filter((v) => v.active).map((v) => ({ vehicle: v, owner: owners.get(v.partyId) }))
  }, [db, partyId])
  return (
    <SearchPicker
      items={data}
      value={value}
      onChange={(id, row) => onChange(id, row?.vehicle ?? null)}
      getId={(r) => r.vehicle.id}
      searchText={(r) => `${r.vehicle.regNo} ${r.vehicle.regNoBn} ${r.vehicle.make} ${r.vehicle.model} ${r.owner?.nameEn ?? ""} ${r.owner?.phone ?? ""}`}
      renderValue={(r) => (
        <span className="inline-flex items-center gap-2">
          <RegPlate regNo={r.vehicle.regNo} />
          <span className="truncate">
            {r.vehicle.make} {r.vehicle.model}
          </span>
        </span>
      )}
      renderItem={(r) => (
        <span className="flex items-center gap-2.5">
          <RegPlate regNo={r.vehicle.regNo} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm">
              {r.vehicle.make} {r.vehicle.model} · <span lang="en">{r.vehicle.vehicleClass}</span>
            </span>
            <span className="truncate text-xs text-muted-foreground">{nameOf(r.owner, locale)}</span>
          </span>
        </span>
      )}
      placeholder={t("shared.picker.vehiclePlaceholder")}
      className={className}
      testId={testId}
    />
  )
}

/* ---------------- Item ---------------- */

export function ItemPicker({
  value,
  onChange,
  kinds,
  className,
  testId = "item-picker",
}: {
  value: Id | null
  onChange: (id: Id | null, item: ItemRow | null) => void
  kinds?: ItemRow["kind"][]
  className?: string
  testId?: string
}) {
  const db = useDb()
  const { t, locale } = useLocale()
  const items = useLiveQuery(
    async () => (await db.items.toArray()).filter((i) => i.status === "active" && (!kinds || kinds.includes(i.kind))),
    [db, kinds?.join(",")]
  )
  return (
    <SearchPicker
      items={items}
      value={value}
      onChange={onChange}
      getId={(i) => i.id}
      searchText={(i) => `${i.sku} ${i.nameEn} ${i.nameBn} ${i.barcode}`}
      renderValue={(i) => (
        <>
          <span lang="en" className="font-mono text-xs text-muted-foreground">
            {i.sku}
          </span>{" "}
          {nameOf(i, locale)}
        </>
      )}
      renderItem={(i) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{nameOf(i, locale)}</span>
          <span lang="en" className="font-mono text-xs text-muted-foreground">
            {i.sku} · {i.baseUom}
          </span>
        </span>
      )}
      placeholder={t("shared.picker.itemPlaceholder")}
      className={className}
      testId={testId}
    />
  )
}

/* ---------------- Service ---------------- */

export function ServicePicker({
  value,
  onChange,
  vehicleClass,
  className,
  testId = "service-picker",
}: {
  value: Id | null
  onChange: (id: Id | null, service: ServiceRow | null) => void
  /** Show the class price (retail list) for this vehicle class */
  vehicleClass?: VehicleClass | null
  className?: string
  testId?: string
}) {
  const db = useDb()
  const { t, locale, tk, money } = useLocale()
  const data = useLiveQuery(async () => {
    const services = (await db.services.toArray()).filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder)
    const variants = await db.serviceVariants.toArray()
    const price = new Map<string, number>()
    for (const v of variants) if (!vehicleClass || v.vehicleClass === vehicleClass) {
      const prev = price.get(v.serviceId)
      if (prev === undefined || v.basePriceP < prev) price.set(v.serviceId, v.basePriceP)
    }
    return services.map((s) => ({ service: s, priceP: price.get(s.id) }))
  }, [db, vehicleClass])
  return (
    <SearchPicker
      items={data}
      value={value}
      onChange={(id, row) => onChange(id, row?.service ?? null)}
      getId={(r) => r.service.id}
      searchText={(r) => `${r.service.code} ${r.service.nameEn} ${r.service.nameBn} ${r.service.category}`}
      renderValue={(r) => nameOf(r.service, locale)}
      renderItem={(r) => (
        <span className="flex items-center gap-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{nameOf(r.service, locale)}</span>
            <span className="text-xs text-muted-foreground">
              <span lang="en" className="font-mono">
                {r.service.code}
              </span>{" "}
              · {tk(`reports.enum.category.${r.service.category}`)}
            </span>
          </span>
          {r.priceP !== undefined ? (
            <span className="shrink-0 text-xs tabular-nums">
              {vehicleClass ? <MoneyText poisha={r.priceP} /> : t("shared.picker.fromPrice", { price: money(r.priceP) })}
            </span>
          ) : null}
        </span>
      )}
      placeholder={t("shared.picker.servicePlaceholder")}
      className={className}
      testId={testId}
    />
  )
}

/* ---------------- Account ---------------- */

export function AccountPicker({
  value,
  onChange,
  excludeControl = false,
  className,
  testId = "account-picker",
}: {
  value: Id | null
  onChange: (id: Id | null, account: AccountRow | null) => void
  /** Manual vouchers never post to control accounts (INV-03) */
  excludeControl?: boolean
  className?: string
  testId?: string
}) {
  const db = useDb()
  const { t, locale } = useLocale()
  const accounts = useLiveQuery(
    async () =>
      (await db.accounts.orderBy("code").toArray()).filter((a) => a.active && !a.isGroup && (!excludeControl || !a.isControl)),
    [db, excludeControl]
  )
  return (
    <SearchPicker
      items={accounts}
      value={value}
      onChange={onChange}
      getId={(a) => a.id}
      searchText={(a) => `${a.code} ${a.nameEn} ${a.nameBn} ${a.tag ?? ""}`}
      renderValue={(a) => (
        <>
          <span lang="en" className="font-mono text-muted-foreground">
            {a.code}
          </span>{" "}
          {nameOf(a, locale)}
        </>
      )}
      renderItem={(a) => (
        <span className="flex items-center gap-2">
          <span lang="en" className="w-11 shrink-0 font-mono text-muted-foreground">
            {a.code}
          </span>
          <span className="min-w-0 flex-1 truncate">{nameOf(a, locale)}</span>
          {a.isControl ? <span className="text-[0.625rem] text-muted-foreground">{t("shared.picker.control")}</span> : null}
        </span>
      )}
      placeholder={t("shared.picker.accountPlaceholder")}
      className={className}
      testId={testId}
    />
  )
}

/* ---------------- Location ---------------- */

export function LocationPicker({
  value,
  onChange,
  allowed,
  kinds,
  className,
  testId = "location-picker",
}: {
  value: Id | null
  onChange: (id: Id) => void
  /** Only these location ids (e.g. the user's own) */
  allowed?: readonly Id[]
  kinds?: LocationRow["kind"][]
  className?: string
  testId?: string
}) {
  const db = useDb()
  const { t, locale } = useLocale()
  const locations = useLiveQuery(
    async () =>
      (await db.locations.toArray()).filter(
        (l) => l.active && (!allowed || allowed.includes(l.id)) && (!kinds || kinds.includes(l.kind))
      ),
    [db, allowed?.join(","), kinds?.join(",")]
  )
  const current = locations?.find((l) => l.id === value)
  return (
    <Select value={value ?? ""} onValueChange={(v) => v && onChange(v as Id)}>
      <SelectTrigger className={cn("min-w-40", className)} data-testid={testId} aria-label={t("shared.picker.location")}>
        <SelectValue>{() => (current ? nameOf(current, locale) : t("shared.picker.location"))}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {(locations ?? []).map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {nameOf(l, locale)}{" "}
            <span lang="en" className="ml-auto pl-3 font-mono text-xs text-muted-foreground">
              {l.code}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
