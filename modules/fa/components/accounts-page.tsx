"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronDown, ChevronRight, Lock, Pencil, Plus, Power } from "lucide-react"
import { toast } from "sonner"

import { TableSearch } from "@/components/motion/data-table"
import { PageHeader } from "@/components/shared/page-header"
import { StatusText } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { AccountRow, AccountType, Id } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { useCan } from "@/core/security/useCan"
import { nameOf } from "@/core/security/users"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { saveAccount } from "../commands"
import { useAccountBalances, useAccounts } from "../queries"
import { CsvButton, DrCr, Field } from "./common"

const TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"]

type Node = { account: AccountRow; depth: number; children: Node[]; balanceP: number }

/** The chart as a tree with each group's balance the sum of its accounts. */
function buildTree(accounts: AccountRow[], balances: Map<Id, number>): Node[] {
  const byParent = new Map<string, AccountRow[]>()
  for (const a of accounts) {
    const key = a.parentId ?? ""
    byParent.set(key, [...(byParent.get(key) ?? []), a])
  }
  const make = (a: AccountRow, depth: number): Node => {
    const children = (byParent.get(a.id) ?? []).sort((x, y) => x.code.localeCompare(y.code)).map((c) => make(c, depth + 1))
    const own = balances.get(a.id) ?? 0
    return { account: a, depth, children, balanceP: own + children.reduce((s, c) => s + c.balanceP, 0) }
  }
  return (byParent.get("") ?? []).sort((x, y) => x.code.localeCompare(y.code)).map((a) => make(a, 0))
}

/**
 * The chart of accounts (plan §9 `/fa/accounts`): groups and postable
 * accounts as a tree, system tags, the control flag and each account's live
 * balance; create, edit and deactivate with fa.account.edit.
 */
