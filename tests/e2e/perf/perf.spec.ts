import { expect, test, type Page } from "@playwright/test"

import { rows, signIn, typeInto, windowAs } from "../stl/helpers"

/**
 * P4.5 performance on the full seed, in a real browser (Chromium, real
 * IndexedDB): the seed under 5 s, a counter checkout commit under 150 ms,
 * the heaviest launcher setups and commits, and no jank in four windows plus
 * the Demo Wall while another window commits. Timing checks only mean
 * something on a quiet machine, so this runs only with PERF=1, alone:
 *   PERF=1 E2E_PORT=3100 bunx playwright test tests/e2e/perf --workers 1
 * Each test prints its measurements (`perf:` lines) for the progress log.
 */
test.skip(!process.env.PERF, "PERF not set")
test.describe.configure({ mode: "serial" })

type Timing = {
  command: string
  lockMs: number
  runMs: number
  checkMs: number
  writeMs: number
  totalMs: number
  changes: number
}

const timings = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __omniflowCommits?: () => Timing[] }
      ).__omniflowCommits?.() ?? []
  )
const ms = (n: number) => `${Math.round(n)} ms`
const describe = (t: Timing) =>
  `${t.command}: total ${ms(t.totalMs)} (lock ${ms(t.lockMs)}, run ${ms(t.runMs)}, checks ${ms(t.checkMs)}, write ${ms(t.writeMs)}; ${t.changes} rows)`

/** Launch by URL and wait for the cue card; returns the wall time from navigation to the cue. */
async function timedLaunch(page: Page, id: string): Promise<number> {
  const started = Date.now()
  await page.goto(`/?launch=${id}`)
  await expect(
    page.locator(`[data-testid="cue-card"][data-scenario-id="${id}"]`)
  ).toBeVisible({ timeout: 90_000 })
  const took = Date.now() - started
  await page.getByTestId("cue-close").click()
  return took
}

/** Long tasks (over 50 ms) in a page and its same-origin frames, from now on. */
async function watchLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[] }
    w.__longTasks = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__longTasks.push(entry.duration)
    }).observe({ type: "longtask", buffered: false })
  })
}
const longTasks = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __longTasks: number[] }).__longTasks ?? []
  )

test("the full seed takes under 5 s in the browser, first load and reset", async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.goto("/")
  const status = page.getByTestId("seed-status").first()
  await expect(status).toHaveAttribute("data-seed-ms", /\d+/, {
    timeout: 90_000,
  })
  const first = Number(await status.getAttribute("data-seed-ms"))
  console.log(`perf: seed on first load ${ms(first)}`)
  expect(first).toBeLessThan(5_000)
  // A reset from the launcher clears the store and seeds again.
  await page.getByTestId("demo-reset").first().click()
  const confirm = page.getByTestId("demo-reset-confirm")
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect
    .poll(
      async () =>
        Number(
          await page
            .getByTestId("seed-status")
            .first()
            .getAttribute("data-seed-ms")
        ),
      { timeout: 90_000 }
    )
    .not.toBe(first)
  const again = Number(
    await page.getByTestId("seed-status").first().getAttribute("data-seed-ms")
  )
  console.log(`perf: seed on reset ${ms(again)}`)
  expect(again).toBeLessThan(5_000)
})

test("a counter checkout commits in under 150 ms", async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page, "tania")
  const setup = await timedLaunch(page, "J4")
  console.log(`perf: J4 setup (journey to delivered) ${ms(setup)}`)
  const orders = await rows<{
    orderNo: string
    status: string
    vehicleId?: string
    createdAt: number
  }>(page, "salesOrders")
  const order = orders
    .filter(
      (o) =>
        o.vehicleId === "veh_corolla_cross_7731" && o.status === "delivered"
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  await page
    .locator(`[data-testid="counter-order"][data-order-no="${order.orderNo}"]`)
    .click()
  await page.getByTestId("tender-card").click()
  await typeInto(page.getByTestId("tender-amount").first(), "20000")
  await page.getByTestId("tender-cash").click()
  await page.getByTestId("checkout-submit").click()
  await page.getByTestId("card-approve").click()
  await expect(page.getByTestId("counter-receipt")).toBeVisible()
  const checkout = (await timings(page))
    .filter((t) => t.command === "si.checkout")
    .at(-1)!
  console.log(`perf: ${describe(checkout)}`)
  expect(checkout.totalMs).toBeLessThan(150)
})

