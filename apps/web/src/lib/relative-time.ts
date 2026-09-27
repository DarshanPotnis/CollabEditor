/** "just now", "5 minutes ago", "yesterday": English, like the rest of the UI. */
const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function relativeTime(then: number, now: number): string {
  const seconds = Math.round((then - now) / 1000);
  if (Math.abs(seconds) < 45) return 'just now';
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(Math.round(seconds / 60), 'minute');
}
