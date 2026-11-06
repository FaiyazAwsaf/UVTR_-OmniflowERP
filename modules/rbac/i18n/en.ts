/** RBAC strings, English. Every key also lives in bn.ts. */
export const rbacEn = {
  rbac: {
    name: "Role-Based Access Control",
    description: "Roles, permission matrix, limits and SoD",
    pages: {
      home: "Roles",
      role: "Role",
      assignments: "Assignments",
      limits: "Approval limits",
      sod: "Segregation of duties",
      effective: "Effective permissions",
    },
    perm: {
      app_view: "Open Role-Based Access Control",
      role_edit: "Edit roles and permissions",
      assign_edit: "Assign roles to users",
      limits_edit: "Set approval limits",
      sod_edit: "Edit segregation-of-duties rules",
    },
    events: {
      PermissionGranted: "{permission} granted to {role}",
      PermissionRevoked: "{permission} revoked from {role}",
      RoleAssigned: "{role} assigned to {user}",
      RoleUnassigned: "{role} removed from {user}",
      LimitChanged: "{kind} limit of {role} changed",
      SodConflictFlagged: "SoD conflict flagged: {rule}",
    },
  },
}
