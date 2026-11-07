import { describe, expect, it } from "vitest"

import { built, rows } from "./helpers"

/**
 * Synthetic phone numbers look like real Bangladeshi mobiles (11 digits,
 * 01 + operator 3 to 9, written 01XXX-XXXXXX): parties, their contact
 * persons and staff. A 12-digit number on a Mushak 6.3 or a party page
 * would be the first thing a local client notices.
 */
const MOBILE = /^01[3-9]\d{2}-\d{6}$/

describe("seeded phone numbers", () => {
  it("are 11-digit Bangladeshi mobiles for parties, contacts and users", () => {
    const { bag } = built("small")
    const bad: string[] = []
    for (const p of rows(bag, "parties")) {
      if (p.phone && !MOBILE.test(p.phone)) bad.push(`${p.code} ${p.phone}`)
      for (const c of p.contacts)
        if (c.phone && !MOBILE.test(c.phone))
          bad.push(`${p.code} contact ${c.phone}`)
    }
    for (const u of rows(bag, "users"))
      if (u.phone && !MOBILE.test(u.phone)) bad.push(`${u.username} ${u.phone}`)
    expect(bad).toEqual([])
  })
})
