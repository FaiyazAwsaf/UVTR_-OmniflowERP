import { AppFrame } from "@/components/shared/app-frame"

/** GRN: the app header with its tabs above every GRN screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="grn">{children}</AppFrame>
}
