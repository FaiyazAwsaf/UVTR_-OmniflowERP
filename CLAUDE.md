# UVTR_OmniflowERP

## Project brief

- **What:** a frontend-only demo of an SME ERP, **UVTR_OmniflowERP**, built by UVTR Infotech. It covers the 18 apps of the SME package in four suites:
  - **FMS** (Financial Management System): FA Core Accounting, AP Accounts Payable, AR Accounts Receivable, CAB Cash & Bank Management, PAR Party Management, FRS Financial Reporting
  - **SDM** (Sales & Distribution Management): STL Sales Transaction Lifecycle, SI Sale Invoice, PC Product Configuration, SD Sale Delivery
  - **SCM** (Supply Chain Management): PTL Purchase Transactions (Local), PM Product Master, GRN Goods Receive Note, ST Stock Transactions, IC Inventory Control
  - **CSC** (Core System Components): IRT Reporting Tool, SAC User Security, RBAC Role-Based Access Control
- **Tenant (the demo company):** **Automania**, a car detailing business in Bangladesh (washing, paint correction, interior deep cleaning, glass care, wheel care, engine-bay cleaning, restoration and protection treatments such as ceramic coating). The tenant's name, address, BIN and other identity come only from `config/brand.config.ts`. Everything except the name is a placeholder until the owner confirms it.
- **How it works:** there is no backend. Mock data is seeded in the browser and stored in IndexedDB behind an ACID transaction engine reused from UVTR_MedCore:
  - atomic multi-table commits: every business document posts its accounting journal and its stock movements in the same commit
  - invariants checked before commit (balanced journals, open periods, non-negative stock, maker-checker)
  - a serial commit queue with per-record versions (conflict dialog on stale edits)
  - durable storage, an append-only event log and a hash-chained audit trail

  Windows in the same browser sync live (Dexie `liveQuery` plus BroadcastChannel).
- **How it is demoed:**
  - on a 1920x1200 monitor, with 4 windows or the Demo Wall (a 2x2 grid of panes in one tab)
  - each window is signed in as its own user (role, location) and has its own language (EN or BN)
  - scenario launchers set up each story or exception so the presenter can perform it live
- **Deadline:** to be confirmed by the owner. **Deploy target:** Vercel (region `bom1`).

## Key documents

| Path | What it is |
| --- | --- |
| `docs/implementation_plan.md` | **Source of truth.** Follow the phases in order and tick checkboxes when a step is verified. |
| `docs/objective.md` | The owner's feature list per app, the demo run and what the demo must not do. |
| `docs/accounting_rules.md` | Chart of accounts, posting rules per document, Bangladesh VAT and withholding tax, numbering, period close. |
| `docs/seed_data.md` | Automania's demo data: locations, users, services and prices, items, parties, history and planted states. |
| `docs/medcore_reuse.md` | Exactly which files to copy from UVTR_MedCore, which to adapt, and which to leave behind. |
| `docs/ui_guidelines.md` and `sample_ui/` | The only visual reference (dark theme, turquoise accent, gradient KPI cards). |
| `docs/progress_log.md` | **Progress log** maintained by the owner and Claude. Updated after every change, including plan deviations (rule 4). |
| UVTR_MedCore | The source of the reused core: `/home/fawsaf/projects/werk/uvtr/hospital-os` at commit `9528c5f` (GitHub: `git@github.com:FaiyazAwsaf/uvtr_MedCore.git`). Read it, copy from it, **never edit it**. |

## How to run

Requires bun 1.3+ and Node 20.9+ (the Next 16 minimum).

```bash
bun install
bun run dev          # http://localhost:3000 (launcher)
bun run typecheck    # tsc --noEmit
bun run lint         # ESLint 9: 0 errors expected (1 accepted TanStack Table warning)
bun run test         # vitest: unit, ledger, stock, security and engine tests
TEST_DAY_SHIFT=3 bun run test  # same, as if it were 3 days later (seed data varies by date)
TEST_DATE=2026-12-01 bun run test  # same, with today pinned (edge dates: 1st, 2nd, month end, July)
bun run e2e          # Playwright smoke tests; builds and serves on port 3100
bun run build        # production build; must pass before every merge
bun run format       # prettier
bun run i18n:check   # EN/BN key parity, no empty strings, no em dashes
bun run i18n:export  # writes docs/bangla-strings-review.md for a fluent reviewer
```

Useful routes:

| Route | Screen |
| --- | --- |
| `/` | Launcher: demo users by role, the 4-window opener, the Demo Wall |
| `/login` | Sign-in screen (simulated password `demo1234`) |
| `/apps` | The 18 apps of the SME package, grouped by suite |
| `/home` | The signed-in user's home dashboard |
| `/approvals` | The signed-in user's approvals inbox |
| `/dashboard` | The owner's executive dashboard |
| `/wall` | Demo Wall |

