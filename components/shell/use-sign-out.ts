"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { getCentralDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { signOut } from "@/core/security/signin"
import { useActor } from "@/core/session/actor"
import { setSignedOut } from "@/core/session/session"

/** Sign this window out: end its session row, then clear the window. */
export function useSignOut() {
  const router = useRouter()
  const actor = useActor()
  return React.useCallback(async () => {
    if (actor) {
      try {
        await commit(signOut, {}, { db: getCentralDb(), actor })
      } catch {
        // An ended session is already signed out.
      }
    }
    setSignedOut("sign-out")
    router.push("/login")
  }, [actor, router])
}
