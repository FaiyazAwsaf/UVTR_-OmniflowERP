"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"

import { getCentralDb } from "@/core/db/database"
import { useDb } from "@/core/db/DbProvider"
import { commit, touchSession } from "@/core/engine/commit"
import { SYSTEM_ACTOR } from "@/core/engine/types"
import { ROLE_LANDING, findSeedUser } from "@/core/security/seed-users"
import { signIn } from "@/core/security/signin"
import { setSignedIn, setSignedOut, updateSession, useSession } from "@/core/session/session"
import { windowKey } from "@/core/session/windowId"

/**
 * Per-window session upkeep (plan §3.8, §3.14), mounted once in the providers:
 * - performs a pending quick sign-in (`?user=<username>`, launcher, Demo Wall)
 *   as a demo-quick `sac.signIn`, then opens the user's landing route;
 * - watches this window's `sessions` row live: when an administrator ends it
 *   (or the idle sweeper times it out), the window signs out and shows /login;
 * - stamps activity (wall clock) at most once a minute.
 */
export function SessionGate() {
  const db = useDb()
  const router = useRouter()
  const { pendingQuickSignIn, pendingRoute, sessionId, userId } = useSession()
  const busy = React.useRef(false)

  React.useEffect(() => {
    if (!pendingQuickSignIn || busy.current) return
    busy.current = true
    void (async () => {
      try {
        const result = await commit(
          signIn,
          { username: pendingQuickSignIn, windowId: windowKey(), method: "demo-quick" },
          { db: getCentralDb(), actor: SYSTEM_ACTOR }
        )
        const outcome = result.result
        if (outcome.status === "ok") {
          setSignedIn(outcome)
          const seed = findSeedUser(pendingQuickSignIn)
          const target = pendingRoute ?? (window.location.pathname === "/" || window.location.pathname === "/login"
            ? (seed ? ROLE_LANDING[seed.role] : "/home")
            : null)
          updateSession({ pendingRoute: null })
          if (target) router.push(target)
        } else {
          updateSession({ pendingQuickSignIn: null, pendingRoute: null })
          const reason = outcome.status === "failed" ? outcome.reason : "mfa"
          router.push(`/login?user=${encodeURIComponent(pendingQuickSignIn)}&failed=${reason}`)
        }
      } finally {
        busy.current = false
      }
    })()
  }, [pendingQuickSignIn, pendingRoute, router])

  const session = useLiveQuery(
    () => (sessionId ? db.sessions.get(sessionId) : undefined),
    [db, sessionId]
  )
  React.useEffect(() => {
    if (!sessionId || session === undefined) return
    if (session.endedAt !== undefined && session.endedReason !== "sign-out") {
      setSignedOut(session.endedReason ?? "forced")
      router.push("/login")
    }
  }, [session, sessionId, router])

  React.useEffect(() => {
    if (!sessionId || !userId) return
    let last = 0
    const stamp = () => {
      const wall = Date.now()
      if (wall - last < 60_000) return
      last = wall
      void touchSession(db, sessionId).catch(() => undefined)
    }
    stamp()
    window.addEventListener("pointerdown", stamp)
    window.addEventListener("keydown", stamp)
    return () => {
      window.removeEventListener("pointerdown", stamp)
      window.removeEventListener("keydown", stamp)
    }
  }, [db, sessionId, userId])

  return null
}
