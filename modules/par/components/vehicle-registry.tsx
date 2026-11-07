"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"

import { DateText } from "@/components/shared/date-text"
import { PageHeader } from "@/components/shared/page-header"
import { RegPlate } from "@/components/shared/reg-plate"
import { useDb } from "@/core/db/DbProvider"
import type { PartyRow, VehicleRow } from "@/core/db/schema"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { regSearchKey, VEHICLE_CLASS_LIST } from "../lib"
import {
  CsvButton,
  ListTable,
  NativeSelect,
  SearchBox,
  type Column,
} from "./kit"

type Row = { vehicle: VehicleRow; owner: PartyRow | undefined; key: string }

/** /par/vehicles: the vehicle registry, searchable by registration in Latin or Bangla digits. */
export function VehicleRegistry() {
  const db = useDb()
  const params = useSearchParams()
  const focus = params.get("id")
  const { t, tk, locale, num, colour } = useLocale()
  const [query, setQuery] = React.useState("")
  const [cls, setCls] = React.useState("")

  const data = useLiveQuery(async () => {
    const [vehicles, parties] = await Promise.all([
      db.vehicles.toArray(),
      db.parties.toArray(),
    ])
    const byId = new Map(parties.map((p) => [p.id, p]))
    return vehicles
      .sort((a, b) => a.regNo.localeCompare(b.regNo))
      .map((vehicle) => {
        const owner = byId.get(vehicle.partyId)
        return {
          vehicle,
          owner,
          key: regSearchKey(
            `${vehicle.regNo} ${vehicle.regNoBn} ${vehicle.make} ${vehicle.model} ${owner?.nameEn ?? ""} ${owner?.nameBn ?? ""} ${owner?.phone ?? ""}`
          ),
        }
      })
  }, [db])

  const rows = React.useMemo(() => {
    const q = regSearchKey(query)
    let list = (data ?? []).filter(
      (r) =>
        (!cls || r.vehicle.vehicleClass === cls) && (!q || r.key.includes(q))
    )
    if (focus && !q) {
      const hit = list.find((r) => r.vehicle.id === focus)
      if (hit) list = [hit, ...list.filter((r) => r !== hit)]
    }
    return list
  }, [data, query, cls, focus])

  const columns: Column<Row>[] = [
    {
      key: "reg",
      header: t("par.registry.colReg"),
      sortValue: (r) => r.vehicle.regNo,
      cell: (r) => <RegPlate regNo={r.vehicle.regNo} />,
    },
    {
      key: "vehicle",
      header: t("par.registry.colVehicle"),
      sortValue: (r) => `${r.vehicle.make} ${r.vehicle.model}`,
      cell: (r) => (
        <span
          className={cn("flex flex-col", !r.vehicle.active && "opacity-60")}
        >
          <span className="font-medium">
            {r.vehicle.make} {r.vehicle.model}
          </span>
          <span lang="bn" className="text-xs text-muted-foreground">
            {r.vehicle.regNoBn}
          </span>
        </span>
      ),
    },
    {
      key: "class",
      header: t("par.registry.colClass"),
      hide: "sm",
      cell: (r) => tk(`reports.enum.vehicleClass.${r.vehicle.vehicleClass}`),
    },
    {
      key: "colour",
      header: t("par.registry.colColour"),
      hide: "lg",
      cell: (r) => colour(r.vehicle.colour),
    },
    {
      key: "year",
      header: t("par.registry.colYear"),
      hide: "lg",
      align: "right",
      sortValue: (r) => r.vehicle.year,
      cell: (r) => num(r.vehicle.year, { useGrouping: false }),
    },
    {
      key: "owner",
      header: t("par.registry.colOwner"),
      hide: "md",
      sortValue: (r) => r.owner?.nameEn ?? "",
      cell: (r) =>
        r.owner ? (
          <Link
            href={`/par/${r.owner.id}`}
            className="text-link hover:underline"
          >
            {nameOf(r.owner, locale)}
          </Link>
        ) : (
          "-"
        ),
    },
    {
      key: "last",
      header: t("par.registry.colLastService"),
      hide: "lg",
      sortValue: (r) => r.vehicle.lastServiceAt ?? 0,
      cell: (r) =>
        r.vehicle.lastServiceAt ? (
          <DateText value={r.vehicle.lastServiceAt} />
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
  ]

  return (
    <div className="flex flex-col gap-4" data-testid="vehicle-registry">
      <PageHeader
        title={t("par.pages.vehicles")}
        subtitle={t("par.registry.subtitle")}
        actions={
          <CsvButton
            exportKey="par.export"
            fileName="vehicles"
            rows={rows.map((r) => ({
              regNo: r.vehicle.regNo,
              make: r.vehicle.make,
              model: r.vehicle.model,
              vehicleClass: r.vehicle.vehicleClass,
              owner: r.owner?.nameEn ?? "",
            }))}
            columns={[
              { key: "regNo", label: t("par.registry.colReg") },
              { key: "make", label: t("par.vehicle.make") },
              { key: "model", label: t("par.vehicle.model") },
              { key: "vehicleClass", label: t("par.registry.colClass") },
              { key: "owner", label: t("par.registry.colOwner") },
            ]}
          />
        }
      />
      <section className="surface-card flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder={t("par.registry.searchPlaceholder")}
            testId="vehicle-search"
          />
          <NativeSelect
            value={cls}
            onChange={setCls}
            placeholder={t("common.all")}
            ariaLabel={t("par.registry.colClass")}
            className="w-48"
            options={VEHICLE_CLASS_LIST.map((c) => ({
              value: c,
              label: tk(`reports.enum.vehicleClass.${c}`),
            }))}
          />
          <span className="ml-auto text-xs text-muted-foreground">
            {t("par.registry.count", { count: num(rows.length) })}
          </span>
        </div>
        <ListTable
          rows={data ? rows : undefined}
          columns={columns}
          rowKey={(r) => r.vehicle.id}
          rowTestId="vehicle-row"
          rowAttrs={(r) => ({
            reg: r.vehicle.regNo,
            "vehicle-id": r.vehicle.id,
          })}
          rowClassName={(r) =>
            r.vehicle.id === focus ? "bg-primary-soft" : undefined
          }
        />
      </section>
    </div>
  )
}
