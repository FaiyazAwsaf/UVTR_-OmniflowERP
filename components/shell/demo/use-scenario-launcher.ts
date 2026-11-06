"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { feedbackFor, useEngineFeedback } from "@/core/engine/feedback"
import { SCENARIOS } from "@/core/scenarios/registry"
import { runScenario } from "@/core/scenarios/runner"
import type { ScenarioDef } from "@/core/scenarios/types"
import { getSession, updateSession } from "@/core/session/session"

import { useDemoUi } from "./store"

export type LaunchState = {
  /** Id of the launcher whose setup is running */
  running: string | null
  /** The last failed launcher and why */
  failed: { id: string; message: string } | null
}

/**
 * Launches a scenario in this window (plan §10): runs its setup through the
 * engine, signs the window in as the scenario's user (quick demo sign-in),
 * opens the cue card and goes to the scenario's screen. A refused setup shows
 * the engine's usual dialog and stays on the current screen.
 */
export function useScenarioLauncher() {
  const router = useRouter()
  const [state, setState] = React.useState<LaunchState>({
    running: null,
    failed: null,
  })
  const busy = React.useRef(false)

  const launch = React.useCallback(
    async (scenario: ScenarioDef): Promise<boolean> => {
      if (busy.current) return false
      busy.current = true
      setState({ running: scenario.id, failed: null })
      try {
        const { outcome, route } = await runScenario(scenario)
        const cue = { scenarioId: scenario.id, step: 0, params: outcome.params }
        const session = getSession()
        const signedInAsUser = session.userId === `usr_${scenario.user}` && !!session.sessionId
        useDemoUi.getState().setPanelOpen(false)
        if (signedInAsUser) {
          updateSession({ cue })
          router.push(route)
        } else {
          // The session gate signs the window in, then opens the route.
          updateSession({ cue, pendingQuickSignIn: scenario.user, pendingRoute: route })
        }
        setState({ running: null, failed: null })
        return true
      } catch (error) {
        console.error(`scenario ${scenario.id} setup failed`, error)
        useEngineFeedback
          .getState()
          .show(feedbackFor(error, `scenario.${scenario.id}`))
        setState({
          running: null,
          failed: {
            id: scenario.id,
            message: error instanceof Error ? error.message : String(error),
          },
        })
        return false
      } finally {
        busy.current = false
      }
    },
    [router]
  )

  return { ...state, launch }
}

/**
 * `?launch=E3` on any page launches that scenario once the engine is ready
 * (for bookmarks, the 4-window opener and browser tests). The param is
 * removed from the address first so a reload does not launch it again.
 */
export function ScenarioUrlLauncher() {
  const { launch } = useScenarioLauncher()
  const done = React.useRef(false)
  React.useEffect(() => {
    if (done.current) return
    done.current = true
    const url = new URL(window.location.href)
    const id = url.searchParams.get("launch")
    if (!id) return
    url.searchParams.delete("launch")
    window.history.replaceState(window.history.state, "", url.toString())
    const scenario = SCENARIOS.find((s) => s.id === id)
    if (scenario) void launch(scenario)
  }, [launch])
  return null
}
