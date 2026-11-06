import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"

/**
 * Simulated password hash (plan §3.8): sha256(username + ":" + password).
 * Not a real password scheme; it only makes the demo's sign-in rules real.
 */
export function hashPassword(username: string, password: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${username.toLowerCase()}:${password}`)))
}
