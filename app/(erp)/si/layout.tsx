import { AppFrame } from "@/components/shared/app-frame"

/** SI: the app header with its tabs above every SI screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="si">{children}</AppFrame>
}