test("the heaviest launcher setups and commits (E2 setup, E7 auto-match)", async ({
  page,
}) => {
  test.setTimeout(300_000)
  await signIn(page, "shahriar")
  const e2 = await timedLaunch(page, "E2")
  const e2Commits = await timings(page)
  const slowest = [...e2Commits]
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 3)
  console.log(
    `perf: E2 setup ${ms(e2)} for ${e2Commits.length} commits; slowest: ${slowest.map(describe).join("; ")}`
  )
  expect(e2).toBeLessThan(3_000)

  const e7 = await timedLaunch(page, "E7")
  console.log(`perf: E7 setup ${ms(e7)}`)
  await page.getByTestId("recon-auto").click()
  await expect(
    page.locator('[data-testid="recon-line"][data-matched="false"]')
  ).toHaveCount(2)
  const auto = (await timings(page))
    .filter((t) => t.command === "cab.autoMatch")
    .at(-1)!
  console.log(`perf: ${describe(auto)}`)
  expect(auto.totalMs).toBeLessThan(1_000)
})

test("four windows plus the Demo Wall stay smooth while another window commits", async ({
  context,
}) => {
  test.setTimeout(300_000)
  // The wall (4 panes in one tab) and three more windows on live screens.
  const wall = await context.newPage()
  await wall.setViewportSize({ width: 1920, height: 1200 })
  await wall.goto("/wall?users=nayeem,rakib,tania,mahbub")
  await expect(wall.getByTestId("demo-wall")).toBeVisible()
  for (let i = 1; i <= 4; i++) {
    const frame = wall.frameLocator(`iframe[name="of-wall-${i}"]`)
    await expect(frame.locator('[data-slot="erp-shell"]')).toBeVisible({
      timeout: 90_000,
    })
  }
  const watchers: Page[] = [wall]
  for (const [user, route] of [
    ["rashed", "/dashboard"],
    ["shahriar", "/stl/board"],
    ["habib", "/ic"],
  ] as const) {
    const page = await windowAs(context, user)
    await page.goto(route)
    await expect(page.locator('[data-slot="erp-shell"]')).toBeVisible()
    watchers.push(page)
  }
  // The fourth window does the work: the journey's booking to delivery (J4's setup), then
  // E2's 18 fresh fleet jobs from booking to delivery, over 100 real commits in a row.
  const worker = await windowAs(context, "tania")
  await worker.waitForTimeout(3_000)
  for (const page of watchers) await watchLongTasks(page)
  const started = Date.now()
  let commits = 0
  for (const id of ["J4", "E2"]) {
    await timedLaunch(worker, id)
    // Each launch loads a fresh page, so its timings are that setup's commits.
    commits += (await timings(worker)).length
  }
  // Let the other windows catch up with the last commit.
  await worker.waitForTimeout(3_000)
  const seconds = (Date.now() - started) / 1000
  const names = ["wall", "rashed", "shahriar", "habib"]
  let worst = 0
  for (const [i, page] of watchers.entries()) {
    const tasks = await longTasks(page)
    const max = Math.max(0, ...tasks)
    const blocking = tasks.reduce((s, d) => s + Math.max(0, d - 50), 0)
    worst = Math.max(worst, max)
    console.log(
      `perf: ${names[i]} during ${commits} commits over ${seconds.toFixed(1)} s: ${tasks.length} long tasks, longest ${ms(max)}, blocking ${ms(blocking)}`
    )
  }
  // No single freeze a presenter would notice (a dropped click or a stuck animation).
  expect(worst).toBeLessThan(250)
})
