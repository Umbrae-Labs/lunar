import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { ReadingSession } from '../../domain/reading-time';
import { startReadingSession, updateReadingSessionEnd } from '../../services/reading-time-service';

const CheckpointIntervalMs = 10_000;

function currentTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function useReadingTime(bookId: string, isFocused: boolean, isReady: boolean) {
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active');
  const [foregroundRevision, setForegroundRevision] = useState(0);
  const [error, setError] = useState(false);
  const queue = useRef(Promise.resolve());
  const stopActive = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        stopActive.current?.();
      } else {
        setForegroundRevision((current) => current + 1);
      }
      setForeground(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!bookId || !isFocused || !isReady || !foreground) return;

    function schedule(task: () => Promise<void>) {
      queue.current = queue.current.then(task).catch(() => setError(true));
    }

    function createSession(startedAt: number): ReadingSession {
      return { id: randomUUID(), bookId, startedAt, endedAt: startedAt, timeZone: currentTimeZone() };
    }

    let active = createSession(Date.now());
    const first = active;
    schedule(() => startReadingSession(first));
    let stopped = false;
    const timer = setInterval(() => {
      if (stopped) return;
      if (AppState.currentState !== 'active') return;
      const now = Date.now();
      const previous = active;
      schedule(async () => {
        await startReadingSession(previous);
        await updateReadingSessionEnd(previous.id, Math.max(previous.startedAt, now));
      });
      if (currentTimeZone() !== previous.timeZone) {
        active = createSession(now);
        const next = active;
        schedule(() => startReadingSession(next));
      }
    }, CheckpointIntervalMs);

    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      const previous = active;
      const endedAt = Math.max(previous.startedAt, Date.now());
      schedule(async () => {
        await startReadingSession(previous);
        await updateReadingSessionEnd(previous.id, endedAt);
      });
    };
    stopActive.current = stop;
    return () => {
      if (stopActive.current === stop) stopActive.current = undefined;
      stop();
    };
  }, [bookId, foreground, foregroundRevision, isFocused, isReady]);

  return { error };
}
