import { VoucherPage } from "@/modules/fa/components/voucher-page"

/** /fa/journals/[id]: a voucher (plan §9). Next 16: `params` is a Promise. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <VoucherPage id={decodeURIComponent(id)} />
}
