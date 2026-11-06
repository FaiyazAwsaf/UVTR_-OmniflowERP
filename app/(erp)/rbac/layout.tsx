import { AppFrame } from "@/components/shared/app-frame"

/** RBAC: the app header with its tabs above every RBAC screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame app="rbac">{children}</AppFrame>
}
