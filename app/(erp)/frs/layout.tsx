import { AppFrame } from "@/components/shared/app-frame"

/** FRS: the app header with its tabs above every FRS screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="frs">{children}</AppFrame>
}
