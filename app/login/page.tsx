"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { KeyRound, LogIn } from "lucide-react"

import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { TenantMark } from "@/components/shared/tenant-mark"
import { Wordmark } from "@/components/shell/app-sidebar"
import { LanguageToggle, ThemeToggle } from "@/components/shell/toggles"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { tenant } from "@/config/brand.config"
import { rules } from "@/config/rules.config"
import { getCentralDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { SYSTEM_ACTOR } from "@/core/engine/types"
import { ROLE_LANDING, findSeedUser } from "@/core/security/seed-users"
import { signIn, verifyMfa, type SignInResult } from "@/core/security/signin"
import { setSignedIn, useSession } from "@/core/session/session"
import { windowKey } from "@/core/session/windowId"
import { useLocale } from "@/lib/i18n/provider"

/**
 * "/login" (plan §3.8, ui_guidelines §6): username and password, the
 * simulated MFA step, lockout and "signed out by an administrator" notices.
 * WS-Shell refines the look; the rules are the sign-in commands'.
 */
function LoginForm() {
  const { t, locale } = useLocale()
  const router = useRouter()
  const params = useSearchParams()
  const { signedOutReason } = useSession()
  const [username, setUsername] = React.useState(params.get("user") ?? "")
  const [password, setPassword] = React.useState("")
  const [code, setCode] = React.useState("")
  const [mfaUserId, setMfaUserId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const finish = (result: SignInResult) => {
    if (result.status === "ok") {
      setSignedIn(result)
      const seed = findSeedUser(username.trim().toLowerCase())
      const next = params.get("next")
      router.push(next && next.startsWith("/") ? next : seed ? ROLE_LANDING[seed.role] : "/home")
      return
    }
    if (result.status === "mfa") {
      setMfaUserId(result.userId)
      setError(null)
      return
    }
    const reason = {
      "bad-credentials": t("login.badCredentials"),
      locked: t("login.locked"),
      disabled: t("login.disabled"),
      "mfa-failed": t("login.mfaFailed"),
    }[result.reason]
    const left =
      result.attemptsLeft !== undefined ? ` ${t("login.attemptsLeft", { count: result.attemptsLeft })}` : ""
    setError(`${reason}${left}`)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const ctx = { db: getCentralDb(), actor: SYSTEM_ACTOR }
      const result = mfaUserId
        ? await commit(verifyMfa, { userId: mfaUserId, code, windowId: windowKey() }, ctx)
        : await commit(signIn, { username, password, windowId: windowKey(), method: "password" }, ctx)
      finish(result.result)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="surface-card flex w-full max-w-sm flex-col gap-4 p-6"
      data-testid="login-form"
    >
      <div className="flex items-center gap-3">
        <TenantMark size={40} />
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{t("login.title")}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {t("login.subtitle", { tenant: tenant.shortName[locale] })}
          </p>
        </div>
      </div>
      {signedOutReason && signedOutReason !== "sign-out" ? (
        <p data-testid="signed-out-notice" className="rounded-md bg-[color-mix(in_oklch,var(--info)_14%,transparent)] px-3 py-2 text-sm text-info">
          {t(`shell.signedOut.${signedOutReason}`)}
        </p>
      ) : null}
      {mfaUserId ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="size-4 text-primary" />
            {t("login.mfaTitle")}
          </p>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {t("login.mfaBody", { code: rules.mfaCode })} <SimulatedBadge />
          </p>
          <Label htmlFor="mfa">{t("login.mfaCode")}</Label>
          <Input
            id="mfa"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="login-mfa"
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="username">{t("login.username")}</Label>
            <Input
              id="username"
              lang="en"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              data-testid="login-username"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">{t("login.password")}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
            />
          </div>
        </>
      )}
      {error ? (
        <p role="alert" data-testid="login-error" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || (!mfaUserId && !username)} data-testid="login-submit">
        <LogIn />
        {busy ? t("login.signingIn") : mfaUserId ? t("login.verify") : t("login.submit")}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t("login.simulatedNote")}</p>
      <Link href="/" className="text-center text-sm text-link hover:underline">
        {t("login.toLauncher")}
      </Link>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <div className="absolute top-4 right-4 flex items-center gap-1.5">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <Wordmark className="text-[1.75rem]" />
      <React.Suspense fallback={null}>
        <LoginForm />
      </React.Suspense>
    </div>
  )
}
