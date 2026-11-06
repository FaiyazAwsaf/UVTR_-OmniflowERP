"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  AArrowDown,
  AArrowUp,
  Languages,
  LayoutGrid,
  Moon,
  PanelLeft,
  RotateCcw,
  Sun,
} from "lucide-react"

import { groupLabelKey, groupNav, navFor } from "@/components/shell/nav"
import { stepUiScale } from "@/components/shell/ui-scale"
import { useWindowTheme } from "@/components/theme-provider"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { usePermissions } from "@/core/security/useCan"
import { useModKey } from "@/hooks/use-mod-key"
import { LOCALE_META, LOCALES } from "@/lib/i18n/config"
import { useLocale } from "@/lib/i18n/provider"
import { setWindowUiScale, UI_SCALE_STEP, useUi } from "@/lib/store"

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

/**
 * The command palette: jump to any app or screen this user may open, switch
 * language, change theme and display size. WS-Shell adds the global search
 * (parties, vehicles, document numbers).
 */
export function CommandPalette() {
  const router = useRouter()
  const { t, tk, locale, setLocale } = useLocale()
  const { can } = usePermissions()
  const open = useUi((state) => state.commandOpen)
  const setOpen = useUi((state) => state.setCommandOpen)
  const { theme, setTheme } = useWindowTheme()
  const mod = useModKey()
  const groups = React.useMemo(() => groupNav(navFor((key) => can(key))), [can])

  const run = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("shell.commandHint")}
      description={t("shell.palette.placeholder")}
      className="sm:max-w-xl"
    >
      <CommandInput placeholder={t("shell.palette.placeholder")} />
      <CommandList className="max-h-[min(26rem,58svh)]">
        <CommandEmpty>{t("common.noResults")}</CommandEmpty>

        {groups.map((group) => (
          <CommandGroup
            key={group.group}
            heading={`${t("shell.palette.goTo")} · ${tk(groupLabelKey(group.group))}`}
          >
            {group.items.map((item) => (
              <CommandItem
                key={item.href}
                value={`${tk(item.labelKey)} ${item.app ?? ""} ${item.href}`}
                onSelect={() => run(() => router.push(item.href))}
              >
                <item.icon />
                <span className="truncate">{tk(item.labelKey)}</span>
                <span
                  lang="en"
                  className="ml-auto shrink-0 font-mono text-xs text-muted-foreground"
                >
                  {item.href}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        <CommandSeparator />
        <CommandGroup heading={t("shell.palette.preferences")}>
          {LOCALES.filter((code) => code !== locale).map((code) => (
            <CommandItem
              key={code}
              value={`language ভাষা ${LOCALE_META[code].label} ${LOCALE_META[code].nativeLabel}`}
              onSelect={() => run(() => setLocale(code))}
            >
              <Languages />
              {t("shell.palette.language", { language: LOCALE_META[code].nativeLabel })}
            </CommandItem>
          ))}
          <CommandItem
            value={`theme থিম ${t("shell.palette.themeLight")} ${t("shell.palette.themeDark")}`}
            onSelect={() => run(() => setTheme(theme === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
            {theme === "dark" ? t("shell.palette.themeLight") : t("shell.palette.themeDark")}
            <CommandShortcut>D</CommandShortcut>
          </CommandItem>
          <CommandItem
            value={`scale larger ${t("shell.palette.scaleUp")}`}
            onSelect={() => run(() => stepUiScale(UI_SCALE_STEP))}
          >
            <AArrowUp />
            {t("shell.palette.scaleUp")}
          </CommandItem>
          <CommandItem
            value={`scale smaller ${t("shell.palette.scaleDown")}`}
            onSelect={() => run(() => stepUiScale(-UI_SCALE_STEP))}
          >
            <AArrowDown />
            {t("shell.palette.scaleDown")}
          </CommandItem>
          <CommandItem
            value={`scale reset ${t("shell.palette.scaleReset")}`}
            onSelect={() => run(() => setWindowUiScale(1))}
          >
            <RotateCcw />
            {t("shell.palette.scaleReset")}
          </CommandItem>
          <CommandItem
            value={`sidebar ${t("shell.palette.toggleSidebar")}`}
            onSelect={() => run(() => useUi.getState().toggleSidebar())}
          >
            <PanelLeft />
            {t("shell.palette.toggleSidebar")}
            <CommandShortcut>{mod} B</CommandShortcut>
          </CommandItem>
          <CommandItem
            value={`launcher ${t("shell.palette.launcher")}`}
            onSelect={() => run(() => router.push("/"))}
          >
            <LayoutGrid />
            {t("shell.palette.launcher")}
          </CommandItem>
        </CommandGroup>

      </CommandList>
    </CommandDialog>
  )
}
