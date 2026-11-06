import { AppFrame } from "@/components/shared/app-frame"

/** PC: the app header with its tabs above every PC screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="pc">{children}</AppFrame>
}
