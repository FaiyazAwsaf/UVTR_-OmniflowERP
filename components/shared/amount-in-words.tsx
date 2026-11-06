"use client"

import type { Locale } from "@/lib/i18n/config"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Amounts in words for printed documents (Mushak 6.3 totals, receipts,
 * cheques), in the Bangladeshi system: crore, lakh, thousand, hundred.
 * "Taka One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty
 * Poisha only"; in Bangla "এক লক্ষ তেইশ হাজার চারশত ছাপ্পান্ন টাকা পঞ্চাশ পয়সা মাত্র".
 */

const EN_ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
]
const EN_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

const BN_0_99 = [
  "", "এক", "দুই", "তিন", "চার", "পাঁচ", "ছয়", "সাত", "আট", "নয়", "দশ",
  "এগারো", "বারো", "তেরো", "চৌদ্দ", "পনেরো", "ষোলো", "সতেরো", "আঠারো", "উনিশ", "বিশ",
  "একুশ", "বাইশ", "তেইশ", "চব্বিশ", "পঁচিশ", "ছাব্বিশ", "সাতাশ", "আটাশ", "ঊনত্রিশ", "ত্রিশ",
  "একত্রিশ", "বত্রিশ", "তেত্রিশ", "চৌত্রিশ", "পঁয়ত্রিশ", "ছত্রিশ", "সাঁইত্রিশ", "আটত্রিশ", "ঊনচল্লিশ", "চল্লিশ",
  "একচল্লিশ", "বিয়াল্লিশ", "তেতাল্লিশ", "চুয়াল্লিশ", "পঁয়তাল্লিশ", "ছেচল্লিশ", "সাতচল্লিশ", "আটচল্লিশ", "ঊনপঞ্চাশ", "পঞ্চাশ",
  "একান্ন", "বাহান্ন", "তিপ্পান্ন", "চুয়ান্ন", "পঞ্চান্ন", "ছাপ্পান্ন", "সাতান্ন", "আটান্ন", "ঊনষাট", "ষাট",
  "একষট্টি", "বাষট্টি", "তেষট্টি", "চৌষট্টি", "পঁয়ষট্টি", "ছেষট্টি", "সাতষট্টি", "আটষট্টি", "ঊনসত্তর", "সত্তর",
  "একাত্তর", "বাহাত্তর", "তিয়াত্তর", "চুয়াত্তর", "পঁচাত্তর", "ছিয়াত্তর", "সাতাত্তর", "আটাত্তর", "ঊনআশি", "আশি",
  "একাশি", "বিরাশি", "তিরাশি", "চুরাশি", "পঁচাশি", "ছিয়াশি", "সাতাশি", "আটাশি", "ঊননব্বই", "নব্বই",
  "একানব্বই", "বিরানব্বই", "তিরানব্বই", "চুরানব্বই", "পঁচানব্বই", "ছিয়ানব্বই", "সাতানব্বই", "আটানব্বই", "নিরানব্বই",
]

function en99(n: number): string {
  if (n < 20) return EN_ONES[n]
  return [EN_TENS[Math.floor(n / 10)], EN_ONES[n % 10]].filter(Boolean).join(" ")
}

/** Integer to words, Bangladeshi grouping (crore, lakh, thousand, hundred). */
export function numberToWords(n: number, locale: Locale): string {
  n = Math.floor(Math.abs(n))
  if (n === 0) return locale === "bn" ? "শূন্য" : "Zero"
  const two = (x: number) => (locale === "bn" ? BN_0_99[x] : en99(x))
  const parts: string[] = []
  const crore = Math.floor(n / 1_00_00_000)
  const rest = n % 1_00_00_000
  if (crore) parts.push(`${numberToWords(crore, locale)} ${locale === "bn" ? "কোটি" : "Crore"}`)
  const lakh = Math.floor(rest / 1_00_000)
  const thousand = Math.floor((rest % 1_00_000) / 1_000)
  const hundred = Math.floor((rest % 1_000) / 100)
  const last = rest % 100
  if (lakh) parts.push(`${two(lakh)} ${locale === "bn" ? "লক্ষ" : "Lakh"}`)
  if (thousand) parts.push(`${two(thousand)} ${locale === "bn" ? "হাজার" : "Thousand"}`)
  if (hundred) parts.push(locale === "bn" ? `${BN_0_99[hundred]}শত` : `${EN_ONES[hundred]} Hundred`)
  if (last) parts.push(two(last))
  return parts.join(" ")
}

/** Poisha to words with Taka and Poisha. */
export function amountInWords(poisha: number, locale: Locale): string {
  const taka = Math.floor(Math.abs(poisha) / 100)
  const paisa = Math.abs(poisha) % 100
  if (locale === "bn") {
    const takaPart = `${numberToWords(taka, "bn")} টাকা`
    return paisa ? `${takaPart} ${numberToWords(paisa, "bn")} পয়সা মাত্র` : `${takaPart} মাত্র`
  }
  const takaPart = `Taka ${numberToWords(taka, "en")}`
  return paisa ? `${takaPart} and ${numberToWords(paisa, "en")} Poisha only` : `${takaPart} only`
}

export function AmountInWords({ poisha, locale, className }: { poisha: number; locale?: Locale; className?: string }) {
  const { locale: windowLocale } = useLocale()
  return <span className={className}>{amountInWords(poisha, locale ?? windowLocale)}</span>
}
