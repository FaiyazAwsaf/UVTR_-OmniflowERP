import { AppFrame } from "@/components/shared/app-frame"

/** FA: the app header with its tabs above every FA screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="fa">{children}</AppFrame>
}
