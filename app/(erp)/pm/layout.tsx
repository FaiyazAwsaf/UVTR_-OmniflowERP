import { AppFrame } from "@/components/shared/app-frame"

/** PM: the app header with its tabs above every PM screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="pm">{children}</AppFrame>
}
