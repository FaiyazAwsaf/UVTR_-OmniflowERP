import { OrderView } from "@/modules/stl/components/order-view"

/** /stl/orders/[id]: the order view (plan §9). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <OrderView id={decodeURIComponent(id)} />
}
