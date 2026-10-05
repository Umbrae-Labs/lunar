import { Redirect, type Href } from 'expo-router';
import { useEffect, useState } from 'react';

import { useApplicationSettingsStore } from '@/stores';
import { findMostRecentlyReadBookId } from '../services/reading-state-service';

export default function ReadingLaunchScreen() {
  const resumeReadingOnLaunch = useApplicationSettingsStore((state) => state.resumeReadingOnLaunch);
  const [recentBookId, setRecentBookId] = useState<string | null>();

  useEffect(() => {
    let isActive = true;

    if (!resumeReadingOnLaunch) {
      return () => {
        isActive = false;
      };
    }

    void findMostRecentlyReadBookId()
      .then((bookId) => {
        if (isActive) {
          setRecentBookId(bookId ?? null);
        }
      })
      .catch(() => {
        if (isActive) {
          setRecentBookId(null);
        }
      });

    return () => {
      isActive = false;
    };
  }, [resumeReadingOnLaunch]);

  if (resumeReadingOnLaunch && recentBookId === undefined) {
    return null;
  }

  const href: Href =
    resumeReadingOnLaunch && recentBookId
      ? { pathname: '/reader/[bookId]', params: { bookId: recentBookId } }
      : '/library';

  return <Redirect href={href} />;
}
