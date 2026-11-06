import type { Id, Ms, SalesOrderStatus, VehicleClass } from "@/core/db/schema"

import { BAY, PL, PLANT, SVC, USR } from "../content/seed-refs"
import type { EventQueue } from "../engine/events"
import type { World } from "../engine/world"
import { dhakaAt, dhakaDate, isoAddDays, MINUTE } from "../time"
import { priceJob } from "./jobs"
import type { PartiesOut, PoolCustomer } from "./parties"
import {
  ADVISOR,
  CASHIER,
  invoiceLinesOf,
  MANAGER,
  STUDIO_LOC,
  writeCounterReceipt,
  writeInvoice,
  writeOrder,
  type TaskState,
} from "./sales-docs"
import { taskEnd, type Studio } from "./scheduler"

/**
 * Today at 10:30 (seed_data.md §8): per studio the jobs booked later today,
 * in progress, in QC, ready and delivered since 09:00; the ceramic or paint
 * job continuing from yesterday in Gulshan's D3; Gulshan's C1 free and
 * Rakib free from 11:00; Uttara's C1 holding E3's booked job (Jewel and
 * Kamrul work Uttara today; Polash is locked).
 */

type Plan = {
  id?: Id
  studio: Studio
  services: string[]
  cls: VehicleClass
  bay: Id
  tasks: { tech: Id; start: Ms; state: TaskState }[]
  status: SalesOrderStatus
  bookedAt: Ms
  qcAt?: Ms
  readyAt?: Ms
  deliveredAt?: Ms
  pay?: "cash" | "card" | "bkash"
  deposit?: { at: Ms; amountP: number; method: "cash" | "bkash" }
  customer?: PoolCustomer
}

