import { tenant } from "@/config/brand.config"
import { cn } from "@/lib/utils"

/**
 * The tenant's generated monogram (D2: no Automania logo is copied). A
 * turquoise "AM" on charcoal, sized in px so it prints crisply.
 */
export function TenantMark({
  size = 32,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <span
      translate="no"
      aria-label={tenant.shortName.en}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold ring-1 ring-primary/45",
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: tenant.monogramColors.background,
        color: tenant.monogramColors.foreground,
        letterSpacing: "-0.02em",
      }}
    >
      {tenant.monogram}
    </span>
  )
}
