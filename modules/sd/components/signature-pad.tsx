"use client"

import * as React from "react"
import { Eraser } from "lucide-react"

import { Button } from "@/components/ui/button"
import { signaturePath } from "@/core/connectors/capture"
import { useLocale } from "@/lib/i18n/provider"

type Point = { x: number; y: number } | null

export const PAD_WIDTH = 320
export const PAD_HEIGHT = 120

/**
 * The on-screen signature pad (ui_guidelines.md §4): a white rounded sheet
 * with a hairline baseline and "Sign here"; strokes are kept as SVG path
 * data (core/connectors/capture.ts), so the handover and the gate pass show
 * the same signature black on white.
 */
export function SignaturePad({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const { t } = useLocale()
  const points = React.useRef<Point[]>([])
  const drawing = React.useRef(false)
  const svg = React.useRef<SVGSVGElement>(null)

  const at = (event: React.PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * PAD_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * PAD_HEIGHT,
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-lg bg-white ring-1 ring-black/10">
        <svg
          ref={svg}
          data-testid="signature-pad"
          viewBox={`0 0 ${PAD_WIDTH} ${PAD_HEIGHT}`}
          className="block aspect-[8/3] w-full max-w-[28rem] cursor-crosshair touch-none"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            drawing.current = true
            points.current.push(at(event))
            onChange(signaturePath(points.current))
          }}
          onPointerMove={(event) => {
            if (!drawing.current) return
            points.current.push(at(event))
            onChange(signaturePath(points.current))
          }}
          onPointerUp={() => {
            drawing.current = false
            points.current.push(null)
          }}
          onPointerLeave={() => {
            if (drawing.current) points.current.push(null)
            drawing.current = false
          }}
        >
          <line x1="20" x2={PAD_WIDTH - 20} y1={PAD_HEIGHT - 28} y2={PAD_HEIGHT - 28} stroke="#d0d0d0" strokeWidth="1" />
          {!value ? (
            <text x={PAD_WIDTH / 2} y={PAD_HEIGHT / 2} textAnchor="middle" fill="#9a9a9a" fontSize="14">
              {t("sd.handover.signHere")}
            </text>
          ) : null}
          <path d={value} fill="none" stroke="#111" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            points.current = []
            onChange("")
          }}
          disabled={!value}
          data-testid="signature-clear"
        >
          <Eraser data-icon="inline-start" />
          {t("common.clear")}
        </Button>
      </div>
    </div>
  )
}

/** A stored signature, black on white (handover view and gate pass). */
export function SignatureView({ path, className }: { path?: string; className?: string }) {
  if (!path) return null
  return (
    <svg viewBox={`0 0 ${PAD_WIDTH} ${PAD_HEIGHT}`} className={className ?? "h-16 w-44"} data-testid="signature-view">
      <path d={path} fill="none" stroke="#111" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
