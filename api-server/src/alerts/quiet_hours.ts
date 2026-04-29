export interface QuietHours {
  start: string;
  end: string;
  tz: string;
}

const HH_MM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseMinutes(value: string): number {
  const match = HH_MM_REGEX.exec(value);
  if (!match) {
    throw new Error('invalid time format');
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function timezoneMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? NaN);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? NaN);

  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error('invalid timezone parts');
  }

  return hour * 60 + minute;
}

export function isInQuietHours(
  quietHours: QuietHours | null | undefined,
  now: Date = new Date()
): boolean {
  if (!quietHours) return false;

  const start = parseMinutes(quietHours.start);
  const end = parseMinutes(quietHours.end);
  const mins = timezoneMinutes(now, quietHours.tz);

  if (start === end) return true;
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

export function isValidQuietHours(quietHours: QuietHours): boolean {
  try {
    parseMinutes(quietHours.start);
    parseMinutes(quietHours.end);
    timezoneMinutes(new Date(), quietHours.tz);
    return true;
  } catch {
    return false;
  }
}

