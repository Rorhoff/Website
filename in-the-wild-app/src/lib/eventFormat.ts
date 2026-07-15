export function formatEventDate(iso: string | null | undefined): string {
  if (!iso) return 'Date TBA';
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatEventTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatEventRange(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
): string {
  if (!startsAt) return 'Date TBA';
  const startDate = formatEventDate(startsAt);
  const startTime = formatEventTime(startsAt);
  if (!endsAt) return `${startDate} · ${startTime}`;
  const endDate = formatEventDate(endsAt);
  const endTime = formatEventTime(endsAt);
  if (startDate === endDate) {
    return `${startDate} · ${startTime} – ${endTime}`;
  }
  return `${startDate} ${startTime} – ${endDate} ${endTime}`;
}
