import { useCallback, useState } from 'react';
import { maybeNotifyEventPlanOverlaps } from '../lib/browserNotifications';
import {
  filterUnseenOverlaps,
  markOverlapsSeen,
  overlapKey,
} from '../lib/eventPlanAlerts';
import type { EventPlanOverlap } from '../lib/types';

export function useEventPlanAlerts() {
  const [alertOverlaps, setAlertOverlaps] = useState<EventPlanOverlap[]>([]);

  const showNewOverlaps = useCallback((overlaps: EventPlanOverlap[]) => {
    if (overlaps.length === 0) return;
    const keys = overlaps.map(o => overlapKey(o.event.id, o.other_user?.id || ''));
    const unseenKeys = new Set(filterUnseenOverlaps(keys));
    const unseen = overlaps.filter(o =>
      unseenKeys.has(overlapKey(o.event.id, o.other_user?.id || '')),
    );
    if (unseen.length > 0) {
      setAlertOverlaps(unseen);
      maybeNotifyEventPlanOverlaps(unseen);
    }
  }, []);

  const dismissAlerts = useCallback(() => {
    markOverlapsSeen(
      alertOverlaps.map(o => overlapKey(o.event.id, o.other_user?.id || '')),
    );
    setAlertOverlaps([]);
  }, [alertOverlaps]);

  return { alertOverlaps, notifyFromResponse: showNewOverlaps, dismissAlerts };
}
