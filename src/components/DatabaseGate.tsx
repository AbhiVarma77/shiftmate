import { type SQLiteDatabase, SQLiteProvider } from 'expo-sqlite';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { fromExpo } from '@/database/expoDb';
import { migrate } from '@/database/migrations';
import { acquireDatabaseLock, isPausedTab, onTakeoverRequest, requestTakeover, resumeHere } from '@/lib/webTabLock';
import { darkPalette } from '@/theme/tokens';

/** True while this page has the database open — the only state in which it can hand it over. */
let holdsDatabase = false;

/** Stable identity: SQLiteProvider re-opens the database whenever onInit changes. */
async function initDatabase(sqlite: SQLiteDatabase): Promise<void> {
  await migrate(fromExpo(sqlite));
  holdsDatabase = true;
}

const MAX_AUTO_RETRIES = 8;
const RETRY_DELAY_MS = 400;
/** Only show "open in another tab" if the handover takes longer than a blink. */
const BUSY_NOTICE_DELAY_MS = 1200;

function isLockError(e: Error): boolean {
  return /Access Handle|NoModificationAllowedError|another open|database is locked|Invalid VFS state/i.test(e.message);
}

const WEB_RELOAD_KEY = 'shiftmate.dbReloadAt';

/**
 * Web: a failed open leaves the SQLite worker unusable for this page, so the
 * only retry is a reload. Allowed once per 15s so it can never loop.
 */
function tryWebAutoReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(WEB_RELOAD_KEY) ?? 0);
    if (Date.now() - last < 15_000) return false;
    sessionStorage.setItem(WEB_RELOAD_KEY, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

type WebLockState = 'acquiring' | 'waiting' | 'ready';

/**
 * Opens the local database. On web it first takes the single-tab lock
 * (see lib/webTabLock.ts), so tabs hand over instead of failing.
 */
export function DatabaseGate({ children }: { children: ReactNode }) {
  const [paused] = useState(isPausedTab);
  const [lock, setLock] = useState<WebLockState>(Platform.OS === 'web' ? 'acquiring' : 'ready');
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<Error | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    if (paused || Platform.OS !== 'web') return;
    let alive = true;
    let notice: ReturnType<typeof setTimeout> | undefined;
    acquireDatabaseLock(() => {
      notice = setTimeout(() => alive && setLock((s) => (s === 'ready' ? s : 'waiting')), BUSY_NOTICE_DELAY_MS);
    }).then(() => {
      clearTimeout(notice);
      if (alive) setLock('ready');
    });
    const unsubscribe = onTakeoverRequest(() => holdsDatabase);
    return () => {
      alive = false;
      clearTimeout(notice);
      unsubscribe();
    };
  }, [paused]);

  // onError is invoked during the provider's render — defer state updates.
  const onError = useCallback(
    (e: Error) => {
      if (pending.current) return;
      pending.current = true;
      setTimeout(() => {
        pending.current = false;
        if (Platform.OS === 'web') {
          // Held by a tab that doesn't take part in the lock (e.g. one opened
          // before this version loaded). One reload, then explain.
          if (!(isLockError(e) && tryWebAutoReload())) setFailure(e);
        } else if (isLockError(e) && attempt < MAX_AUTO_RETRIES) setAttempt((a) => a + 1);
        else setFailure(e);
      }, RETRY_DELAY_MS);
    },
    [attempt],
  );

  useEffect(() => {
    if (failure) console.warn(`[ShiftMate] Database could not be opened: ${failure.name}: ${failure.message}`);
  }, [failure]);

  if (paused) {
    return (
      <BlockedScreen
        title="ShiftMate is open in another tab"
        message="You opened ShiftMate in another tab, so this one paused to keep your records safe."
        actionLabel="Use here"
        onAction={resumeHere}
      />
    );
  }

  if (failure) {
    const locked = isLockError(failure) && Platform.OS === 'web';
    return (
      <BlockedScreen
        title={locked ? 'ShiftMate is open in another tab' : "Couldn't open your data"}
        message={
          locked
            ? 'Another ShiftMate tab is using your records. Close it, then press Retry.'
            : 'Your records are safe on this device. Please try again.'
        }
        actionLabel="Retry"
        onAction={() => {
          if (Platform.OS === 'web') {
            try {
              sessionStorage.removeItem(WEB_RELOAD_KEY);
            } catch {}
            window.location.reload();
            return;
          }
          setFailure(null);
          setAttempt(0);
        }}
      />
    );
  }

  if (lock === 'waiting') {
    return (
      <BlockedScreen
        title="ShiftMate is open in another tab"
        message="Switching your records to this tab… If nothing happens, close the other ShiftMate tab — this one opens automatically."
        actionLabel="Use here"
        onAction={requestTakeover}
        busy
      />
    );
  }

  if (lock !== 'ready') return <View style={{ flex: 1, backgroundColor: darkPalette.background }} />;

  return (
    <SQLiteProvider key={attempt} databaseName="shiftmate.db" onInit={initDatabase} onError={onError}>
      {children}
    </SQLiteProvider>
  );
}

function BlockedScreen(props: { title: string; message: string; actionLabel: string; onAction: () => void; busy?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: darkPalette.background, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: darkPalette.warningMuted, alignItems: 'center', justifyContent: 'center' }}>
        {props.busy ? <ActivityIndicator color={darkPalette.warning} /> : <Icon name="warning" size={24} color={darkPalette.warning} />}
      </View>
      <Text variant="title" align="center" style={{ color: darkPalette.text }}>
        {props.title}
      </Text>
      <Text variant="body" align="center" style={{ color: darkPalette.textSecondary, maxWidth: 360 }}>
        {props.message}
      </Text>
      <Button label={props.actionLabel} onPress={props.onAction} />
    </View>
  );
}
