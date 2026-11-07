import { InvoiceView } from "@/modules/si/components/invoice-view"

/** /si/[id]: the invoice with Mushak 6.3 print and credit notes (plan §9). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <InvoiceView id={decodeURIComponent(id)} />
}
