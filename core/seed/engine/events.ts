import type { ISODate, Id, Ms } from "@/core/db/schema"

/**
 * Stock events of the itemised window, run in time order after the stock
 * plan is settled (opening at the cutover, goods received, transfers, job
 * consumption, counter sales). `demand` is the quantity view the planner
 * uses before any value exists.
 */

export type StockEvent = { at: Ms; seq: number; run: () => void }
export type Demand = { itemId: Id; loc: Id; qty: number; at: Ms; date: ISODate }

export class EventQueue {
  readonly events: StockEvent[] = []
  readonly demand: Demand[] = []
  private seq = 0

  add(at: Ms, run: () => void): void {
    this.events.push({ at, seq: this.seq++, run })
  }

  need(d: Demand): void {
    this.demand.push(d)
  }

  /** Run every event in time order (ties keep the order they were added). */
  runAll(): void {
    const list = [...this.events].sort((a, b) => a.at - b.at || a.seq - b.seq)
    this.events.length = 0
    for (const e of list) e.run()
  }
}
