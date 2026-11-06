"use client"

import * as React from "react"

import { getCentralDb, type OmniflowDb } from "./database"

const DbContext = React.createContext<OmniflowDb | null>(null)

/** Provides the central database (plan §3.2: one store, no edge stores). */
export function DbProvider({ children }: { children: React.ReactNode }) {
  const db = getCentralDb()
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>
}

/** The database this window reads and writes. Use with `useLiveQuery`. */
export function useDb(): OmniflowDb {
  const context = React.useContext(DbContext)
  if (!context) throw new Error("useDb must be used inside <DbProvider>")
  return context
}
