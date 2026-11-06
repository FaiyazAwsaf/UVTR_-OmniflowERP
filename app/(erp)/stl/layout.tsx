import { AppFrame } from "@/components/shared/app-frame"

/** STL: the app header with its tabs above every STL screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="stl">{children}</AppFrame>
}
