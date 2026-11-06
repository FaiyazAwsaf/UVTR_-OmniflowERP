import { AppFrame } from "@/components/shared/app-frame"

/** SD: the app header with its tabs above every SD screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="sd">{children}</AppFrame>
}
