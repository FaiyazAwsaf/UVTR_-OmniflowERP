# UVTR_OmniflowERP

A clickable demo of **UVTR_OmniflowERP**, the SME package by UVTR Infotech: 18 apps in four suites, running the books and operations of **Automania**, a car detailing business in Bangladesh.

| Suite                                | Apps                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| FMS, Financial Management System     | FA Core Accounting, AP Accounts Payable, AR Accounts Receivable, CAB Cash & Bank Management, PAR Party Management, FRS Financial Reporting |
| SDM, Sales & Distribution Management | STL Sales Transaction Lifecycle, SI Sale Invoice, PC Product Configuration, SD Sale Delivery                                               |
| SCM, Supply Chain Management         | PTL Purchase Transactions (Local), PM Product Master, GRN Goods Receive Note, ST Stock Transactions, IC Inventory Control                  |
| CSC, Core System Components          | IRT Reporting Tool, SAC User Security, RBAC Role-Based Access Control                                                                      |

There is no backend. On first load the browser seeds months of synthetic history into IndexedDB, and every change goes through one transaction engine:

- a document, its stock movements and its balanced journal commit together or not at all;
- invariants are checked before each commit (balanced journals, open periods, no negative stock, maker-checker);
- every change lands in a hash-chained audit trail.

Windows in the same browser share the data and update live.

Everything in the demo is synthetic: people, phone numbers, customers, suppliers, prices, balances and tax rates. Bank, bKash, Nagad, card terminal, SMS, email, printer and NBR e-VAT connections are simulated and carry a "Simulated" badge.

## Run it

