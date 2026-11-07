import { Handover } from "@/modules/sd/components/handover"

/** /sd/handover/[orderId]: vehicle handover (plan §9). */
export default async function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params
  return <Handover id={decodeURIComponent(orderId)} />
}
