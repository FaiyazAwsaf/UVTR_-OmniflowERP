import type { MetadataRoute } from "next"

// A client demo on a public URL: ask crawlers to stay out entirely.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  }
}
