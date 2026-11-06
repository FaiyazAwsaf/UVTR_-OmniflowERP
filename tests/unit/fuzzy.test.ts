import { describe, expect, it } from "vitest"

import {
  DUPLICATE_THRESHOLD,
  nameKeys,
  nameSimilarity,
  normalizeName,
  scoreDuplicate,
} from "@/core/search/fuzzy"

describe("name normalisation", () => {
  it("collapses common Bangladeshi spelling variants", () => {
    expect(normalizeName("Md. Rafiqul Islam")).toEqual(normalizeName("Mohammad Rafiqul Islam"))
    expect(normalizeName("Rokeya Begom")).toEqual(normalizeName("Rokeya Begum"))
    expect(normalizeName("Salma Akhter")).toEqual(normalizeName("Salma Akter"))
  })

  it("folds Bangla honorific abbreviations", () => {
    expect(normalizeName("মোঃ রফিকুল ইসলাম")[0]).toBe(normalizeName("মোহাম্মদ রফিকুল ইসলাম")[0])
  })

  it("builds search keys from both scripts", () => {
    const keys = nameKeys("Md. Rafiqul Islam", "মোঃ রফিকুল ইসলাম")
    expect(keys.length).toBeGreaterThan(2)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe("party duplicate scoring (plan §6.2)", () => {
  const existing = { nameEn: "Md. Rafiqul Islam", phone: "01819-000001" }

  it("flags a spelling variant with the same phone", () => {
    expect(nameSimilarity("Mohammad Rafiqul Islam", existing.nameEn)).toBe(1)
    const { score, reasons } = scoreDuplicate(
      { nameEn: "Mohammad Rafiqul Islam", phone: "01819000001" },
      existing
    )
    expect(score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD)
    expect(reasons).toEqual(["name", "phone"])
  })

  it("treats an exact NID or BIN as certain and a different party as no match", () => {
    expect(scoreDuplicate({ nameEn: "X", nid: "123" }, { ...existing, nid: "123" }).score).toBe(1)
    expect(scoreDuplicate({ nameEn: "Y", bin: "000111-0101" }, { ...existing, bin: "000111-0101" }).score).toBe(1)
    expect(scoreDuplicate({ nameEn: "Salma Khatun", phone: "01711-999999" }, existing).score).toBeLessThan(
      DUPLICATE_THRESHOLD
    )
  })
})
