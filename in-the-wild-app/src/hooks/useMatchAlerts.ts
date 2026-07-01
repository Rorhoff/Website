import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../lib/api';
import { maybeNotifyVenueMatches } from '../lib/browserNotifications';
import { filterUnseenMatchIds, markMatchesSeen } from '../lib/matchAlerts';
import type { Match } from '../lib/types';

const POLL_MS = 20_000;

export function useMatchAlerts(enabled: boolean) {
  const [alertMatches, setAlertMatches] = useState<Match[]>([]);
  const knownActive = useRef<Set<string>>(new Set());

  const showNewMatches = useCallback((matches: Match[]) => {
    const active = matches.filter(m => m.status === 'active' && m.seconds_remaining > 0);
    const unseenIds = filterUnseenMatchIds(active.map(m => m.id));
    const unseen = active.filter(m => unseenIds.includes(m.id));
    if (unseen.length > 0) {
      setAlertMatches(unseen);
      maybeNotifyVenueMatches(unseen);
    }
  }, []);

  const notifyFromResponse = useCallback((matches: Match[]) => {
    if (matches.length > 0) {
      setAlertMatches(matches);
      maybeNotifyVenueMatches(matches);
    }
  }, []);

  const dismissAlerts = useCallback(() => {
    markMatchesSeen(alertMatches.map(m => m.id));
    setAlertMatches([]);
  }, [alertMatches]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function poll() {
      try {
        const { matches } = await api.fetchMatches();
        if (cancelled) return;
        const active = matches.filter(m => m.status === 'active' && m.seconds_remaining > 0);
        const activeIds = new Set(active.map(m => m.id));

        const newlyActive = active.filter(m => !knownActive.current.has(m.id));
        knownActive.current = activeIds;

        if (newlyActive.length > 0) {
          const unseenIds = filterUnseenMatchIds(newlyActive.map(m => m.id));
          const unseen = newlyActive.filter(m => unseenIds.includes(m.id));
          if (unseen.length > 0) {
            setAlertMatches(unseen);
            maybeNotifyVenueMatches(unseen);
          }
        }
      } catch {
        /* ignore poll errors */
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  return { alertMatches, notifyFromResponse, dismissAlerts, showNewMatches };
}
