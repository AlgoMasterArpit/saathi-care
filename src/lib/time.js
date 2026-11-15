const formatterCache = new Map();

function partsFormatter(timeZone) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(date, timeZone) {
  const parts = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(date)) parts[type] = value;
  return parts;
}

export function isValidTimeZone(timeZone) {
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function offsetMinutes(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

export function zonedToUtc(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = timeStr.split(':').map(Number);
  const wallClock = Date.UTC(y, m - 1, d, h, min);
  const firstPass = wallClock - offsetMinutes(new Date(wallClock), timeZone) * 60000;
  return new Date(wallClock - offsetMinutes(new Date(firstPass), timeZone) * 60000);
}

export function localDate(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localTime(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.hour}:${p.minute}`;
}

export function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekday(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
