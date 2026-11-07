import { RequisitionDetail } from "@/modules/ptl/components/requisition-detail"

/** /ptl/requisitions/[id]: a requisition; "new" creates one (implementation_plan.md §9). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RequisitionDetail id={decodeURIComponent(id)} />
}
