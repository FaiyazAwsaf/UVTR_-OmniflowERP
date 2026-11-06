import type { Ms } from "@/core/db/schema"

import { SERVICE_BY_ID } from "../content/catalogue"
import { BAY, USR } from "../content/seed-refs"
import { MINUTE } from "../time"

/**
 * Capacity scheduling for the itemised history (seed_data.md §7.4): a bay
 * holds one job at a time; a technician works one task at a time inside a
 * 10-hour shift within the studio's 09:00 to 21:00; a job that does not fit
 * moves to the next free slot, the next day if needed. Long tasks continue
 * in the technician's next shift (ceramic and paint jobs span days).
 */

export type Studio = "GUL" | "UTT"

export type Tech = { id: string; start: number; end: number; coating?: boolean }

/** Shifts in minutes from midnight. */
export const TECHS: Record<Studio, Tech[]> = {
  GUL: [
    { id: USR.rakib, start: 9 * 60, end: 19 * 60, coating: true },
    { id: USR.sajib, start: 9 * 60, end: 19 * 60 },
    { id: USR.sohel, start: 9 * 60, end: 19 * 60 },
    { id: USR.monir, start: 11 * 60, end: 21 * 60 },
    { id: USR.faruk, start: 11 * 60, end: 21 * 60 },
  ],
  UTT: [
    { id: USR.jewel, start: 9 * 60, end: 19 * 60 },
    { id: USR.kamrul, start: 9 * 60, end: 19 * 60 },
    { id: USR.polash, start: 11 * 60, end: 21 * 60 },
  ],
}

export type BayDef = { id: string; kind: "wash" | "detailing" | "coating" }

export const BAYS: Record<Studio, BayDef[]> = {
  GUL: [
    { id: BAY.GUL_W1, kind: "wash" },
    { id: BAY.GUL_W2, kind: "wash" },
    { id: BAY.GUL_D1, kind: "detailing" },
    { id: BAY.GUL_D2, kind: "detailing" },
    { id: BAY.GUL_D3, kind: "detailing" },
    { id: BAY.GUL_C1, kind: "coating" },
  ],
  UTT: [
    { id: BAY.UTT_W1, kind: "wash" },
    { id: BAY.UTT_D1, kind: "detailing" },
    { id: BAY.UTT_D2, kind: "detailing" },
    { id: BAY.UTT_C1, kind: "coating" },
  ],
}

const FALLBACK: Record<BayDef["kind"], BayDef["kind"][]> = {
  wash: ["wash", "detailing"],
  detailing: ["detailing", "coating"],
  coating: ["coating", "detailing"],
}

/** The bay kind a job needs: the heaviest of its services. */
export function bayKindFor(serviceIds: string[]): BayDef["kind"] {
  const kinds = serviceIds.map((id) => SERVICE_BY_ID.get(id)?.bay ?? "wash")
  if (kinds.includes("coating")) return "coating"
  if (kinds.includes("detailing")) return "detailing"
  return "wash"
}

export type TaskReq = { minutes: number; coating?: boolean }
export type PlacedTask = { techId: string; start: Ms; end: Ms; minutes: number }
export type Placement = { bayId: string; start: Ms; end: Ms; tasks: PlacedTask[] }

/** The working calendar of one technician: next moment inside a shift, and the end after n working minutes. */
const DAY_MS = 24 * 60 * MINUTE
const DHAKA_MS = 6 * 60 * MINUTE
/** Start of the Dhaka day containing a moment (Dhaka is UTC+6, no daylight saving). */
const dayStart = (t: Ms): Ms => Math.floor((t + DHAKA_MS) / DAY_MS) * DAY_MS - DHAKA_MS

function alignToShift(tech: Tech, t: Ms): Ms {
  let d = dayStart(t)
  for (let i = 0; i < 4; i++) {
    const open = d + tech.start * MINUTE
    const close = d + tech.end * MINUTE
    if (t < open) return open
    if (t < close) return t
    d += DAY_MS
  }
  return t
}

function workEnd(tech: Tech, start: Ms, minutes: number): Ms {
  let t = alignToShift(tech, start)
  let left = minutes * MINUTE
  for (let i = 0; i < 10; i++) {
    const close = dayStart(t) + tech.end * MINUTE
    if (t + left <= close) return t + left
    left -= close - t
    t = alignToShift(tech, close)
  }
  return t + left
}

type Interval = [Ms, Ms]

const clashIn = (lists: Interval[][], t: Ms, end: Ms): Interval | undefined => {
  for (const list of lists) for (const iv of list) if (iv[0] < end && t < iv[1]) return iv
  return undefined
}

