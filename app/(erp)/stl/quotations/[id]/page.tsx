import { QuoteView } from "@/modules/stl/components/quote-view"

/** /stl/quotations/[id]: the quotation view with accept (plan §9). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <QuoteView id={decodeURIComponent(id)} />
}
