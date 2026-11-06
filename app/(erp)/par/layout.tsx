import { AppFrame } from "@/components/shared/app-frame"

/** PAR: the app header with its tabs above every PAR screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="par">{children}</AppFrame>
}
