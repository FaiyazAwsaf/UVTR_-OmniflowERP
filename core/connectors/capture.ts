/**
 * Simulated capture (plan §3.17): vehicle photos as generated placeholders and
 * the customer's signature drawn on an on-screen pad, stored as SVG path data.
 */

/** A small generated placeholder "photo" (SVG data URI) for a vehicle angle. */
/**
 * A simulated photo: a car silhouette on a seeded colour. The caption, if any,
 * is drawn inside the SVG, which an <img> renders without the page's fonts;
 * screens overlay a translated caption as page text instead (pass label "").
 */
export function placeholderPhoto(seed: string, label: string): string {
  let h = 0
  for (const ch of seed + label) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const hue = h % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="110" viewBox="0 0 160 110"><rect width="160" height="110" rx="10" fill="hsl(${hue} 18% 32%)"/><path d="M20 78 L40 52 L120 52 L140 78 Z" fill="hsl(${hue} 30% 70%)"/><circle cx="48" cy="82" r="10" fill="#222"/><circle cx="112" cy="82" r="10" fill="#222"/>${label ? `<text x="80" y="102" font-family="sans-serif" font-size="10" text-anchor="middle" fill="#eee">${label}</text>` : ""}</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** Points drawn on the signature pad to an SVG path ("M x y L x y ..."), strokes separated by null. */
export function signaturePath(
  points: ({ x: number; y: number } | null)[]
): string {
  let d = ""
  let pen = false
  for (const p of points) {
    if (!p) {
      pen = false
      continue
    }
    d += `${pen ? "L" : "M"}${Math.round(p.x)} ${Math.round(p.y)} `
    pen = true
  }
  return d.trim()
}

/** A complete SVG for a stored signature path (black on white for prints). */
export function signatureSvg(path: string, width = 320, height = 120): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${path}" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}
