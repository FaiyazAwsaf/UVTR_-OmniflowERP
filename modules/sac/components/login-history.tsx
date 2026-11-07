"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { X } from "lucide-react"

import { DateField } from "@/components/shared/date-field"
import { DateText } from "@/components/shared/date-text"
import { PageHeader } from "@/components/shared/page-header"
import { SearchPicker } from "@/components/shared/pickers"
import { StatusText } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { DAY, addDaysISO, dhakaDate, startOfDhakaDay } from "@/core/clock/dates"
import { now } from "@/core/clock/clock"
import { useDb } from "@/core/db/DbProvider"
import type { LoginEventRow, UserRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"

import { LOGIN_RESULT_TONE, personName, useUserDirectory } from "../queries"
import { Field, ListTable, Mono, OptionSelect, type ListColumn } from "./kit"

const RESULTS: LoginEventRow["result"][] = ["success", "bad-password", "locked", "disabled", "mfa-failed", "unknown-user"]

/** /sac/login-history: every sign-in attempt with filters by user, result and date (plan §9). */
export function LoginHistory() {
  const { t, tk, locale } = useLocale()
  const db = useDb()
  const params = useSearchParams()
  const directory = useUserDirectory()
  const [today] = React.useState(() => dhakaDate(now()))
  const [username, setUsername] = React.useState<string | null>(params.get("for"))
  const [result, setResult] = React.useState("all")
  const [from, setFrom] = React.useState(() => addDaysISO(today, -29))
  const [to, setTo] = React.useState(today)

  const rows = useLiveQuery(async () => {
    const lo = from ? startOfDhakaDay(from) : 0
    const hi = to ? startOfDhakaDay(to) + DAY - 1 : Number.MAX_SAFE_INTEGER
    const list = await db.loginEvents.where("at").between(lo, hi, true, true).reverse().sortBy("at")
    return list.filter((e) => (!username || e.username === username) && (result === "all" || e.result === result))
  }, [db, from, to, username, result])

  const userByName = new Map((directory?.users ?? []).map((u) => [u.username, u]))
  const columns: ListColumn<LoginEventRow>[] = [
    { id: "at", header: t("sac.logins.columns.at"), cell: (e) => <DateText value={e.at} variant="dmyTime" /> },
    {
      id: "user",
      header: t("sac.logins.columns.user"),
      cell: (e) => {
        const user = userByName.get(e.username)
        return user ? (
          <Link href={`/sac/users/${user.id}`} className="min-w-0">
            <span className="block truncate font-medium hover:underline">{personName(user, locale)}</span>
            <Mono className="block text-muted-foreground">{e.username}</Mono>
          </Link>
        ) : (
          <Mono>{e.username}</Mono>
        )
      },
    },
    {
      id: "result",
      header: t("sac.logins.columns.result"),
      cell: (e) => (
        <StatusText tone={LOGIN_RESULT_TONE[e.result]} dot>
          {tk(`reports.enum.loginResult.${e.result}`)}
        </StatusText>
      ),
    },
    {
      id: "method",
      header: t("sac.logins.columns.method"),
      hideBelow: "md",
      cell: (e) => <span className="text-muted-foreground">{tk(`sac.logins.method.${e.method}`)}</span>,
    },
    {
      id: "window",
      header: t("sac.logins.columns.window"),
      hideBelow: "xl",
      cell: (e) => <Mono className="text-muted-foreground">{e.windowId}</Mono>,
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("sac.logins.title")} subtitle={t("sac.logins.subtitle")} />
      <section className="surface-card flex min-w-0 flex-col gap-4 p-4 md:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("sac.logins.columns.user")}>
            <div className="flex items-center gap-1">
              <SearchPicker<UserRow>
                items={directory?.users}
                value={username ? (userByName.get(username)?.id ?? null) : null}
                onChange={(_, user) => setUsername(user?.username ?? null)}
                getId={(u) => u.id}
                searchText={(u) => `${u.nameEn} ${u.nameBn} ${u.username}`}
                renderValue={(u) => personName(u, locale)}
                renderItem={(u) => (
                  <span className="flex items-center justify-between gap-2">
                    {personName(u, locale)} <Mono className="text-muted-foreground">{u.username}</Mono>
                  </span>
                )}
                placeholder={t("sac.common.allUsers")}
                testId="login-user"
              />
              {username ? (
                <Button variant="ghost" size="icon-sm" onClick={() => setUsername(null)} aria-label={t("common.clear")}>
                  <X />
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label={t("sac.logins.columns.result")}>
            <OptionSelect
              value={result}
              onChange={setResult}
              label={t("sac.logins.columns.result")}
              testId="login-result"
              className="w-full"
              options={[
                { value: "all", label: t("sac.logins.allResults") },
                ...RESULTS.map((r) => ({ value: r, label: tk(`reports.enum.loginResult.${r}`) })),
              ]}
            />
          </Field>
          <Field label={t("common.from")}>
            <DateField value={from} onChange={setFrom} max={to || undefined} data-testid="login-from" />
          </Field>
          <Field label={t("common.to")}>
            <DateField value={to} onChange={setTo} min={from || undefined} data-testid="login-to" />
          </Field>
        </div>
        <ListTable
          rows={rows}
          columns={columns}
          rowKey={(e) => e.id}
          dense
          rowProps={(e) => ({ "data-testid": "login-row", "data-username": e.username, "data-result": e.result })}
          empty={<p className="py-8 text-center text-sm text-muted-foreground">{t("sac.logins.empty")}</p>}
        />
      </section>
    </div>
  )
}