export function seedTodayBoard(w: World, q: EventQueue, parties: PartiesOut, d3Start: Ms): void {
  const rng = w.rng("today-board")
  const today = w.cal.today
  const yesterday = w.cal.yesterday
  const t = (hhmm: string) => dhakaAt(today, hhmm)
  const used = new Set<string>()
  const customerWith = (cls: VehicleClass): PoolCustomer => {
    const options = parties.retail.filter((c) => !used.has(c.partyId) && c.vehicles.some((v) => v.cls === cls))
    const c = options.length ? rng.pick(options) : rng.pick(parties.retail)
    used.add(c.partyId)
    return c
  }

  const plans: Plan[] = [
    /* Gulshan: delivered and paid since 09:00 (2) */
    { studio: "GUL", services: [SVC.WSH_EXP], cls: "SD", bay: BAY.GUL_W1, tasks: [{ tech: USR.rakib, start: t("09:00"), state: "done" }], status: "closed", bookedAt: t("08:50"), qcAt: t("09:45"), readyAt: t("09:45"), deliveredAt: t("10:00"), pay: "card" },
    { studio: "GUL", services: [SVC.WSH_EXP], cls: "HB", bay: BAY.GUL_W2, tasks: [{ tech: USR.sajib, start: t("09:00"), state: "done" }], status: "closed", bookedAt: t("08:55"), qcAt: t("09:40"), readyAt: t("09:40"), deliveredAt: t("09:55"), pay: "cash" },
    /* In QC (1), ready (1) */
    { studio: "GUL", services: [SVC.WSH_EXP], cls: "SD", bay: BAY.GUL_W2, tasks: [{ tech: USR.sajib, start: t("09:35"), state: "done" }], status: "qc", bookedAt: t("09:20"), qcAt: t("10:15") },
    { studio: "GUL", services: [SVC.WSH_PRM], cls: "HB", bay: BAY.GUL_D2, tasks: [{ tech: USR.sohel, start: t("09:00"), state: "done" }], status: "ready", bookedAt: t("08:45"), qcAt: t("10:15"), readyAt: t("10:20") },
    /* In progress (3: W1, D1, D2); Rakib free from 11:00 */
    { studio: "GUL", services: [SVC.WSH_EXP], cls: "LSUV", bay: BAY.GUL_W1, tasks: [{ tech: USR.rakib, start: t("10:05"), state: "in-progress" }], status: "in-progress", bookedAt: t("09:55") },
    { studio: "GUL", services: [SVC.INT_DEEP], cls: "SD", bay: BAY.GUL_D1, tasks: [{ tech: USR.sajib, start: t("10:15"), state: "in-progress" }], status: "in-progress", bookedAt: t("09:40") },
    { studio: "GUL", services: [SVC.INT_LTH], cls: "SD", bay: BAY.GUL_D2, tasks: [{ tech: USR.sohel, start: t("10:20"), state: "in-progress" }], status: "in-progress", bookedAt: t("10:00") },
    /* Booked later today (4): Monir, Sajib and Sohel; never Rakib, never C1 or D3 */
    { studio: "GUL", services: [SVC.WSH_PRM], cls: "SUV", bay: BAY.GUL_W2, tasks: [{ tech: USR.monir, start: t("11:30"), state: "queued" }], status: "booked", bookedAt: t("09:35") },
    { studio: "GUL", services: [SVC.WSH_EXP], cls: "SD", bay: BAY.GUL_W1, tasks: [{ tech: USR.monir, start: t("13:30"), state: "queued" }], status: "booked", bookedAt: t("10:10") },
    { studio: "GUL", services: [SVC.INT_DEEP], cls: "SUV", bay: BAY.GUL_D1, tasks: [{ tech: USR.monir, start: t("14:30"), state: "queued" }], status: "booked", bookedAt: dhakaAt(yesterday, "17:20") },
    {
      studio: "GUL", services: [SVC.PRT_WAX], cls: "SD", bay: BAY.GUL_D2, tasks: [{ tech: USR.sohel, start: t("16:00"), state: "queued" }], status: "booked",
      bookedAt: dhakaAt(isoAddDays(today, -2), "18:10"), deposit: { at: dhakaAt(isoAddDays(today, -2), "18:12"), amountP: 1_000_00, method: "cash" },
    },

    /* Uttara: delivered and paid (1), QC (1), ready (1) */
    { studio: "UTT", services: [SVC.WSH_EXP], cls: "SD", bay: BAY.UTT_W1, tasks: [{ tech: USR.jewel, start: t("09:00"), state: "done" }], status: "closed", bookedAt: t("08:50"), qcAt: t("09:45"), readyAt: t("09:45"), deliveredAt: t("09:55"), pay: "bkash" },
    { studio: "UTT", services: [SVC.WSH_EXP], cls: "HB", bay: BAY.UTT_D1, tasks: [{ tech: USR.kamrul, start: t("09:00"), state: "done" }], status: "qc", bookedAt: t("08:52"), qcAt: t("09:35") },
    { studio: "UTT", services: [SVC.WSH_EXP], cls: "HB", bay: BAY.UTT_D2, tasks: [{ tech: USR.jewel, start: t("09:40"), state: "done" }], status: "ready", bookedAt: t("09:30"), qcAt: t("10:15"), readyAt: t("10:20") },
    /* In progress (2: W1 Jewel, D1 Kamrul) */
    { studio: "UTT", services: [SVC.WSH_PRM], cls: "SD", bay: BAY.UTT_W1, tasks: [{ tech: USR.jewel, start: t("10:20"), state: "in-progress" }], status: "in-progress", bookedAt: t("10:05") },
    { studio: "UTT", services: [SVC.INT_DEEP], cls: "HB", bay: BAY.UTT_D1, tasks: [{ tech: USR.kamrul, start: t("09:40"), state: "in-progress" }], status: "in-progress", bookedAt: t("09:35") },
    /* Booked later today (3), E3's SUV ceramic 2-year job in C1 among them */
    {
      id: PLANT.e3Order, studio: "UTT", services: [SVC.PRT_CC2], cls: "SUV", bay: BAY.UTT_C1, tasks: [{ tech: USR.kamrul, start: t("13:30"), state: "queued" }], status: "booked",
      bookedAt: dhakaAt(yesterday, "16:40"),
    },
    { studio: "UTT", services: [SVC.WSH_EXP], cls: "SD", bay: BAY.UTT_W1, tasks: [{ tech: USR.jewel, start: t("12:00"), state: "queued" }], status: "booked", bookedAt: t("10:25") },
    { studio: "UTT", services: [SVC.WSH_PRM], cls: "SUV", bay: BAY.UTT_W1, tasks: [{ tech: USR.jewel, start: t("15:00"), state: "queued" }], status: "booked", bookedAt: t("09:10") },
  ]

  for (const p of plans) writePlanned(w, q, p, customerWith(p.cls))

  // The paint correction continuing from yesterday in Gulshan's D3 (Faruk): decontamination done yesterday.
  const d3Customer = customerWith("SUV")
  const lines = priceJob({ serviceIds: [SVC.PNT_DCN, SVC.PNT_C2], addOnIds: [] }, "SUV", PL.retail, 0)
  const dcnEnd = taskEnd(USR.faruk, d3Start, lines[0].durationMin)
  const c2End = taskEnd(USR.faruk, dcnEnd, lines[1].durationMin)
  const bookedAt = dhakaAt(isoAddDays(yesterday, -1), "17:45")
  const vehicle = d3Customer.vehicles.find((v) => v.cls === "SUV") ?? d3Customer.vehicles[0]
  const { order } = writeOrder(w, q, {
    id: PLANT.gulD3Order,
    studio: "GUL",
    partyId: d3Customer.partyId,
    vehicleId: vehicle.id,
    cls: "SUV",
    lines,
    priceListId: PL.retail,
    discountPct: 0,
    advisorId: ADVISOR.GUL,
    bookedAt,
    bayId: BAY.GUL_D3,
    tasks: [
      { techId: USR.faruk, start: d3Start, end: dcnEnd, minutes: lines[0].durationMin, state: "done" },
      { techId: USR.faruk, start: dcnEnd, end: c2End, minutes: lines[1].durationMin, state: "in-progress" },
    ],
    status: "in-progress",
    advanceP: 10_000_00,
  })
  writeCounterReceipt(w, { studio: "GUL", partyId: d3Customer.partyId, date: dhakaDate(bookedAt), at: bookedAt + 2 * MINUTE, method: "bkash", amountP: 10_000_00, orderId: order.id, takenBy: ADVISOR.GUL, rule: "R3" })
}

