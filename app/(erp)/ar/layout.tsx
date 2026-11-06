import { AppFrame } from "@/components/shared/app-frame"

/** AR: the app header with its tabs above every AR screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="ar">{children}</AppFrame>
}
