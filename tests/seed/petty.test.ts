import { describe, expect, it } from "vitest"

import { PLANT } from "@/core/seed/content/seed-refs"

import { built, gl, rows } from "./helpers"

/**
 * The planted ৳3,500 petty cash voucher at Gulshan (seed_data §8) waits for
 * Shahriar's approval: the box must hold it on every date, the last day of a
 * month (before the 17:00 top-up) included, or approving it would be refused.
 */
describe("planted petty cash voucher", () => {
  for (const scale of ["full", "small"] as const) {
    it(`Gulshan's petty cash covers it today (${scale})`, () => {
      const { bag } = built(scale)
      const voucher = rows(bag, "pettyCashVouchers").find((v) => v.id === PLANT.pendingPettyCash)
      expect(voucher?.status).toBe("pending-approval")
      const balance = gl(rows(bag, "journalLines"), "PETTY_GUL")
      expect(balance).toBeGreaterThanOrEqual(voucher!.amountP)
    })
  }
})
