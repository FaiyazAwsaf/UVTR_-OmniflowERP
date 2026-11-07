import { CountDetail } from "@/modules/ic/components/count-detail"

/** /ic/counts/[id]: a stock count (implementation_plan.md §9). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CountDetail id={decodeURIComponent(id)} />
}
