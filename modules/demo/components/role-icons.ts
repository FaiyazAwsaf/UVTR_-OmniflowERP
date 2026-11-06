import {
  BookOpenText,
  Car,
  ChartLine,
  ClipboardCheck,
  Eye,
  HandCoins,
  KeyRound,
  Landmark,
  ShoppingCart,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import type { RoleCode } from "@/core/security/types"

/** One icon per role, used on the launcher cards and Demo Wall panes. */
export const ROLE_ICONS: Record<RoleCode, LucideIcon> = {
  OWNER: ChartLine,
  ACC_MGR: Landmark,
  ACCOUNTANT: BookOpenText,
  STUDIO_MGR: ClipboardCheck,
  ADVISOR: Car,
  CASHIER: HandCoins,
  TECHNICIAN: Wrench,
  STORE: Warehouse,
  PROCUREMENT: ShoppingCart,
  SYS_ADMIN: KeyRound,
  AUDITOR: Eye,
}
