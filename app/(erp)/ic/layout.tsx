import { AppFrame } from "@/components/shared/app-frame"

/** IC: the app header with its tabs above every IC screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="ic">{children}</AppFrame>
}
