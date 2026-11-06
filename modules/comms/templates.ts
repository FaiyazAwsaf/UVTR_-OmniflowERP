import { tenant } from "@/config/brand.config"
import type { Locale } from "@/lib/i18n/config"

/**
 * SMS templates (plan P1.8, §11). Messages carry ONLY document numbers,
 * dates and amounts: never vehicle condition notes, QC remarks or staff
 * comments. Identifiers stay in Latin digits. Params fill {name} placeholders.
 */
export const SMS_TEMPLATES = {
  "booking-confirmed": {
    en: "{tenant}: Booking {orderNo} confirmed for {date} at {time}. Deposit {amount} received. Help: {helpline}",
    bn: "{tenant}: বুকিং {orderNo} নিশ্চিত, {date} তারিখ {time}। অগ্রিম {amount} গ্রহণ করা হয়েছে। সহায়তা: {helpline}",
  },
  "vehicle-ready": {
    en: "{tenant}: Your vehicle for order {orderNo} is ready for collection. Help: {helpline}",
    bn: "{tenant}: অর্ডার {orderNo}-এর আপনার গাড়ি সংগ্রহের জন্য প্রস্তুত। সহায়তা: {helpline}",
  },
  "payment-received": {
    en: "{tenant}: Payment of {amount} received. Receipt {receiptNo}. Thank you.",
    bn: "{tenant}: {amount} পেমেন্ট গ্রহণ করা হয়েছে। রসিদ {receiptNo}। ধন্যবাদ।",
  },
  "invoice-due": {
    en: "{tenant}: Invoice {invoiceNo} of {amount} was due on {date}. Please arrange payment. Help: {helpline}",
    bn: "{tenant}: চালান {invoiceNo}-এর {amount} পরিশোধের তারিখ ছিল {date}। অনুগ্রহ করে পরিশোধ করুন। সহায়তা: {helpline}",
  },
  "cheque-bounced": {
    en: "{tenant}: Cheque {chequeNo} of {amount} dated {date} was returned unpaid. Please contact us: {helpline}",
    bn: "{tenant}: {date} তারিখের {amount}-এর চেক {chequeNo} অপরিশোধিত ফেরত এসেছে। যোগাযোগ করুন: {helpline}",
  },
  "quotation-sent": {
    en: "{tenant}: Quotation {quoteNo} of {amount}, valid until {date}. Help: {helpline}",
    bn: "{tenant}: কোটেশন {quoteNo}, {amount}, {date} পর্যন্ত বৈধ। সহায়তা: {helpline}",
  },
  "refund-paid": {
    en: "{tenant}: A refund of {amount} has been paid. Reference {refundNo}.",
    bn: "{tenant}: {amount} ফেরত দেওয়া হয়েছে। রেফারেন্স {refundNo}।",
  },
} satisfies Record<string, Record<Locale, string>>

export type SmsTemplateId = keyof typeof SMS_TEMPLATES

export function renderSms(
  templateId: SmsTemplateId,
  lang: Locale,
  params: Record<string, string | number>
): string {
  const values: Record<string, string | number> = {
    tenant: tenant.shortName[lang],
    helpline: tenant.helpline,
    ...params,
  }
  return SMS_TEMPLATES[templateId][lang].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match
  )
}