/** First moment at or after `from` when [t, t + span(t)) misses every busy interval. */
function firstFree(lists: Interval[][], from: Ms, span: (t: Ms) => Ms, align: (t: Ms) => Ms): Ms {
  let t = align(from)
  for (let guard = 0; guard < 500; guard++) {
    const clash = clashIn(lists, t, span(t))
    if (!clash) return t
    if (clash[1] === Infinity) return Infinity
    t = align(clash[1])
  }
  return Infinity
}

export class StudioScheduler {
  private readonly busy = new Map<string, Interval[]>()

  constructor(
    readonly studio: Studio,
    private readonly techs: Tech[] = TECHS[studio],
    private readonly bays: BayDef[] = BAYS[studio]
  ) {}

  private list(id: string): Interval[] {
    let l = this.busy.get(id)
    if (!l) {
      l = []
      this.busy.set(id, l)
    }
    return l
  }

  /** When a bay or technician's last booked work ends (0 = never used). */
  freeAt(resourceId: string): Ms {
    return this.list(resourceId).reduce((m, [, b]) => (b === Infinity ? m : Math.max(m, b)), 0)
  }

  /** Forget work that ended before a moment (keeps the searches short). */
  prune(before: Ms): void {
    for (const [id, list] of this.busy) this.busy.set(id, list.filter(([, b]) => b >= before))
  }

  /** Make a resource unavailable from a moment on (planted jobs, a locked technician). */
  block(resourceId: string, from: Ms, until: Ms = Infinity): void {
    this.list(resourceId).push([from, until])
  }

  /**
   * Place a job: in each suitable bay, from the desired time, every task with
   * the technician who finishes it first (gaps filled), the bay held from the
   * first task's start to the last task's end. Keeps the bay that finishes
   * first (the job's own bay kind preferred unless another finishes an hour
   * sooner). Does not commit.
   */
  plan(desired: Ms, kind: BayDef["kind"], tasks: TaskReq[], opts: { techs?: string[] } = {}): Placement | null {
    let best: Placement | null = null
    let bestScore = Infinity
    const allowed = opts.techs ? this.techs.filter((t) => opts.techs!.includes(t.id)) : this.techs
    for (const [rank, k] of FALLBACK[kind].entries()) {
      const penalty = rank * 60 * MINUTE
      for (const bay of this.bays.filter((b) => b.kind === k)) {
        const bayBusy = [this.list(bay.id)]
        let t = desired
        for (let attempt = 0; attempt < 60 && t !== Infinity; attempt++) {
          const placed = this.placeTasks(t, tasks, allowed)
          if (!placed) break
          const start = placed[0].start
          const finish = placed[placed.length - 1].end
          const clash = clashIn(bayBusy, start, finish)
          if (!clash) {
            const placement: Placement = { bayId: bay.id, start, end: finish, tasks: placed }
            if (finish + penalty < bestScore) {
              best = placement
              bestScore = finish + penalty
            }
            break
          }
          t = clash[1]
        }
      }
    }
    return best
  }

  private placeTasks(from: Ms, tasks: TaskReq[], allowed: Tech[]): PlacedTask[] | null {
    let cursor = from
    const placed: PlacedTask[] = []
    const extra = new Map<string, Interval[]>()
    for (const task of tasks) {
      let choice: { tech: Tech; start: Ms; end: Ms } | null = null
      for (const tech of allowed) {
        const busy = [this.list(tech.id), extra.get(tech.id) ?? []]
        const start = firstFree(busy, cursor, (t) => workEnd(tech, t, task.minutes), (t) => alignToShift(tech, t))
        if (start === Infinity) continue
        const end = workEnd(tech, start, task.minutes)
        // Coating specialists take coating tasks when they are not much later.
        const score = end - (task.coating && tech.coating ? 45 * MINUTE : 0)
        const bestScore = choice ? choice.end - (task.coating && choice.tech.coating ? 45 * MINUTE : 0) : Infinity
        if (score < bestScore) choice = { tech, start, end }
      }
      if (!choice) return null
      placed.push({ techId: choice.tech.id, start: choice.start, end: choice.end, minutes: task.minutes })
      const mine = extra.get(choice.tech.id) ?? []
      mine.push([choice.start, choice.end])
      extra.set(choice.tech.id, mine)
      cursor = choice.end
    }
    return placed
  }

  commit(p: Placement): void {
    this.list(p.bayId).push([p.start, p.end])
    for (const t of p.tasks) this.list(t.techId).push([t.start, t.end])
  }
}

/** When a technician finishes `minutes` of work started at `start` (shift calendar). */
export function taskEnd(techId: string, start: Ms, minutes: number): Ms {
  const tech = [...TECHS.GUL, ...TECHS.UTT].find((t) => t.id === techId)
  if (!tech) throw new Error(`seed: unknown technician ${techId}`)
  return workEnd(tech, start, minutes)
}
