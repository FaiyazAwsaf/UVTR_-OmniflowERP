import { AppFrame } from "@/components/shared/app-frame"

/** CAB: the app header with its tabs above every CAB screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="cab">{children}</AppFrame>
}
