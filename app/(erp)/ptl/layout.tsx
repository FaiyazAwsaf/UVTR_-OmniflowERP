import { AppFrame } from "@/components/shared/app-frame"

/** PTL: the app header with its tabs above every PTL screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="ptl">{children}</AppFrame>
}
