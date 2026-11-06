import { cn } from "@/lib/utils"

/**
 * The product wordmark: "UVTR_" in the foreground colour and "OmniflowERP" in
 * turquoise (D15). A local copy for the launcher and Demo Wall headers.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-sans font-semibold tracking-tight whitespace-nowrap", className)} translate="no">
      <span className="text-foreground">UVTR_</span>
      <span className="text-primary">OmniflowERP</span>
    </span>
  )
}
