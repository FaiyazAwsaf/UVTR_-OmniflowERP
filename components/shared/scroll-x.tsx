"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A sideways scroll area for wide tables: when more columns sit past an edge
 * (a 960x600 window, a long Bangla header), that edge fades out, so a cut
 * column reads as "scroll for more" instead of a broken layout. The fade is
 * a mask on the content, so it works on any card or page background.
 */
export function ScrollX({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [edges, setEdges] = React.useState({ left: false, right: false })

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const left = el.scrollLeft > 1
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setEdges((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right }
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    el.addEventListener("scroll", update, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener("scroll", update)
    }
  }, [])

  const fade = "2.5rem"
  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent" : "#000"} 0, #000 ${edges.left ? fade : "0"}, #000 calc(100% - ${edges.right ? fade : "0px"}), ${edges.right ? "transparent" : "#000"} 100%)`
      : undefined

  return (
    <div
      ref={ref}
      data-slot="scroll-x"
      data-more-left={edges.left || undefined}
      data-more-right={edges.right || undefined}
      className={cn("min-w-0 overflow-x-auto", className)}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      {...props}
    >
      {children}
    </div>
  )
}

/** Short text in a table cell (a date, a code, "Central Store") stays on one line; longer text may wrap. */
export function keepShort(content: React.ReactNode): React.ReactNode {
  if (
    (typeof content === "string" && content.length <= 24) ||
    typeof content === "number"
  ) {
    return <span className="whitespace-nowrap">{content}</span>
  }
  return content
}
