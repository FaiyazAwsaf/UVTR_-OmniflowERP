import type { Id, NotificationRow, Refs, SmsRow } from "@/core/db/schema"
import type { Tx } from "@/core/engine/types"
import type { Locale } from "@/lib/i18n/config"
import { renderSms, type SmsTemplateId } from "@/modules/comms/templates"

/** GSM-7 basic characters (approximation); anything else forces UCS-2. */
const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅå_ÆæßÉ!"#%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/

/** Characters per part: one-part limit and multi-part size (plan §3.17). */
const LIMITS = { GSM: { single: 160, multi: 153 }, "UCS-2": { single: 70, multi: 67 } } as const

/** Parts and encoding of an SMS (Bangla uses UCS-2, 70/67 characters). */
export function smsParts(text: string): { parts: number; encoding: "GSM" | "UCS-2" } {
  const encoding = GSM.test(text) ? "GSM" : "UCS-2"
  const limits = LIMITS[encoding]
  const length = [...text].length
  const parts = length <= limits.single ? 1 : Math.ceil(length / limits.multi)
  return { parts, encoding }
}

/**
 * Queue a simulated SMS inside a command (plan §3.17). Templates carry only
 * document numbers, dates and amounts (§11), never vehicle condition notes
 * or staff remarks. The `comms.sms` sweeper marks it delivered after ~2 s.
 */
export function queueSms(
  tx: Tx,
  opts: {
    to: string
    partyId?: Id
    lang: Locale
    templateId: SmsTemplateId
    params?: Record<string, string | number>
    kind?: SmsRow["kind"]
  }
): SmsRow {
  const text = renderSms(opts.templateId, opts.lang, opts.params ?? {})
  const { parts, encoding } = smsParts(text)
  return tx.insert("sms", {
    to: opts.to,
    partyId: opts.partyId,
    locationId: tx.actor.locationId ?? undefined,
    lang: opts.lang,
    templateId: opts.templateId,
    text,
    parts,
    encoding,
    kind: opts.kind ?? "transactional",
    status: "queued",
    queuedAt: tx.now(),
  })
}

/**
 * In-app notification for a user (approvals inbox bell, plan §3.12). The
 * title is an i18n key so each window shows it in its own language.
 */
export function notifyUser(
  tx: Tx,
  opts: {
    userId: Id
    kind: string
    titleKey: string
    params?: Record<string, string | number>
    refs?: Refs
    href?: string
  }
): NotificationRow {
  return tx.insert("notifications", {
    userId: opts.userId,
    kind: opts.kind,
    titleKey: opts.titleKey,
    params: opts.params ?? {},
    refs: opts.refs ?? {},
    href: opts.href,
    read: false,
    at: tx.now(),
  })
}
