import { StockCard } from "@/modules/ic/components/stock-card"

/** /ic/items/[id]: the stock card (implementation_plan.md §9); `?location=` picks the location. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ location?: string }>
}) {
  const { id } = await params
  const { location } = await searchParams
  return <StockCard itemId={decodeURIComponent(id)} locationId={location} />
}
