import type { Match } from './types';
import { navStateToUrl } from './appNav';

const ENABLED_KEY = 'itw_notifications_enabled';

export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined';
}

export function notificationsEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === '1';
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    localStorage.setItem(ENABLED_KEY, '1');
    return true;
  }
  return false;
}

export function disableNotifications(): void {
  localStorage.removeItem(ENABLED_KEY);
}

export function maybeNotifyVenueMatches(matches: Match[]): void {
  if (!notificationsSupported()) return;
  if (!notificationsEnabled() || Notification.permission !== 'granted') return;

  for (const match of matches) {
    if (match.status !== 'active' || match.seconds_remaining <= 0) continue;
    const name = match.other_user?.display_name || 'Someone';
    const eventName = match.event?.name || 'your event';
    const notification = new Notification("You're both here!", {
      body: `You and ${name} are both at ${eventName}. Say hello in person!`,
      tag: `itw-match-${match.id}`,
    });
    notification.onclick = () => {
      window.focus();
      const url = `${window.location.pathname}${navStateToUrl({ page: 'matches', matchId: null })}`;
      window.history.pushState({ page: 'matches', matchId: null }, '', url);
      notification.close();
    };
  }
}
