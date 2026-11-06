import { AppFrame } from "@/components/shared/app-frame"

/** SAC: the app header with its tabs above every SAC screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="sac">{children}</AppFrame>
}
