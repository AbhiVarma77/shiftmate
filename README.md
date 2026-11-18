# ShiftMate

**Your Work. Your Time. Your Earnings.**

Track working hours, breaks and earnings across multiple employers — offline-first, on
Android and iOS. Built with Expo (SDK 58), React Native, TypeScript (strict) and SQLite.

## Quick start

```bash
npm install
npx expo start          # press i (iOS simulator), a (Android emulator), or scan with Expo Go
```

| Command | What it does |
| --- | --- |
| `npm test` | Unit + integration tests (Jest) |
| `npm run typecheck` | TypeScript strict check |
| `npm run lint` | ESLint (incl. React Compiler rules) |
| `npx expo-doctor` | Dependency/config health check |

> Requires Node 22.13+, 24.3+ (recommended) or 26+.

## Project layout

```
src/
  app/                  Screens (Expo Router — each file is a route)
    (tabs)/             Home · Analytics · History · Compare · Settings
    jobs/               My Jobs list, job details, add/edit form
    shifts/             Manual entry, shift details
    onboarding.tsx
  components/           Reusable UI (ui/ design-system primitives, shift/, charts/)
  database/             SQLite migrations, row mappers, expo-sqlite adapter
  repositories/         SQL access per table + sync outbox
  services/             Business logic — no UI
    calculations/       Pure maths: shifts, breaks, salary/overtime, interval union
    shiftService.ts     Timer, breaks, manual entry, edit/delete
    jobService.ts       Employers, pay-rate history, overtime rules
    reportService.ts    Period reports from real records
  hooks/                React ↔ database glue (useLive, useMutation, useNow…)
  store/                Zustand (settings mirror, data-version counter)
  theme/                Design tokens + theme provider (light/dark/system)
  types/  utils/  validation/
tests/
  unit/                 Pure calculation tests
  integration/          Services against a real in-memory SQLite (node:sqlite)
docs/DECISIONS.md       Why things are the way they are — read this first
```

**Rule of thumb:** screens call services; services call repositories; repositories run
SQL. Calculations are pure functions with no I/O, so they're easy to test.

## Status

| Phase | Status |
| --- | --- |
| 1 Architecture & design system | ✅ Done |
| 2 Premium UI & navigation | ✅ Core screens done |
| 3 Onboarding & job management | ✅ Account required (sign-up first), then onboarding |
| 4 Shift timer & break engine | ✅ Done, tested |
| 5 Manual shift entry | ✅ Done, tested |
| 6 SQLite persistence & migrations | ✅ Done, tested |
| 7 Daily/weekly/monthly analytics | ✅ Done (calendar view pending) |
| 8 Comparison & salary | ✅ Done (salary engine tested; comparison UI not yet tested) |
| 9 Schedules & notifications | ⏳ Schema in place, UI/logic not built |
| 10 Supabase auth & sync | ✅ Push/pull sync engine, tested; run `supabase/migrations/*_cloud_sync.sql` once per project |
| 11 PDF/CSV/Excel export | ⏳ Not started |
| 12 Security audit | ⏳ |
| 13 E2E tests (Maestro) & UI tests | ⏳ |
| 14 Release prep (EAS) | ⏳ |

Not yet built: schedules & reminders, exports, biometric lock,
widgets, calendar view, native date/time pickers (fields currently take typed
`HH:mm` / `YYYY-MM-DD`).
