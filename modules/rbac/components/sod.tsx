"use client"

import * as React from "react"
import Link from "next/link"
import { Pencil, Plus, Scale, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/shared/page-header"
import { SearchPicker } from "@/components/shared/pickers"
import { SectionCard } from "@/components/shared/section-card"
import { StatusPill, StatusText } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { SodRuleRow } from "@/core/db/schema"
import { useCommand } from "@/core/engine/useCommand"
import { PERMISSIONS } from "@/core/security/registry"
import { useCan } from "@/core/security/useCan"
import { useLocale } from "@/lib/i18n/provider"
import {
  Field,
  ListTable,
  Mono,
  OptionSelect,
  type ListColumn,
} from "@/modules/sac/components/kit"
import { personName, roleName } from "@/modules/sac/queries"

import { saveSodRule } from "../commands"
import { useRbacFormat } from "../format"
import { keySets, useRbacData } from "../queries"
import { ANY_APPROVE, conflictsReport, type ConflictRow } from "../sod"

/** /rbac/sod: the segregation-of-duties rules and the conflicts report (plan §9). */
export function SodScreen() {
  const { t, num, locale } = useLocale()
  const data = useRbacData()
  const canEdit = useCan("rbac.sod.edit")
  const { keyLabel } = useRbacFormat()
  const [editing, setEditing] = React.useState<SodRuleRow | "new" | null>(null)

  const conflicts = React.useMemo(
    () =>
      data
        ? conflictsReport({
            rules: data.rules,
            roles: data.roles,
            keysByRole: keySets(data),
            rolesByUser: data.rolesByUser,
          })
        : undefined,
    [data]
  )

  const keyCell = (k: string) => (
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{keyLabel(k)}</span>
      {k !== ANY_APPROVE ? (
        <Mono className="truncate text-muted-foreground">{k}</Mono>
      ) : (
        <Mono className="text-muted-foreground">*.approve</Mono>
      )}
    </span>
  )

  const ruleColumns: ListColumn<SodRuleRow>[] = [
    {
      id: "code",
      header: t("rbac.sod.columns.code"),
      cell: (r) => (
        <Mono className="font-semibold whitespace-nowrap">{r.code}</Mono>
      ),
    },
    {
      id: "description",
      header: t("rbac.sod.columns.description"),
      className: "whitespace-normal max-w-[22rem]",
      cell: (r) => (locale === "bn" ? r.descriptionBn : r.descriptionEn),
    },
    {
      id: "a",
      header: t("rbac.sod.columns.a"),
      hideBelow: "lg",
      className: "max-w-56",
      cell: (r) => keyCell(r.permissionA),
    },
    {
      id: "b",
      header: t("rbac.sod.columns.b"),
      hideBelow: "lg",
      className: "max-w-56",
      cell: (r) => keyCell(r.permissionB),
    },
    {
      id: "mode",
      header: t("rbac.sod.columns.mode"),
      cell: (r) => (
        <StatusText tone={r.mode === "block" ? "destructive" : "warning"} dot>
          {t(r.mode === "block" ? "rbac.sod.mode.block" : "rbac.sod.mode.warn")}
        </StatusText>
      ),
    },
    {
      id: "status",
      header: t("rbac.sod.columns.status"),
      hideBelow: "md",
      cell: (r) => (
        <StatusText tone={r.active ? "success" : "muted"}>
          {r.active ? t("rbac.common.active") : t("rbac.common.inactive")}
        </StatusText>
      ),
    },
    {
      id: "edit",
      header: "",
      align: "right",
      cell: (r) =>
        canEdit ? (
          <Button
            variant="link"
            size="sm"
            onClick={() => setEditing(r)}
            data-testid="sod-edit"
          >
            <Pencil />
            {t("rbac.sod.edit")}
          </Button>
        ) : null,
    },
  ]

  const subjectName = (row: ConflictRow) =>
    row.kind === "role"
      ? roleName(data?.roleById.get(row.subjectId), locale)
      : personName(data?.userById.get(row.subjectId), locale)

  const conflictColumns: ListColumn<ConflictRow>[] = [
    {
      id: "subject",
      header: t("rbac.sod.subject"),
      cell: (c) => (
        <span className="flex min-w-0 flex-col">
          <Link
            href={
              c.kind === "role"
                ? `/rbac/roles/${c.subjectId}`
                : `/sac/users/${c.subjectId}`
            }
            className="truncate font-medium hover:underline"
          >
            {subjectName(c)}
          </Link>
          <span className="text-xs text-muted-foreground">
            {c.kind === "role"
              ? t("rbac.sod.kindRole")
              : t("rbac.sod.via", {
                  roles: c.roleIds
                    .map((id) => roleName(data?.roleById.get(id), locale))
                    .join(" + "),
                })}
          </span>
        </span>
      ),
    },
    {
      id: "rule",
      header: t("rbac.sod.rule"),
      cell: (c) => (
        <span className="flex flex-col">
          <Mono className="font-semibold whitespace-nowrap">
            {c.hit.rule.code}
          </Mono>
          <StatusText
            tone={c.hit.rule.mode === "block" ? "destructive" : "warning"}
            className="text-xs"
          >
            {t(
              c.hit.rule.mode === "block"
                ? "rbac.sod.mode.block"
                : "rbac.sod.mode.warn"
            )}
          </StatusText>
        </span>
      ),
    },
    {
      id: "keys",
      header: t("rbac.sod.keys"),
      hideBelow: "sm",
      className: "whitespace-normal",
      cell: (c) => (
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          {c.hit.a.map((k) => (
            <Mono key={k} className="rounded bg-surface-raised px-1.5 py-0.5">
              {k}
            </Mono>
          ))}
          <span className="text-muted-foreground">+</span>
          {c.hit.b.map((k) => (
            <Mono key={k} className="rounded bg-surface-raised px-1.5 py-0.5">
              {k}
            </Mono>
          ))}
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("rbac.sod.title")}
        subtitle={t("rbac.sod.subtitle")}
        actions={
          canEdit ? (
            <Button onClick={() => setEditing("new")} data-testid="sod-new">
              <Plus />
              {t("rbac.sod.new")}
            </Button>
          ) : null
        }
      />
      <SectionCard
        title={t("rbac.sod.rules")}
        icon={Scale}
        size="sm"
        action={
          <StatusPill tone="muted">{num(data?.rules.length ?? 0)}</StatusPill>
        }
      >
        <ListTable
          rows={data?.rules}
          columns={ruleColumns}
          rowKey={(r) => r.id}
          rowProps={(r) => ({
            "data-testid": "sod-rule",
            "data-code": r.code,
            "data-mode": r.mode,
          })}
        />
      </SectionCard>
      <SectionCard
        title={t("rbac.sod.conflicts")}
        subtitle={t("rbac.sod.conflictsHint")}
        icon={ShieldAlert}
        size="sm"
        action={
          <StatusPill tone={conflicts?.length ? "warning" : "success"}>
            {num(conflicts?.length ?? 0)}
          </StatusPill>
        }
      >
        <ListTable
          rows={conflicts}
          columns={conflictColumns}
          rowKey={(c) => `${c.kind}:${c.subjectId}:${c.hit.rule.code}`}
          rowProps={(c) => ({
            "data-testid": "sod-conflict",
            "data-rule": c.hit.rule.code,
            "data-kind": c.kind,
            "data-subject":
              c.kind === "role"
                ? data?.roleById.get(c.subjectId)?.code
                : data?.userById.get(c.subjectId)?.username,
          })}
          empty={
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("rbac.sod.noConflicts")}
            </p>
          }
        />
      </SectionCard>
      <SodRuleDialog rule={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

type Draft = {
  code: string
  permissionA: string | null
  permissionB: string | null
  mode: "warn" | "block"
  descriptionEn: string
  descriptionBn: string
  active: boolean
}

const KEY_ITEMS = [
  { key: ANY_APPROVE },
  ...PERMISSIONS.map((p) => ({ key: p.key })),
]

function SodRuleDialog({
  rule,
  onClose,
}: {
  rule: SodRuleRow | "new" | null
  onClose: () => void
}) {
  const { t } = useLocale()
  const { keyLabel } = useRbacFormat()
  const command = useCommand(saveSodRule)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [openedFor, setOpenedFor] = React.useState<string | null>(null)
  const key = rule === null ? null : rule === "new" ? "new" : rule.id
  if (key !== openedFor) {
    setOpenedFor(key)
    setDraft(
      rule === null
        ? null
        : rule === "new"
          ? {
              code: "",
              permissionA: null,
              permissionB: null,
              mode: "warn",
              descriptionEn: "",
              descriptionBn: "",
              active: true,
            }
          : {
              code: rule.code,
              permissionA: rule.permissionA,
              permissionB: rule.permissionB,
              mode: rule.mode,
              descriptionEn: rule.descriptionEn,
              descriptionBn: rule.descriptionBn,
              active: rule.active,
            }
    )
  }
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [field]: value } : d))
  const valid =
    !!draft &&
    /^[A-Z0-9][A-Z0-9-]{2,15}$/.test(draft.code) &&
    !!draft.permissionA &&
    !!draft.permissionB &&
    draft.permissionA !== draft.permissionB &&
    draft.descriptionEn.trim().length >= 2 &&
    draft.descriptionBn.trim().length >= 1

  const submit = async () => {
    if (!draft || !draft.permissionA || !draft.permissionB) return
    const existing = rule !== "new" && rule ? rule : null
    const result = await command.run({
      id: existing?.id,
      expectedVersion: existing?.version,
      code: draft.code,
      permissionA: draft.permissionA,
      permissionB: draft.permissionB,
      mode: draft.mode,
      descriptionEn: draft.descriptionEn,
      descriptionBn: draft.descriptionBn,
      active: draft.active,
    })
    if (!result) return
    toast.success(t("rbac.sod.saved", { code: draft.code }))
    onClose()
  }

  const keyPicker = (
    value: string | null,
    onChange: (key: string | null) => void,
    testId: string,
    allowAny: boolean
  ) => (
    <SearchPicker
      items={allowAny ? KEY_ITEMS : KEY_ITEMS.slice(1)}
      value={value}
      onChange={(id) => onChange(id)}
      getId={(i) => i.key}
      searchText={(i) => `${i.key} ${keyLabel(i.key)}`}
      renderValue={(i) => keyLabel(i.key)}
      renderItem={(i) => (
        <span className="flex flex-col">
          <span>{keyLabel(i.key)}</span>
          <Mono className="text-muted-foreground">{i.key}</Mono>
        </span>
      )}
      placeholder={t("rbac.sod.pickKey")}
      testId={testId}
    />
  )

  return (
    <Dialog open={rule !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl" data-testid="sod-form">
        <DialogHeader>
          <DialogTitle className="text-[1.0625rem] font-semibold">
            {rule === "new" || rule === null
              ? t("rbac.sod.formNew")
              : t("rbac.sod.formEdit", { code: rule.code })}
          </DialogTitle>
        </DialogHeader>
        {draft ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("rbac.sod.code")}>
              <Input
                lang="en"
                value={draft.code}
                onChange={(e) =>
                  set(
                    "code",
                    e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "")
                  )
                }
                className="font-mono"
                data-testid="sod-code"
              />
            </Field>
            <Field label={t("rbac.sod.columns.mode")}>
              <OptionSelect
                value={draft.mode}
                onChange={(v) => set("mode", v as Draft["mode"])}
                label={t("rbac.sod.columns.mode")}
                className="w-full"
                testId="sod-mode"
                options={[
                  { value: "warn", label: t("rbac.sod.mode.warn") },
                  { value: "block", label: t("rbac.sod.mode.block") },
                ]}
              />
            </Field>
            <Field label={t("rbac.sod.a")}>
              {keyPicker(
                draft.permissionA,
                (k) => set("permissionA", k),
                "sod-a",
                false
              )}
            </Field>
            <Field label={t("rbac.sod.b")}>
              {keyPicker(
                draft.permissionB,
                (k) => set("permissionB", k),
                "sod-b",
                true
              )}
            </Field>
            <Field
              label={t("rbac.sod.descriptionEn")}
              className="sm:col-span-2"
            >
              <Input
                value={draft.descriptionEn}
                onChange={(e) => set("descriptionEn", e.target.value)}
                data-testid="sod-description-en"
              />
            </Field>
            <Field
              label={t("rbac.sod.descriptionBn")}
              className="sm:col-span-2"
            >
              <Input
                value={draft.descriptionBn}
                onChange={(e) => set("descriptionBn", e.target.value)}
                data-testid="sod-description-bn"
              />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-[0.8125rem] sm:col-span-2">
              {t("rbac.sod.active")}
              <Switch
                checked={draft.active}
                onCheckedChange={(on) => set("active", !!on)}
              />
            </label>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("rbac.common.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={!valid || command.pending}
            data-testid="sod-save"
          >
            {t("rbac.sod.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
