"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import {
  AArrowDown,
  AArrowUp,
  Car,
  FileText,
  Languages,
  LayoutGrid,
  Moon,
  PanelLeft,
  RotateCcw,
  Sun,
  UserRound,
  type LucideIcon,
} from "lucide-react"

import { AppChip } from "@/components/shared/app-frame"
import { groupLabelKey, groupNav, navFor } from "@/components/shell/nav"
import { stepUiScale } from "@/components/shell/ui-scale"
import { useWindowTheme } from "@/components/theme-provider"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useDb } from "@/core/db/DbProvider"
import type { NavItem } from "@/core/security/types"
import { usePermissions } from "@/core/security/useCan"
import { useModKey } from "@/hooks/use-mod-key"
import { en, lookup } from "@/lib/i18n"
import { LOCALE_META, LOCALES } from "@/lib/i18n/config"
import { useLocale } from "@/lib/i18n/provider"
import { setWindowUiScale, UI_SCALE_STEP, useUi } from "@/lib/store"

import { usePalette } from "./palette-store"
import { EMPTY_RESULTS, normalizeQuery, searchAll, type DocHit } from "./search"

/**
 * Cmd/Ctrl+K opens the palette and Cmd/Ctrl+B flips the sidebar, in this
 * window only. Mount once per shell.
 */
export function useShellHotkeys() {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      const key = event.key.toLowerCase()
      if (key === "k") {
        event.preventDefault()
        const { commandOpen, setCommandOpen } = useUi.getState()
        if (!commandOpen) usePalette.getState().setQuery("")
        setCommandOpen(!commandOpen)
      } else if (key === "b") {
        event.preventDefault()
        useUi.getState().toggleSidebar()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}

/** The query after the user pauses typing (keeps the database reads light). */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return debounced
}

type Entry = {
  key: string
  href: string
  label: string
  /** Extra words that match (English label, app code, href) */
  haystack: string
  icon: LucideIcon
  app?: string
}

/** Every app and screen the user may open: sidebar entries and their tabs. */
function useEntries(): Entry[] {
  const { tk } = useLocale()
  const { can } = usePermissions()
  return React.useMemo(() => {
    const items: NavItem[] = navFor((key) => can(key))
    const out: Entry[] = []
    const seen = new Set<string>()
    for (const item of items) {
      const label = tk(item.labelKey)
      seen.add(item.href)
      out.push({
        key: item.href,
        href: item.href,
        label,
        haystack: [label, lookup(en, item.labelKey), item.app ?? "", item.href].join(" ").toLowerCase(),
        icon: item.icon,
        app: item.app,
      })
      for (const section of item.sections ?? []) {
        if (seen.has(section.href)) continue
        if (!can(section.permission ?? item.permission)) continue
        seen.add(section.href)
        const sectionLabel = tk(section.labelKey)
        out.push({
          key: section.href,
          href: section.href,
          label: `${label} · ${sectionLabel}`,
          haystack: [
            label,
            sectionLabel,
            lookup(en, item.labelKey),
            lookup(en, section.labelKey),
            item.app ?? "",
            section.href,
          ]
            .join(" ")
            .toLowerCase(),
          icon: item.icon,
          app: item.app,
        })
      }
    }
    return out
  }, [can, tk])
}

function matchesAll(haystack: string, query: string): boolean {
  const tokens = query.toLowerCase().split(" ").filter(Boolean)
  return tokens.every((token) => haystack.includes(token))
}

const camel = (value: string) => value.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

/**
 * The command palette (Cmd/Ctrl+K, or the top-bar search field): jump to any
 * app or screen this user may open, find parties, vehicles and documents by
 * number (global search, plan §12 P1.11), switch language, theme and display
 * size. Search results respect the user's live permissions.
 */
