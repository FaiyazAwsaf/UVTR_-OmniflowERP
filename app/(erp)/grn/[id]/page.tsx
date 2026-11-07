import { GrnView } from "@/modules/grn/components/grn-view"

/** /grn/[id]: GRN view and print (implementation_plan.md §9). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <GrnView id={decodeURIComponent(id)} />
}
