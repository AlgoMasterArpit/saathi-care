export function formatTime(iso, timeZone) {
  return new Intl.DateTimeFormat('en-IN', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function formatDateTime(iso, timeZone) {
  return new Intl.DateTimeFormat('en-IN', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function formatDate(dateStr) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${dateStr}T00:00:00Z`));
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeDays(days) {
  if (!days?.length || days.length === 7) return 'Every day';
  return [...days].sort((a, b) => a - b).map((d) => WEEKDAYS[d]).join(', ');
}

export function clock12(time) {
  const [hours, minutes] = time.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export function untilText(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} m` : `${hours} h`;
}

export function googleCalendarUrl(appointment, elderName) {
  const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = Date.parse(appointment.startsAt);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${elderName}: ${appointment.doctor}`,
    dates: `${stamp(start)}/${stamp(start + 3_600_000)}`,
    details: [appointment.notes, ...(appointment.questions ?? []).map((q) => `• ${q}`)].filter(Boolean).join('\n'),
    location: appointment.location ?? '',
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function googleMapsUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
