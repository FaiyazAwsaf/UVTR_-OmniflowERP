import { UserDetail } from "@/modules/sac/components/user-detail"

/** /sac/users/[id]: profile, roles, locations, sessions, login history (plan §9). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <UserDetail userId={decodeURIComponent(id)} />
}
