import { z } from "zod"

import { defineCommand } from "@/core/engine/defineCommand"
import { postJournal } from "@/core/ledger/post"
import { linesForManualVoucher } from "@/core/ledger/rules"

/**
 * Dev controls for checkpoint 1 (plan §12 P1 "Accept when"), used by the demo
 * panel's Data tab. They are real, permission-checked, audited commands.
 */

/**
 * Grant or revoke one key for a role (scope "all"), so a checkpoint can show
 * an app disappearing live in another window before the RBAC matrix exists.
 * WS-CSC's `rbac.setPermission` is the real screen's command.
 */
export const devSetGrant = defineCommand({
  name: "demo.devSetGrant",
  permission: "rbac.role.edit",
  input: z.object({ roleId: z.string(), permission: z.string(), granted: z.boolean() }),
  async run(tx, input) {
    const role = await tx.get("roles", input.roleId)
    const existing = await tx.list("rolePermissions", "[roleId+permission]", [role.id, input.permission])
    if (input.granted && !existing.length) {
      tx.insert("rolePermissions", { roleId: role.id, permission: input.permission, scope: "all" })
      tx.emit("PermissionGranted", {
        refs: { roleId: role.id },
        params: { permission: input.permission, role: role.nameEn },
      })
    } else if (!input.granted) {
      for (const row of existing) await tx.remove("rolePermissions", row.id)
      if (existing.length) {
        tx.emit("PermissionRevoked", {
          refs: { roleId: role.id },
          params: { permission: input.permission, role: role.nameEn },
        })
      }
    }
    return { granted: input.granted }
  },
})

/**
 * Post a small, real, balanced manual voucher (R24, JV) so a checkpoint can
 * show a journal appearing live in another window's ledger before FA's
 * screens exist: Dr office expenses, Cr petty cash at Head Office.
 */
export const devPostTestJournal = defineCommand({
  name: "demo.devPostTestJournal",
  permission: "fa.journal.create",
  input: z.object({ amountP: z.number().int().positive().default(100_00) }),
  async run(tx, input) {
    const journal = await postJournal(tx, {
      voucherType: "JV",
      date: tx.today(),
      narration: "Checkpoint test voucher (stationery from petty cash)",
      lines: linesForManualVoucher([
        { account: "OFFICE", debitP: input.amountP, locationId: "loc_hq" },
        { account: "PETTY_HQ", creditP: input.amountP, locationId: "loc_hq" },
      ]),
      rule: "R24",
    })
    tx.emit("JournalPosted", { refs: { journalId: journal.id }, params: { no: journal.journalNo } })
    return { journalId: journal.id, journalNo: journal.journalNo }
  },
})
