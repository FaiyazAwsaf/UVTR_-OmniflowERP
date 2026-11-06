import { z } from "zod"

import { defineCommand } from "@/core/engine/defineCommand"

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
