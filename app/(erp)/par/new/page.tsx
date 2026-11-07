"use client"

import { PageHeader } from "@/components/shared/page-header"
import { useLocale } from "@/lib/i18n/provider"
import { PartyForm } from "@/modules/par/components/party-form"

/** /par/new: a new customer or vendor with the duplicate warning (plan §9). */
export default function Page() {
  const { t } = useLocale()
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("par.pages.partyNew")} subtitle={t("par.form.subtitleNew")} />
      <PartyForm />
    </div>
  )
}