export function AccountsPage() {
  const { t, tk, locale } = useLocale()
  const accounts = useAccounts()
  const balances = useAccountBalances()
  const canEdit = useCan("fa.account.edit")
  const [query, setQuery] = React.useState("")
  const [collapsed, setCollapsed] = React.useState<Set<Id>>(() => new Set())
  const [editing, setEditing] = React.useState<AccountRow | "new" | null>(null)
  const command = useCommand(saveAccount)

  const tree = React.useMemo(() => buildTree(accounts ?? [], balances ?? new Map()), [accounts, balances])
  const q = query.trim().toLowerCase()
  const matches = (a: AccountRow) =>
    !q || a.code.includes(q) || a.nameEn.toLowerCase().includes(q) || a.nameBn.includes(q) || (a.tag ?? "").toLowerCase().includes(q)

  const visible: Node[] = []
  const walk = (nodes: Node[]): boolean => {
    let any = false
    for (const node of nodes) {
      const start = visible.length
      visible.push(node)
      const childHit = node.children.length && (q || !collapsed.has(node.account.id)) ? walk(node.children) : false
      const hit = matches(node.account) || childHit
      if (!hit) visible.splice(start)
      any = any || !!hit
    }
    return any
  }
  walk(tree)

  const toggleActive = async (a: AccountRow) => {
    const result = await command.run({
      accountId: a.id,
      expectedVersion: a.version,
      code: a.code,
      nameEn: a.nameEn,
      nameBn: a.nameBn,
      type: a.type,
      parentId: a.parentId,
      isGroup: a.isGroup,
      normalSide: a.normalSide,
      tag: a.tag,
      active: !a.active,
    })
    if (result) toast.success(t("fa.accounts.saved", { code: a.code }))
  }

  const groups = (accounts ?? []).filter((a) => a.isGroup)

  return (
    <div className="flex flex-col gap-5" data-testid="fa-accounts">
      <PageHeader
        title={t("fa.accounts.title")}
        subtitle={t("fa.accounts.subtitle")}
        actions={
          <>
            <CsvButton
              exportKey="fa.export"
              fileName="chart-of-accounts"
              columns={[
                { key: "code", label: t("fa.accounts.code") },
                { key: "name", label: t("fa.accounts.name") },
                { key: "type", label: t("fa.accounts.type") },
                { key: "group", label: t("fa.accounts.group") },
                { key: "tag", label: t("fa.accounts.tag") },
                { key: "control", label: t("fa.accounts.control") },
                { key: "balanceP", label: t("fa.accounts.balance") },
              ]}
              rows={() => {
                const out: Record<string, string | number>[] = []
                const add = (nodes: Node[]) =>
                  nodes.forEach((n) => {
                    out.push({
                      code: n.account.code,
                      name: nameOf(n.account, locale),
                      type: n.account.type,
                      group: n.account.isGroup ? "yes" : "no",
                      tag: n.account.tag ?? "",
                      control: n.account.isControl ? "yes" : "no",
                      balanceP: n.balanceP,
                    })
                    add(n.children)
                  })
                add(tree)
                return out
              }}
            />
            {canEdit ? (
              <Button onClick={() => setEditing("new")} data-testid="account-new">
                <Plus />
                {t("fa.accounts.newAccount")}
              </Button>
            ) : null}
          </>
        }
      />

      <section className="surface-card @container flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <TableSearch value={query} onChange={setQuery} placeholder={t("fa.common.search")} />
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set())}>
            {t("fa.accounts.expandAll")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(new Set(groups.filter((g) => g.parentId).map((g) => g.id)))}
          >
            {t("fa.accounts.collapseAll")}
          </Button>
          {!canEdit ? <span className="ml-auto text-xs text-muted-foreground">{t("fa.accounts.readOnly")}</span> : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[0.8125rem]" data-testid="accounts-tree">
            <thead>
              <tr>
                <th className="h-9 rounded-l-md bg-surface-raised px-3 text-left font-medium">{t("fa.accounts.name")}</th>
                <th className="hidden h-9 bg-surface-raised px-3 text-left font-medium @[40rem]:table-cell">{t("fa.accounts.type")}</th>
                <th className="hidden h-9 bg-surface-raised px-3 text-left font-medium @[52rem]:table-cell">{t("fa.accounts.tag")}</th>
                <th className="h-9 bg-surface-raised px-3 text-right font-medium">{t("fa.accounts.balance")}</th>
                <th className="h-9 rounded-r-md bg-surface-raised px-3 text-right font-medium">
                  <span className="sr-only">{t("fa.common.edit")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ account: a, depth, children, balanceP }) => {
                const open = !collapsed.has(a.id)
                return (
                  <tr
                    key={a.id}
                    data-testid="account-row"
                    data-code={a.code}
                    className={cn("group/row hover:bg-primary-soft", !a.active && "opacity-60")}
                  >
                    <td className="h-9 border-b border-hairline px-3">
                      <div className="flex items-center gap-1.5" style={{ paddingLeft: `${depth * 1.1}rem` }}>
                        {children.length ? (
                          <button
                            type="button"
                            aria-label={a.code}
                            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              setCollapsed((prev) => {
                                const next = new Set(prev)
                                if (next.has(a.id)) next.delete(a.id)
                                else next.add(a.id)
                                return next
                              })
                            }
                          >
                            {open || q ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                          </button>
                        ) : (
                          <span className="size-5" />
                        )}
                        <span lang="en" className="w-10 shrink-0 font-mono text-muted-foreground">
                          {a.code}
                        </span>
                        {a.isGroup ? (
                          <span className="font-semibold">{nameOf(a, locale)}</span>
                        ) : (
                          <Link href={`/fa/ledger?account=${a.id}`} className="min-w-0 truncate hover:text-link hover:underline">
                            {nameOf(a, locale)}
                          </Link>
                        )}
                        {a.isControl ? (
                          <span
                            title={t("fa.accounts.controlHint")}
                            className="inline-flex items-center gap-0.5 rounded-full bg-surface-raised px-1.5 py-0.5 text-[0.625rem] text-muted-foreground"
                            data-testid="account-control"
                          >
                            <Lock className="size-2.5" />
                            {t("fa.accounts.control")}
                          </span>
                        ) : null}
                        {!a.active ? <StatusText tone="muted">{t("fa.accounts.inactive")}</StatusText> : null}
                      </div>
                    </td>
                    <td className="hidden h-9 border-b border-hairline px-3 text-muted-foreground @[40rem]:table-cell">
                      {a.isGroup ? t("fa.accounts.group") : tk(`fa.accounts.types.${a.type}`)}
                    </td>
                    <td className="hidden h-9 border-b border-hairline px-3 @[52rem]:table-cell">
                      {a.tag ? (
                        <span lang="en" className="rounded-full bg-surface-raised px-2 py-0.5 font-mono text-[0.6875rem]">
                          {a.tag}
                        </span>
                      ) : null}
                    </td>
                    <td className={cn("h-9 border-b border-hairline px-3 text-right font-mono", a.isGroup && "font-semibold")}>
                      <DrCr balanceP={balanceP} />
                    </td>
                    <td className="h-9 border-b border-hairline px-2 text-right whitespace-nowrap">
                      {canEdit ? (
                        <span className="inline-flex gap-0.5 opacity-70 group-hover/row:opacity-100">
                          <Button variant="ghost" size="icon-xs" aria-label={t("fa.common.edit")} onClick={() => setEditing(a)} data-testid="account-edit">
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={a.active ? t("fa.accounts.deactivate") : t("fa.accounts.activate")}
                            title={a.active ? t("fa.accounts.deactivate") : t("fa.accounts.activate")}
                            onClick={() => toggleActive(a)}
                            data-testid="account-toggle"
                          >
                            <Power />
                          </Button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <AccountDialog
        account={editing === "new" ? null : editing}
        open={editing !== null}
        groups={groups}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}

function AccountDialog({
  account,
  open,
  groups,
  onClose,
}: {
  account: AccountRow | null
  open: boolean
  groups: AccountRow[]
  onClose: () => void
}) {
  const { t, tk, locale } = useLocale()
  const command = useCommand(saveAccount)
  const [code, setCode] = React.useState("")
  const [nameEn, setNameEn] = React.useState("")
  const [nameBn, setNameBn] = React.useState("")
  const [type, setType] = React.useState<AccountType>("expense")
  const [parentId, setParentId] = React.useState<string>("")
  const [isGroup, setIsGroup] = React.useState(false)
  const [active, setActive] = React.useState(true)
  const [seen, setSeen] = React.useState<string | null>(null)
  const key = open ? (account?.id ?? "new") : null
  if (key !== seen) {
    setSeen(key)
    setCode(account?.code ?? "")
    setNameEn(account?.nameEn ?? "")
    setNameBn(account?.nameBn ?? "")
    setType(account?.type ?? "expense")
    setParentId(account?.parentId ?? "")
    setIsGroup(account?.isGroup ?? false)
    setActive(account?.active ?? true)
  }
  const parents = groups.filter((g) => g.type === type && g.id !== account?.id)
  const parent = parents.find((g) => g.id === parentId)

  const run = async () => {
    const result = await command.run({
      accountId: account?.id,
      expectedVersion: account?.version,
      code: code.trim(),
      nameEn: nameEn.trim(),
      nameBn: nameBn.trim(),
      type,
      parentId: parentId || undefined,
      isGroup,
      normalSide: account?.normalSide,
      tag: account?.tag,
      active,
    })
    if (result) {
      toast.success(t("fa.accounts.saved", { code: code.trim() }))
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="account-dialog">
        <DialogHeader>
          <DialogTitle>{account ? t("fa.accounts.editAccount", { code: account.code }) : t("fa.accounts.newAccount")}</DialogTitle>
          <DialogDescription>{account?.tag ? `${t("fa.accounts.tag")}: ${account.tag}` : t("fa.accounts.subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("fa.accounts.code")}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={4} className="font-mono" data-testid="account-code" />
          </Field>
          <Field label={t("fa.accounts.type")}>
            <Select
              value={type}
              onValueChange={(v) => {
                if (!v) return
                setType(v as AccountType)
                setParentId("")
              }}
            >
              <SelectTrigger className="w-full" data-testid="account-type">
                <SelectValue>{() => tk(`fa.accounts.types.${type}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((x) => (
                  <SelectItem key={x} value={x}>
                    {tk(`fa.accounts.types.${x}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("fa.accounts.nameEn")}>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} data-testid="account-name-en" />
          </Field>
          <Field label={t("fa.accounts.nameBn")}>
            <Input value={nameBn} onChange={(e) => setNameBn(e.target.value)} lang="bn" data-testid="account-name-bn" />
          </Field>
          <Field label={t("fa.accounts.parent")} className="sm:col-span-2">
            <Select value={parentId || "none"} onValueChange={(v) => setParentId(!v || v === "none" ? "" : (v as string))}>
              <SelectTrigger className="w-full" data-testid="account-parent">
                <SelectValue>
                  {() =>
                    parent ? (
                      <>
                        <span lang="en" className="font-mono text-muted-foreground">
                          {parent.code}
                        </span>{" "}
                        {nameOf(parent, locale)}
                      </>
                    ) : (
                      t("fa.accounts.noParent")
                    )
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("fa.accounts.noParent")}</SelectItem>
                {parents.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    <span lang="en" className="font-mono text-muted-foreground">
                      {g.code}
                    </span>{" "}
                    {nameOf(g, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-md bg-surface-raised px-3 py-2 text-sm">
            {t("fa.accounts.isGroup")}
            <Switch checked={isGroup} onCheckedChange={setIsGroup} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md bg-surface-raised px-3 py-2 text-sm">
            {t("fa.accounts.active")}
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("fa.common.cancel")}
          </Button>
          <Button onClick={run} disabled={command.pending || !/^\d{4}$/.test(code.trim()) || nameEn.trim().length < 2 || nameBn.trim().length < 2} data-testid="account-save">
            {t("fa.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