function writePlanned(w: World, q: EventQueue, p: Plan, customer: PoolCustomer) {
  const vehicle = customer.vehicles.find((v) => v.cls === p.cls) ?? customer.vehicles[0]
  const cls = vehicle.cls
  const lines = priceJob({ serviceIds: p.services, addOnIds: [] }, cls, PL.retail, 0)
  const tasks = p.tasks.map((task, i) => {
    const minutes = lines[i].durationMin
    return { techId: task.tech, start: task.start, end: taskEnd(task.tech, task.start, minutes), minutes, state: task.state }
  })
  const advisorId = ADVISOR[p.studio]
  const deposit = p.deposit
  const { order, lines: orderLines } = writeOrder(w, q, {
    id: p.id ?? w.ctx.seq("so"),
    studio: p.studio,
    partyId: customer.partyId,
    vehicleId: vehicle.id,
    cls,
    lines,
    priceListId: PL.retail,
    discountPct: 0,
    advisorId,
    bookedAt: p.bookedAt,
    bayId: p.bay,
    tasks,
    status: p.status,
    qc: p.readyAt ? { failFirst: false, at: p.readyAt, by: MANAGER[p.studio] } : undefined,
    qcAt: p.qcAt,
    readyAt: p.readyAt,
    deliveredAt: p.deliveredAt,
    invoicedAt: p.deliveredAt ? p.deliveredAt + MINUTE : undefined,
    closedAt: p.deliveredAt ? p.deliveredAt + 2 * MINUTE : undefined,
    advanceP: deposit?.amountP ?? 0,
  })
  if (deposit) {
    writeCounterReceipt(w, { studio: p.studio, partyId: customer.partyId, date: dhakaDate(deposit.at), at: deposit.at, method: deposit.method, amountP: deposit.amountP, orderId: order.id, takenBy: advisorId, rule: "R3", tenderedP: deposit.method === "cash" ? deposit.amountP : undefined })
  }
  if (p.deliveredAt && p.pay) {
    const cashier = CASHIER[p.studio]
    const invoice = writeInvoice(w, {
      loc: STUDIO_LOC[p.studio],
      partyId: customer.partyId,
      orderIds: [order.id],
      date: w.cal.today,
      at: p.deliveredAt + MINUTE,
      dueDate: w.cal.today,
      kind: "counter",
      lines: invoiceLinesOf(orderLines, { vehicleId: vehicle.id, advisorId }),
      advanceAppliedP: 0,
      issuedBy: cashier,
    })
    const due = invoice.totalP
    writeCounterReceipt(w, {
      studio: p.studio,
      partyId: customer.partyId,
      date: w.cal.today,
      at: p.deliveredAt + 2 * MINUTE,
      method: p.pay,
      amountP: due,
      invoice,
      takenBy: cashier,
      rule: p.pay === "bkash" ? "R9" : "R7",
      tenderedP: p.pay === "cash" ? Math.ceil(due / 500_00) * 500_00 : undefined,
    })
    const v = w.ctx.bag.get("vehicles", vehicle.id)
    v.lastServiceAt = Math.max(v.lastServiceAt ?? 0, p.deliveredAt)
  }
}
