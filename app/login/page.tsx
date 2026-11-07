"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Lock,
  LogIn,
  ShieldAlert,
} from "lucide-react"

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
import { usePermissions } from "@/core/security/useCan"
import { setSignedIn, useSession } from "@/core/session/session"
import { windowKey } from "@/core/session/windowId"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

type Failure = Extract<SignInResult, { status: "failed" }>

/** Where a user lands after signing in: `?next=` when safe, else their role's landing route (plan §8). */
function landingFor(username: string, next: string | null): string {
  if (
    next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.startsWith("/login")
  )
    return next
  const seed = findSeedUser(username.trim().toLowerCase())
  return seed ? ROLE_LANDING[seed.role] : "/home"
}

/**
 * "/login" (plan §3.8, ui_guidelines §6): the canvas with a centred card, the
 * product wordmark above, the tenant's monogram and name inside; username and
 * password, the simulated MFA step, lockout and "signed out by an
 * administrator" notices, and the "simulated sign-in" note. The rules are the
 * sign-in commands' (failed attempts, lockout at the policy threshold).
 */
function LoginForm() {
  const { t, num, locale } = useLocale()
  const router = useRouter()
  const params = useSearchParams()
  const { signedOutReason, userId } = useSession()
  const { user: current } = usePermissions()
  const quickFailure = params.get("failed")
  const [username, setUsername] = React.useState(params.get("user") ?? "")
  const [password, setPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [code, setCode] = React.useState("")
  const [mfaUserId, setMfaUserId] = React.useState<string | null>(null)
  const [failure, setFailure] = React.useState<Failure | null>(() =>
    quickFailure === "locked" || quickFailure === "disabled"
      ? { status: "failed", reason: quickFailure }
      : null
  )
  const [busy, setBusy] = React.useState(false)

  const finish = (result: SignInResult) => {
    if (result.status === "ok") {
      setSignedIn(result)
      router.push(landingFor(username, params.get("next")))
      return
    }
    if (result.status === "mfa") {
      setMfaUserId(result.userId)
      setFailure(null)
      return
    }
    setFailure(result)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const ctx = { db: getCentralDb(), actor: SYSTEM_ACTOR }
      const result = mfaUserId
        ? await commit(
            verifyMfa,
            { userId: mfaUserId, code, windowId: windowKey() },
            ctx
          )
        : await commit(
            signIn,
            { username, password, windowId: windowKey(), method: "password" },
            ctx
          )
      finish(result.result)
    } finally {
      setBusy(false)
    }
  }

  const backToPassword = () => {
    setMfaUserId(null)
    setCode("")
    setPassword("")
    setFailure(null)
  }

  const locked = failure?.reason === "locked" || failure?.reason === "disabled"
  const message = failure
    ? {
        "bad-credentials": t("login.badCredentials"),
        locked: t("login.locked"),
        disabled: t("login.disabled"),
        "mfa-failed": t("login.mfaFailed"),
      }[failure.reason]
    : null

  return (
    <form
      onSubmit={submit}
      className="surface-card flex w-full max-w-[24rem] flex-col gap-5 p-6 sm:p-8"
      data-testid="login-form"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <TenantMark size={56} />
        <div className="min-w-0">
          <p className="text-[1.0625rem] font-semibold">
            {tenant.shortName[locale]}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("login.subtitle", { tenant: tenant.shortName[locale] })}
          </p>
        </div>
        <h1 className="sr-only">{t("login.title")}</h1>
      </div>

      {signedOutReason && signedOutReason !== "sign-out" ? (
        <p
          data-testid="signed-out-notice"
          data-reason={signedOutReason}
          className="flex items-start gap-2 rounded-md bg-[color-mix(in_oklch,var(--info)_14%,transparent)] px-3 py-2.5 text-sm text-info"
        >
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>{t(`shell.signedOut.${signedOutReason}`)}</span>
        </p>
      ) : null}

      {userId && current && !mfaUserId ? (
        <p
          className="rounded-md bg-surface-raised px-3 py-2 text-xs text-muted-foreground"
          data-testid="login-current"
        >
          {t("login.alreadySignedIn", {
            name: locale === "bn" ? current.nameBn : current.nameEn,
          })}{" "}
          <Link
            href={landingFor(current.username, null)}
            className="font-medium text-link hover:underline"
          >
            {t("login.continue")}
          </Link>
        </p>
      ) : null}

      {mfaUserId ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3 rounded-md bg-primary-soft px-3 py-2.5">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 text-sm">
              <p className="font-medium">{t("login.mfaTitle")}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{t("login.mfaBody", { code: rules.mfaCode })}</span>
                <SimulatedBadge />
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mfa">{t("login.mfaCode")}</Label>
            <Input
              id="mfa"
              lang="en"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="text-center font-mono text-lg tracking-[0.4em]"
              data-testid="login-mfa"
            />
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="username">{t("login.username")}</Label>
            <Input
              id="username"
              lang="en"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus={!username}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                if (locked) setFailure(null)
              }}
              data-testid="login-username"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">{t("login.password")}</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                autoFocus={!!username}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-11"
                data-testid="login-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={
                  showPassword
                    ? t("login.hidePassword")
                    : t("login.showPassword")
                }
                title={
                  showPassword
                    ? t("login.hidePassword")
                    : t("login.showPassword")
                }
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>
        </>
      )}

      {message ? (
        <div
          role="alert"
          data-testid="login-error"
          data-reason={failure?.reason}
          className={cn(
            "flex items-start gap-2 rounded-md px-3 py-2.5 text-sm",
            locked
              ? "bg-[color-mix(in_oklch,var(--destructive)_14%,transparent)] text-destructive"
              : "text-destructive"
          )}
        >
          {locked ? (
            <Lock className="mt-0.5 size-4 shrink-0" />
          ) : (
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          )}
          <span>
            {message}
            {failure?.attemptsLeft !== undefined
              ? ` ${t("login.attemptsLeft", { count: num(failure.attemptsLeft) })}`
              : ""}
          </span>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          size="lg"
          disabled={
            busy || (mfaUserId ? code.length < 1 : !username || !password)
          }
          data-testid="login-submit"
        >
          <LogIn />
          {busy
            ? t("login.signingIn")
            : mfaUserId
              ? t("login.verify")
              : t("login.submit")}
        </Button>
        {mfaUserId ? (
          <Button
            type="button"
            variant="ghost"
            onClick={backToPassword}
            data-testid="login-back"
          >
            <ArrowLeft />
            {t("login.back")}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col items-center gap-2 border-t border-hairline pt-4 text-center">
        <p className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
          <SimulatedBadge />
          <span>{t("login.simulatedNote")}</span>
        </p>
        <Link
          href="/"
          className="text-sm font-medium text-link hover:underline"
          data-testid="login-launcher"
        >
          {t("login.toLauncher")}
        </Link>
      </div>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 py-10 [@media(max-height:720px)]:gap-3 [@media(max-height:720px)]:py-4">
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