Reset the demo data and move the demo clock from the **Demo panel** in the top bar.

## Rules

1. **Never use em dashes**, anywhere: code, comments, UI strings (English and Bangla), docs, commit messages and chat replies. Use commas, colons, semicolons, parentheses or separate sentences instead.
2. **Commit messages are one line**, as `type: summary`, where type is one of `feat`, `fix`, `chore`, `docs`, `test` or `refactor`. No body, no trailers.
3. **Clarify when necessary.** If a requirement is ambiguous or the decision belongs to the owner, ask one focused question with a recommended answer before building. Don't ask about things the plan, docs or code already answer.
4. **Update `docs/progress_log.md` after every change.** Append a row to its table (`Date | Phase / step | Note`, date as DD-MM-YYYY) saying what changed and what's next. Do it in the same step as the change, before committing. Plan deviations are logged there too. Keep the table format.

## Engineering rules

- **Data access:**
  - Write only through `commit()` commands. Every command declares the permission it needs, a key from the catalogue in plan §3.9 (`permission: "si.invoice.issue"`); the engine checks it against the signed-in user's roles, read live from the database. Only the main agent adds keys.
  - Read through `useDb()` and `useLiveQuery`.
  - Get time only from the demo clock `now()`, never `Date.now()` or `new Date()` in domain code.
- **Money:** integer poisha (৳1 = 100), fields end in `P`. Never floats for money. Show it with the `lib/i18n` formatters (lakh and crore grouping).
- **Accounting:** every document that moves money or stock posts a balanced journal through `postJournal()` in the same commit, with the lines built by its posting rule (`linesFor<Doc>` in `core/ledger/rules.ts`, `docs/accounting_rules.md` §3); never hand-built journal lines. Posted documents and journals are immutable: corrections are reversals, credit notes or debit notes, never edits.
- **Strings:** every user-visible string lives in the app module's `i18n/en.ts` **and** `i18n/bn.ts`. Use the `lib/i18n` formatters for money, dates (DD-MM-YYYY) and numbers. Identifiers (invoice, PO, GRN, voucher, SKU, vehicle registration in documents) always use Latin digits.
- **Screen size:** every screen must be usable at 960x600 and look good at 1920x1200.
- **Visuals:** design only from `docs/ui_guidelines.md` and `sample_ui/`. Restyle primitives through tokens.
- **Branding:** the staff app is **UVTR_OmniflowERP**. Tenant (Automania) names and details come only from `config/brand.config.ts`. No Automania logo is copied: the tenant mark is a generated monogram.
- **Seed data:**
  - Synthetic people only. Vehicle makes and models are real; owners, staff and phone numbers are invented.
  - Customer and supplier company names are invented. Product names are generic or use clearly fictional brands.
  - Prices, tax rates and opening balances are demo values (marked "CONFIRM" in the docs).
- **Guardrails** (plan §11):
  - A "Simulated" badge on every external connector (bKash, Nagad, card terminal, SMS, email, bank statement import, NBR e-VAT submission, printer).
  - SMS and notifications carry only document numbers, dates and amounts, never vehicle condition notes or staff remarks.
  - Tax rates are configurable and labelled as demo values.
- **Next.js 16 has breaking changes:** read `node_modules/next/dist/docs/` before writing routing, layout or config code.
- **Parallel agents** edit only the paths their workstream owns (plan §13.2). Everything else (`core/`, `components/shared/`, `components/shell/`, registries, schema, seed, `config/`) belongs to the main agent, except where plan §13.2 assigns it to a workstream (WS-Shell owns `components/shell/`, WS-Seed owns `core/seed/`). Workstream agents never edit `docs/`; the main agent logs their work in the progress log.
- **Machine limits:** this machine has about 7.8 GB of RAM. Run every heavy command (install, typecheck, lint, tests, build, Playwright, servers) through `scripts/agent/heavy` (a machine-wide lock), with the longest Bash timeout or in the background, and check its exit status (piping into `tail` hides failures). Vitest runs at most 4 workers and Playwright 3.
- **Git:**
  - Commit after each verified slice.
  - Never push without the owner's explicit go-ahead.
  - Never commit PDFs.
  - **`docs/` is local only.** It is gitignored and must never be committed or reach GitHub. Never force-add it.
- **Worktree agents:** `docs/` doesn't exist inside a git worktree. Read it from the main checkout by absolute path: `/home/fawsaf/projects/werk/uvtr/uvtr-omniflow-erp/docs/`.
