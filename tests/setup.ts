// In-memory IndexedDB for engine tests (Dexie runs against it in Node).
import "fake-indexeddb/auto"

// TEST_DAY_SHIFT=<days> runs the suite as if the wall clock were that many
// days away, to catch tests that only pass on the day their seed data was read.
// TEST_DATE=YYYY-MM-DD pins today instead (edge dates: the 1st, the 2nd, the
// last day of a month, 05-07, 15-08): the clock starts at 10:00 Dhaka that day
// and then runs in real time (plan §14).
const realNow = Date.now.bind(Date)
const pinned = process.env.TEST_DATE
const shiftDays = Number(process.env.TEST_DAY_SHIFT ?? 0)
if (pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) {
  const started = realNow()
  const base = Date.parse(`${pinned}T04:00:00.000Z`)
  Date.now = () => base + (realNow() - started)
} else if (shiftDays) {
  Date.now = () => realNow() + shiftDays * 86_400_000
}
