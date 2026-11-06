import { AppFrame } from "@/components/shared/app-frame"

/** AP: the app header with its tabs above every AP screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="ap">{children}</AppFrame>
}
