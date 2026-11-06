import { AppFrame } from "@/components/shared/app-frame"

/** ST: the app header with its tabs above every ST screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="st">{children}</AppFrame>
}
