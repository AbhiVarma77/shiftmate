# ShiftMate — Technical Decisions

Decisions made where the brief left details open. Newest at the bottom.

## Data & time

1. **Instants are UTC epoch milliseconds** (`INTEGER` in SQLite). Durations are always
   `end − start`, so they're correct across DST changes, timezone travel and app restarts.
2. **Every shift stores the IANA timezone** it was recorded in. Local dates/times
   (grouping, display, manual entry) are derived in that zone, so a shift logged in
   London still reads 09:00–17:00 after flying to New York.
3. **A shift belongs to the local date it started on.** Overnight shifts (22:00–06:00)
   count entirely toward the start day — standard payroll practice and needed for
   daily-overtime thresholds.
4. **Manual "end ≤ start" means overnight.** 22:00 → 06:00 ends the next day. Shifts are
   capped at 24h.
5. **Duration-only entries never get invented timestamps** (`start_at`/`end_at` NULL).
   Because they have no interval, they cannot be de-duplicated against overlapping shifts;
   reports show them separately from unique timed working time.
6. **Shifts and breaks are deleted permanently** (user request). The rows are erased from
   the device; the sync queue keeps only an id-only tombstone (`{"id": …}` — no times, pay
   or notes) so the server copy can be deleted once cloud sync exists. Other tables
   (jobs, rates) keep `deleted_at` soft deletes — jobs are archived, never erased, so
   history stays intact.

## Timer

7. **The timer is never the source of truth.** The UI ticks once per second purely to
   re-render; elapsed time is recomputed from persisted timestamps each tick. Every state
   transition (start, break, resume, stop) is written to SQLite in one transaction before
   the UI updates, so killing the app or rebooting loses nothing.
8. **Pause = an unpaid break.** "Pause/Resume" and "Unpaid break" are the same record type;
   Pause is just a one-tap shortcut. Paid breaks stay inside working time.
9. **One active shift at a time by default.** A setting allows simultaneous shifts at
   *different* jobs; a partial unique index guarantees at most one active shift per job
   even if the UI double-fires.
10. **Overlap rules for manual entry:** overlapping a shift at the *same* job is rejected
    (duplicate). Overlapping a *different* job requires explicit confirmation.

## Money

11. **No floats for money.** Rates and amounts are decimal strings computed with `big.js`.
12. **Rounding:** half-up to the currency's minor unit (JPY 0, KWD 3, most 2), **per shift
    line**. Period totals are exact sums of the displayed lines, so reports always add up.
13. **Rate snapshots.** When a shift completes, the rate effective on its date is copied
    onto the shift. Later rate changes don't rewrite history. Back-dated rate changes
    re-price existing shifts only if the user explicitly chooses to.
14. **Overtime is computed at report time**, not stored on shifts, because weekly
    thresholds depend on other shifts in the week. Daily overtime is applied first; only
    remaining regular time counts toward the weekly threshold (no double counting).
    Reports fetch from the start of the first week so weekly thresholds see earlier days.
15. **Currencies are never summed together.** Totals are per-currency maps. Conversion is
    out of scope until a user-supplied, dated rate exists.
16. All earnings are labelled **gross estimates** — never take-home pay.

## Architecture

17. **SQLite is the source of truth; the UI re-queries on change.** A tiny Zustand store
    holds a `version` counter that mutations bump; `useLive` hooks re-run their query.
    TanStack Query is reserved for server state (Supabase) in Phase 10 — it adds nothing
    for local SQLite.
18. **Repositories take a `Db` interface**, not expo-sqlite directly. Production adapts
    expo-sqlite (`src/database/expoDb.ts`); tests use Node's built-in `node:sqlite`, so
    integration tests run the **real migrations and SQL**, no mocks.
19. **Transactional outbox.** Every write enqueues a full-row snapshot into `sync_queue`
    *in the same transaction*. One entry per row (latest wins). Sync (Phase 10) will
    upsert idempotently by UUID with `updated_at` last-writer-wins, and never mark synced
    without server confirmation.
20. **Routes live in `src/app/`** (current Expo Router convention) rather than root `app/`.
21. **Charts are hand-built with Views** for now (accessible, themeable, zero native deps).
    Victory Native needs Skia; reconsider if richer charts are needed.
22. **Icons:** `expo-symbols` — SF Symbols on iOS, Material Symbols on Android — via one
    semantic `Icon` component. Tabs use native tabs (`expo-router/native-tabs`).

## Environment notes

- React Native 0.88 declares support for Node 22.13+, 24.3+ or 26+. Node 25 works for
  bundling and tests here, but **Node 24 LTS is recommended**.

## Web preview

23. **`Alert.alert` is never used** — it is a no-op on web and can't be themed. All
    confirmations go through `src/components/ui/Dialog.tsx` (`confirm` / `choose` /
    `showAlert`).
24. **One browser tab at a time.** expo-sqlite on web stores data in OPFS, which allows a
    single open handle, and a failed open can only be retried by reloading. Before opening,
    each tab takes the `shiftmate-db` Web Lock (`src/lib/webTabLock.ts`). If another tab
    holds it, that tab is asked (BroadcastChannel) to reload into a paused "Use here" state,
    which frees the file; the new tab opens as soon as the lock is released — no timeouts.

## Accounts, sync & export

25. **An account is required.** `useAuthGate` keeps signed-out users on the auth screens
    (sign-up first); onboarding runs once after the first sign-in. Accounts exist so records
    sync across devices and survive a lost phone. Signing out uploads pending changes, then
    wipes this account's rows from the device; deleting the account removes it server-side
    via the `delete-account` Edge Function.
26. **Sync engine** (`src/services/sync/`): push drains the outbox; an entry is removed only
    if its payload is unchanged after the server confirms. Pull uses a per-table
    `server_updated_at` cursor (with a 2-minute overlap) and last-writer-wins on
    `updated_at`. Hard deletes travel as server tombstones (`deleted_records`). Settings
    sync as one document per account (`user_settings`). Server schema:
    `supabase/migrations/20261113000000_cloud_sync.sql` (RLS: owner-only).
27. **PDF export** renders HTML (`src/services/export/dataExport.ts`). Native uses
    expo-print + share sheet; on web expo-print can only print the current page, so the
    document is printed from a hidden iframe and the browser's "Save as PDF" is used.
28. **OAuth uses PKCE.** On web the redirect is full-page (a popup can't report back under
    cross-origin isolation). Providers are checked via `/auth/v1/settings` first so a
    disabled provider gets a readable message instead of Supabase's JSON error page.
