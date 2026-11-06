import { cn } from "@/lib/utils"

/**
 * A vehicle registration as a light plate chip (ui_guidelines.md §4 "Job
 * board card"): mono, uppercase, #f4f4f0 with dark text and a 1px border,
 * the city line small above. Registrations are always Latin on documents.
 */
export function RegPlate({ regNo, className }: { regNo: string; className?: string }) {
  const match = /^(.*?METRO)-?\s*(.*)$/.exec(regNo)
  const city = match ? match[1] : ""
  const rest = match ? match[2] : regNo
  return (
    <span
      lang="en"
      translate="no"
      data-testid="reg-plate"
      className={cn(
        "inline-flex flex-col items-center rounded-[4px] border border-[#1f1d22] bg-[#f4f4f0] px-1.5 py-0.5 font-mono leading-none text-[#1f1d22] uppercase",
        className
      )}
    >
      {city ? <span className="text-[0.5rem] tracking-wide">{city}</span> : null}
      <span className="text-[0.75rem] font-semibold whitespace-nowrap">{rest}</span>
    </span>
  )
}
