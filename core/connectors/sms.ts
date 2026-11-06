/**
 * Simulated SMS aggregator (plan §3.17). `queueSms` writes the outbox row
 * inside the command (templates carry only numbers, dates and amounts); the
 * `comms.sms` sweeper marks it delivered about 2 s later.
 */
export { queueSms, smsParts } from "@/core/comms/sms"
export { renderSms, SMS_TEMPLATES, type SmsTemplateId } from "@/modules/comms/templates"
