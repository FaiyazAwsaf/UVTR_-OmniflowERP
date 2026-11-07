import { ServiceDetail } from "@/modules/pc/components/service-detail"

/** /pc/services/[id]: service detail with the recipe per class (plan §9). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ServiceDetail id={decodeURIComponent(id)} />
}
