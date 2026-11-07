import { ItemDetail } from "@/modules/pm/components/item-detail"

/** /pm/items/[id]: item detail (implementation_plan.md §9). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ItemDetail id={decodeURIComponent(id)} />
}
