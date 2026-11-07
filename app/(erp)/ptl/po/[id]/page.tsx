import { PoDetail } from "@/modules/ptl/components/po-detail"

/** /ptl/po/[id]: a purchase order; "new" creates one (implementation_plan.md §9). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PoDetail id={decodeURIComponent(id)} />
}
