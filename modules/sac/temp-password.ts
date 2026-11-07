/**
 * One-time temporary passwords (simulated, plan §6.2 sac.resetPassword). A
 * readable "Word-1234" shape derived from a seed (the commit id), so a
 * command stays deterministic inside its transaction and the password always
 * meets the policy (more than 8 characters, with a digit).
 */

const CONSONANTS = "bdfghkmnprstvz"
const VOWELS = "aeiou"

function hash(seed: string, salt: number): number {
  let h = 0x811c9dc5 ^ salt
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function tempPasswordFor(seed: string): string {
  const pick = (alphabet: string, salt: number) => alphabet[hash(seed, salt) % alphabet.length]
  const word =
    pick(CONSONANTS, 1).toUpperCase() + pick(VOWELS, 2) + pick(CONSONANTS, 3) + pick(VOWELS, 4) + pick(CONSONANTS, 5)
  const digits = String(1000 + (hash(seed, 6) % 9000))
  return `${word}-${digits}`
}
