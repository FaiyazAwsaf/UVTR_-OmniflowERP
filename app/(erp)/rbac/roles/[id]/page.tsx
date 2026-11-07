import { RoleDetail } from "@/modules/rbac/components/role-detail"

/** /rbac/roles/[id]: the role and its permission matrix (plan §9). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RoleDetail roleId={decodeURIComponent(id)} />
}