export function CommandPalette() {
  const router = useRouter()
  const db = useDb()
  const { t, tk, locale, setLocale } = useLocale()
  const { can } = usePermissions()
  const open = useUi((state) => state.commandOpen)
  const setOpen = useUi((state) => state.setCommandOpen)
  const query = usePalette((state) => state.query)
  const setQuery = usePalette((state) => state.setQuery)
  const { theme, setTheme } = useWindowTheme()
  const mod = useModKey()
  const groups = React.useMemo(() => groupNav(navFor((key) => can(key))), [can])
  const entries = useEntries()
  const inputRef = React.useRef<HTMLInputElement>(null)

  const q = normalizeQuery(query)
  const searchText = useDebounced(q, 150)
  const results = useLiveQuery(
    () => (open && searchText.length >= 2 ? searchAll(db, searchText, can) : EMPTY_RESULTS),
    [db, open, searchText, can]
  )

  // Opened from the top-bar field with text already typed: caret to the end.
  React.useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current
      if (input) input.setSelectionRange(input.value.length, input.value.length)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const run = (action: () => void) => {
    setOpen(false)
    action()
  }
  const go = (href: string) => run(() => router.push(href))

  const preferences: { key: string; words: string; icon: LucideIcon; label: string; shortcut?: string; onSelect: () => void }[] = [
    ...LOCALES.filter((code) => code !== locale).map((code) => ({
      key: `lang-${code}`,
      words: `language ভাষা ${LOCALE_META[code].label} ${LOCALE_META[code].nativeLabel} ${LOCALE_META[code].short}`,
      icon: Languages,
      label: t("shell.palette.language", { language: LOCALE_META[code].nativeLabel }),
      onSelect: () => setLocale(code),
    })),
    {
      key: "theme",
      words: `theme থিম dark light ${t("shell.palette.themeLight")} ${t("shell.palette.themeDark")}`,
      icon: theme === "dark" ? Sun : Moon,
      label: theme === "dark" ? t("shell.palette.themeLight") : t("shell.palette.themeDark"),
      onSelect: () => setTheme(theme === "dark" ? "light" : "dark"),
    },
    {
      key: "scale-up",
      words: `scale larger ${t("shell.palette.scaleUp")}`,
      icon: AArrowUp,
      label: t("shell.palette.scaleUp"),
      onSelect: () => stepUiScale(UI_SCALE_STEP),
    },
    {
      key: "scale-down",
      words: `scale smaller ${t("shell.palette.scaleDown")}`,
      icon: AArrowDown,
      label: t("shell.palette.scaleDown"),
      onSelect: () => stepUiScale(-UI_SCALE_STEP),
    },
    {
      key: "scale-reset",
      words: `scale reset ${t("shell.palette.scaleReset")}`,
      icon: RotateCcw,
      label: t("shell.palette.scaleReset"),
      onSelect: () => setWindowUiScale(1),
    },
    {
      key: "sidebar",
      words: `sidebar ${t("shell.palette.toggleSidebar")}`,
      icon: PanelLeft,
      label: t("shell.palette.toggleSidebar"),
      shortcut: `${mod} B`,
      onSelect: () => useUi.getState().toggleSidebar(),
    },
    {
      key: "launcher",
      words: `launcher switch user ${t("shell.palette.launcher")}`,
      icon: LayoutGrid,
      label: t("shell.palette.launcher"),
      onSelect: () => router.push("/"),
    },
  ]
  const shownPreferences = q ? preferences.filter((p) => matchesAll(p.words.toLowerCase(), q)) : preferences
  const shownEntries = q ? entries.filter((e) => matchesAll(e.haystack, q)).slice(0, 8) : []
  const found = q.length >= 2 ? (results ?? EMPTY_RESULTS) : EMPTY_RESULTS
  const name = (nameEn: string, nameBn: string) => (locale === "bn" && nameBn ? nameBn : nameEn)
  const docType = (doc: DocHit) => tk(`shell.search.types.${doc.table}`)
  const docStatus = (doc: DocHit) => {
    if (!doc.status) return null
    const key = `common.statuses.${camel(doc.status)}`
    const label = tk(key)
    return label === key ? null : label
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="top-[12%] translate-y-0 gap-0 overflow-hidden rounded-lg! p-0 sm:max-w-xl"
        showCloseButton={false}
        initialFocus={inputRef}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("shell.commandHint")}</DialogTitle>
          <DialogDescription>{t("shell.palette.placeholder")}</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} loop>
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder={t("shell.palette.placeholder")}
            data-testid="palette-input"
          />
          <CommandList className="max-h-[min(28rem,60svh)]" data-testid="palette-results">
            <CommandEmpty>
              <span className="block">{t("common.noResults")}</span>
              <span className="mt-1 block px-6 text-xs">{t("shell.search.hint")}</span>
            </CommandEmpty>

            {!q
              ? groups.map((group) => (
                  <CommandGroup
                    key={group.group}
                    heading={`${t("shell.palette.goTo")} · ${tk(groupLabelKey(group.group))}`}
                  >
                    {group.items.map((item) => (
                      <CommandItem key={item.href} value={`nav:${item.href}`} onSelect={() => go(item.href)}>
                        <item.icon />
                        <span className="min-w-0 flex-1 truncate">{tk(item.labelKey)}</span>
                        {item.app ? <AppChip app={item.app} /> : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))
              : null}

            {shownEntries.length ? (
              <CommandGroup heading={t("shell.search.screens")}>
                {shownEntries.map((entry) => (
                  <CommandItem
                    key={entry.key}
                    value={`screen:${entry.href}`}
                    onSelect={() => go(entry.href)}
                    data-testid="search-result"
                    data-kind="screen"
                  >
                    <entry.icon />
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    {entry.app ? <AppChip app={entry.app} /> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {found.docs.length ? (
              <CommandGroup heading={t("shell.search.documents")}>
                {found.docs.map((doc) => (
                  <CommandItem
                    key={`${doc.table}:${doc.id}`}
                    value={`doc:${doc.table}:${doc.id}`}
                    onSelect={() => go(doc.href)}
                    data-testid="search-result"
                    data-kind="doc"
                  >
                    <FileText />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span lang="en" className="truncate font-mono text-[0.8125rem] font-semibold">
                        {doc.docNo}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[docType(doc), doc.partyNameEn ? name(doc.partyNameEn, doc.partyNameBn ?? "") : null, docStatus(doc)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <AppChip app={doc.app} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {found.parties.length ? (
              <CommandGroup heading={t("shell.search.parties")}>
                {found.parties.map((party) => (
                  <CommandItem
                    key={party.id}
                    value={`party:${party.id}`}
                    onSelect={() => go(party.href)}
                    data-testid="search-result"
                    data-kind="party"
                  >
                    <UserRound />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{name(party.nameEn, party.nameBn)}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        <span lang="en" className="font-mono">
                          {party.code}
                        </span>
                        {" · "}
                        {party.isCustomer && party.isVendor
                          ? `${t("common.customer")}, ${t("common.vendor")}`
                          : party.isVendor
                            ? t("common.vendor")
                            : t("common.customer")}
                        {party.phone ? (
                          <>
                            {" · "}
                            <span lang="en" className="font-mono">
                              {party.phone}
                            </span>
                          </>
                        ) : null}
                      </span>
                    </span>
                    <AppChip app="par" />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {found.vehicles.length ? (
              <CommandGroup heading={t("shell.search.vehicles")}>
                {found.vehicles.map((vehicle) => (
                  <CommandItem
                    key={vehicle.id}
                    value={`vehicle:${vehicle.id}`}
                    onSelect={() => go(vehicle.href)}
                    data-testid="search-result"
                    data-kind="vehicle"
                  >
                    <Car />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span lang="en" className="truncate font-mono text-[0.8125rem] font-semibold uppercase">
                        {vehicle.regNo}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[`${vehicle.make} ${vehicle.model}`, name(vehicle.partyNameEn, vehicle.partyNameBn)]
                          .filter((s) => s.trim())
                          .join(" · ")}
                      </span>
                    </span>
                    <AppChip app="par" />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {shownPreferences.length ? (
              <>
                {!q ? <CommandSeparator /> : null}
                <CommandGroup heading={t("shell.palette.preferences")}>
                  {shownPreferences.map((pref) => (
                    <CommandItem key={pref.key} value={`pref:${pref.key}`} onSelect={() => run(pref.onSelect)}>
                      <pref.icon />
                      <span className="min-w-0 flex-1 truncate">{pref.label}</span>
                      {pref.shortcut ? <CommandShortcut>{pref.shortcut}</CommandShortcut> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
