import { AppFrame } from "@/components/shared/app-frame"

/** IRT: the app header with its tabs above every IRT screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="irt">{children}</AppFrame>
}