Requires [bun](https://bun.sh) 1.3 or later and Node 20.9 or later.

```bash
bun install
bun run dev                              # http://localhost:3000
```

For a demo, use the production build, which is faster:

```bash
bun run build && bunx next start -p 3000
```

Open http://localhost:3000. The first load seeds the browser (about 4 seconds). The launcher page lists the demo users by role. One click signs a window in as that user, and every password is `demo1234`. Each window (browser tab) has its own user, language (EN or বাংলা) and theme. Approval PINs in dialogs are `1234`.

| User                   | Role                 | Location                       |
| ---------------------- | -------------------- | ------------------------------ |
| rashed                 | Owner                | all                            |
| farzana                | Accounts manager     | all                            |
| mahbub                 | Accountant           | all                            |
| shahriar, arif         | Studio manager       | Gulshan, Uttara                |
| nayeem, shuvo          | Service advisor      | Gulshan, Uttara                |
| tania, sabbir          | Cashier              | Gulshan, Uttara                |
| rakib (and seven more) | Technician           | Gulshan or Uttara              |
| habib                  | Store keeper         | Central Store and both studios |
| nusrat                 | Procurement          | all                            |
| tahmid                 | System administrator | Head Office                    |
| shamima                | Auditor (read only)  | all                            |

### Demo layout

The demo is built for a 1920x1200 screen. There are two ways to set it up:

- **Four windows:** on the launcher, "Open demo layout (4 windows)" opens the advisor, technician, cashier and accountant as four 960x600 windows. Allow pop-ups for the site.
- **Demo Wall:** `/wall` shows the same four users as a 2x2 grid in one tab. Each pane can switch user, expand to full size, or open in its own window.

Every screen works at 960x600.

### Demo panel: clock, data and scenarios

The sliders icon in the top bar opens the Demo panel:

- **Clock:** moves the demo time forward in every window (+15m, +1h, +1d, +7d) or back to real time.
- **Data:** "Reset demo" wipes the browser's data, seeds it again for today with the clock at 10:30 (opening time), and reloads every window. It takes a few seconds.
- **Scenarios:** 22 launchers. Each signs the window in as the right user, prepares the data with real commands, opens the right screen and shows a cue card with the steps. Every launcher can be run again: it creates fresh documents and clears what an earlier run left in the way.
  - **J1 to J6:** the main journey, from booking to the owner's dashboard. Each brings the journey forward to its step without undoing work done by hand.
  - **E1 to E16:** the special cases (discount override, credit limit, stock-out, partial GRN, three-way mismatch, withholding, reconciliation, cheque bounce, count variance, maker-checker, month-end close, credit note, live permission revoke, lockout, concurrent edit, report builder).

A launcher can also be opened by address, for example http://localhost:3000/?launch=J1.

Other address options for a window: `?user=<username>`, `&lang=bn`, `&theme=light`.

## Checks

| Command                                                                    | What it does                                                                                        |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `bun run typecheck`                                                        | TypeScript, no emit                                                                                 |
| `bun run lint`                                                             | ESLint (0 errors; 1 accepted TanStack Table warning)                                                |
| `bun run test`                                                             | Vitest: engine, ledger, stock, tax, security, every app's commands and every launcher twice         |
| `TEST_DAY_SHIFT=3 bun run test`                                            | The same, as if today were 3 days later (the seed is relative to today)                             |
| `TEST_DATE=2026-12-01 bun run test`                                        | The same, with today pinned (useful for month ends and July, the fiscal year start)                 |
| `bun run e2e`                                                              | Playwright on a production build (port 3100): journeys, launchers, every app's screens              |
| `PERF=1 bunx playwright test tests/e2e/perf --workers 1`                   | Timings: seed, checkout commit, heavy launchers, smoothness with the Demo Wall open                 |
| `SWEEP_DIR=/tmp/sweep bunx playwright test tests/e2e/review/sweep.spec.ts` | Screenshots of every screen in EN and BN, dark and light, 960x600 and 1920x1200, with layout checks |
| `PRINT_DIR=/tmp/print bunx playwright test tests/e2e/review/print.spec.ts` | Every print layout through the browser's print path to PDF, EN and BN, for a check on paper         |
| `bun run i18n:check`                                                       | English and Bangla string parity, no empty strings, no em dashes                                    |
| `bun run build`                                                            | Production build; must pass before every merge                                                      |

## Where things live

| Path                                      | What                                                                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/brand.config.ts`                  | Product name and the tenant's identity: names in English and Bangla, BIN, TIN, trade licence, addresses, helpline, the generated monogram, locations and bays                |
| `config/rules.config.ts`                  | Business rules and demo values: VAT and withholding rates, three-way match tolerance, credit hold days, lockout and password policy, the demo password and PIN, opening time |
| `core/`                                   | The engine (`engine/`), ledger and posting rules (`ledger/`), stock (`stock/`), tax, approvals, security, events, seed (`seed/`)                                             |
| `modules/<app>/`                          | Each app's commands, screens, events, datasets, scenarios and strings (`i18n/en.ts`, `i18n/bn.ts`)                                                                           |
| `app/`                                    | Next.js routes                                                                                                                                                               |
| `components/shared/`, `components/shell/` | Shared screen parts and the application shell                                                                                                                                |

## Swap the tenant

1. Edit `config/brand.config.ts`: the tenant's names in English and Bangla, BIN, TIN, trade licence, addresses, helpline, email, monogram letters and colours, locations and bays. Every print header, Mushak form, login card and the top bar read this file.
2. Adjust the demo values in `config/rules.config.ts` if the client's rates or policies differ.
3. The services, prices, items, customers and suppliers are in `core/seed/content/` (catalogue, parties, names). Keep them synthetic.
4. Bump `SEED_VERSION` in `core/demo/reset.ts` so browsers that already hold the old data re-seed on their next load.
5. Run `bun run test` and `bun run build`.

No client logo is used: the tenant mark is a generated monogram.

## Deploy to Vercel

The project deploys as a standard Next.js app:

- `vercel.json` pins the region to `bom1` (Mumbai, the closest to Dhaka).
- `.vercelignore` keeps internal documents, PDFs, local tooling and test output out of CLI uploads.
- The site asks search engines to stay away: `app/robots.ts` disallows all crawlers, and every page carries `noindex, nofollow`.

With the Vercel CLI:

```bash
bunx vercel            # preview deployment
bunx vercel --prod     # production
```

With Git integration, import the repository in Vercel and pick the branch to deploy. The framework preset is Next.js; no environment variables are needed.

Each visitor's browser holds its own copy of the demo data, so visitors never see each other's changes. "Reset demo" restores a clean copy at any time.
