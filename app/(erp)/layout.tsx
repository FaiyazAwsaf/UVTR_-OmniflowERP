import { ErpShell } from "@/components/shell/erp-shell"

/**
 * Every ERP route: sidebar, top bar, content, command palette and cue card,
 * with the sign-in and permission guard (plan §3.8). The page transition
 * lives in template.tsx.
 */
export default function ErpLayout({ children }: { children: React.ReactNode }) {
  return <ErpShell>{children}</ErpShell>
}
