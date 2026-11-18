/**
 * Web only: makes sure exactly one browser tab opens the SQLite database.
 *
 * expo-sqlite on web stores the database in OPFS through a worker that holds
 * exclusive file handles until its page goes away. A second tab that tries to
 * open the file fails, and that failure can't be retried without a reload.
 *
 * So before opening, a tab takes the `shiftmate-db` Web Lock (held for the
 * page's lifetime and released by the browser when the page closes or reloads):
 *  • Free       → open immediately (the normal case, no delay at all).
 *  • Taken      → ask the holder to step aside, then wait for the lock. The
 *                 holder reloads into a "paused" state that never opens the
 *                 database, which frees it; this tab opens as soon as it does.
 */
import { Platform } from 'react-native';

const LOCK_NAME = 'shiftmate-db';
const CHANNEL_NAME = 'shiftmate-db';
const PAUSED_KEY = 'shiftmate.dbPaused';
/** After the lock frees, give the previous page's worker a moment to close its file handles. */
const HANDLE_SETTLE_MS = 250;

type TabMessage = { type: 'takeover'; from: string };
const TAB_ID = Math.random().toString(36).slice(2);

const isWeb = Platform.OS === 'web';

export function supportsTabLock(): boolean {
  return isWeb && typeof navigator !== 'undefined' && !!navigator.locks && typeof BroadcastChannel !== 'undefined';
}

/** True when this tab handed the database to another tab and must not open it. */
export function isPausedTab(): boolean {
  if (!isWeb) return false;
  try {
    return sessionStorage.getItem(PAUSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Leave paused mode and reload; the reloaded page will ask for the database back. */
export function resumeHere(): void {
  try {
    sessionStorage.removeItem(PAUSED_KEY);
  } catch {}
  window.location.reload();
}

/** Ask whichever tab holds the database to step aside. */
export function requestTakeover(): void {
  if (!supportsTabLock()) return;
  const ch = new BroadcastChannel(CHANNEL_NAME);
  ch.postMessage({ type: 'takeover', from: TAB_ID } satisfies TabMessage);
  ch.close();
}

let acquired: Promise<void> | null = null;

/**
 * Resolves once this tab owns the database lock. `onBusy` fires (once) if
 * another tab had it, so the UI can say so while we wait.
 */
export function acquireDatabaseLock(onBusy: () => void): Promise<void> {
  if (!supportsTabLock()) return Promise.resolve();
  if (acquired) return acquired;
  const hold = () => new Promise<void>(() => {}); // never resolves: hold until the page goes away
  acquired = new Promise<void>((resolve) => {
    navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (lock) {
        resolve();
        return hold();
      }
      onBusy();
      requestTakeover();
      navigator.locks.request(LOCK_NAME, () => {
        setTimeout(resolve, HANDLE_SETTLE_MS);
        return hold();
      });
      return undefined;
    });
  });
  return acquired;
}

/**
 * While this tab owns the database, step aside when another tab asks for it:
 * reload into paused mode, which releases both the lock and the file handles.
 * Returns an unsubscribe function.
 */
export function onTakeoverRequest(isHolding: () => boolean): () => void {
  if (!supportsTabLock()) return () => {};
  const ch = new BroadcastChannel(CHANNEL_NAME);
  ch.onmessage = (ev: MessageEvent<TabMessage>) => {
    if (ev.data?.type !== 'takeover' || ev.data.from === TAB_ID || !isHolding()) return;
    try {
      sessionStorage.setItem(PAUSED_KEY, '1');
    } catch {}
    window.location.reload();
  };
  return () => ch.close();
}
