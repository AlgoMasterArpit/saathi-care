import { addDays, localDate, weekday, zonedToUtc, HOUR, MINUTE } from '../lib/time.js';

export const DEFAULT_SETTINGS = Object.freeze({
  requireApproval: true,
  graceMinutes: 30,
  escalateAfterMisses: 2,
  upcomingLeadMinutes: 15,
});

export const REFILL_ALERT_DAYS = 3;

export const settingsOf = (circle) => ({ ...DEFAULT_SETTINGS, ...circle.settings });

export const doseKey = (medId, date, time) => `${medId}@${date}T${time}`;

export function parseDoseKey(key) {
  const match = /^([\w-]+)@(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(key));
  return match ? { medId: match[1], date: match[2], time: match[3] } : null;
}

export function isScheduledOn(med, date) {
  if (med.status !== 'active') return false;
  if (med.startDate && date < med.startDate) return false;
  if (med.endDate && date > med.endDate) return false;
  return !med.days?.length || med.days.includes(weekday(date));
}

function doseState(dueAt, now, graceMs) {
  if (now > dueAt + graceMs) return 'missed';
  if (now >= dueAt) return 'due';
  return 'upcoming';
}

export function dosesOn(circle, date, now) {
  const graceMs = settingsOf(circle).graceMinutes * MINUTE;
  const nowMs = now.getTime();
  const doses = [];
  for (const med of circle.medications) {
    if (!isScheduledOn(med, date)) continue;
    const activeFrom = Date.parse(med.activatedAt ?? med.createdAt ?? 0);
    for (const time of med.times) {
      const dueAt = zonedToUtc(date, time, circle.elder.timezone).getTime();
      if (dueAt < activeFrom) continue;
      const key = doseKey(med.id, date, time);
      const log = circle.doses[key];
      doses.push({
        key,
        medId: med.id,
        name: med.name,
        dosage: med.dosage,
        instructions: med.instructions ?? '',
        time,
        dueAt: new Date(dueAt).toISOString(),
        status: log ? log.status : doseState(dueAt, nowMs, graceMs),
        loggedBy: log?.by ?? null,
        loggedAt: log?.at ?? null,
      });
    }
  }
  return doses.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

const isResolved = (dose) => dose.status !== 'upcoming' && dose.status !== 'due';

export function adherence(circle, now, days = 7) {
  const today = localDate(now, circle.elder.timezone);
  const perMed = new Map();
  const daily = [];
  let taken = 0;
  let total = 0;

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    let dayTaken = 0;
    let dayTotal = 0;
    for (const dose of dosesOn(circle, date, now)) {
      if (!isResolved(dose)) continue;
      const med = perMed.get(dose.medId) ?? { medId: dose.medId, name: dose.name, taken: 0, total: 0 };
      med.total += 1;
      dayTotal += 1;
      if (dose.status === 'taken') {
        med.taken += 1;
        dayTaken += 1;
      }
      perMed.set(dose.medId, med);
    }
    taken += dayTaken;
    total += dayTotal;
    daily.push({ date, taken: dayTaken, total: dayTotal, rate: percent(dayTaken, dayTotal) });
  }

  return {
    rate: percent(taken, total),
    taken,
    total,
    daily,
    medications: [...perMed.values()].map((m) => ({ ...m, rate: percent(m.taken, m.total) })),
  };
}

function percent(part, whole) {
  return whole ? Math.round((part / whole) * 100) : null;
}

export function streakDays(circle, now, maxDays = 60) {
  const today = localDate(now, circle.elder.timezone);
  let streak = 0;
  for (let offset = 0; offset < maxDays; offset += 1) {
    const resolved = dosesOn(circle, addDays(today, -offset), now).filter(isResolved);
    if (resolved.some((dose) => dose.status !== 'taken')) break;
    if (resolved.length) streak += 1;
  }
  return streak;
}

export function consecutiveMisses(circle, medId, now) {
  const today = localDate(now, circle.elder.timezone);
  const recent = [-2, -1, 0]
    .flatMap((offset) => dosesOn(circle, addDays(today, offset), now))
    .filter((dose) => dose.medId === medId && isResolved(dose))
    .reverse();
  let misses = 0;
  for (const dose of recent) {
    if (dose.status === 'taken') break;
    misses += 1;
  }
  return misses;
}

export function refillStatus(med) {
  if (typeof med.stock !== 'number') return null;
  const scheduledDays = med.days?.length || 7;
  const perDay = med.times.length * (med.perDose ?? 1) * (scheduledDays / 7);
  const daysLeft = perDay > 0 ? Math.floor(med.stock / perDay) : null;
  return { stock: med.stock, daysLeft, low: daysLeft !== null && daysLeft <= REFILL_ALERT_DAYS };
}

export function upcomingAppointments(circle, now) {
  const nowIso = now.toISOString();
  return circle.appointments
    .filter((appointment) => appointment.startsAt >= nowIso)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function carePulse(circle, now) {
  const settings = settingsOf(circle);
  const week = adherence(circle, now, 7);
  const signals = [];

  if (week.rate !== null && week.rate < 60) {
    signals.push({ severity: 'act', message: `Only ${week.rate}% of doses taken this week` });
  } else if (week.rate !== null && week.rate < 85) {
    signals.push({ severity: 'watch', message: `${week.rate}% of doses taken this week` });
  }

  for (const med of circle.medications.filter((m) => m.status === 'active')) {
    const misses = consecutiveMisses(circle, med.id, now);
    if (misses >= settings.escalateAfterMisses) {
      signals.push({ severity: 'act', message: `${med.name}: ${misses} doses missed in a row` });
    }
    const refill = refillStatus(med);
    if (refill?.low) {
      signals.push({ severity: 'watch', message: `${med.name}: about ${refill.daysLeft} day(s) of supply left` });
    }
  }

  const soon = upcomingAppointments(circle, now).find((a) => Date.parse(a.startsAt) - now.getTime() <= 48 * HOUR);
  if (soon) signals.push({ severity: 'info', message: `Appointment with ${soon.doctor} coming up` });

  const pending = circle.medications.filter((m) => m.status === 'pending' || m.proposal).length;
  if (pending) signals.push({ severity: 'info', message: `${pending} medication change(s) waiting for the elder's approval` });

  const level = signals.some((s) => s.severity === 'act') ? 'act' : signals.some((s) => s.severity === 'watch') ? 'watch' : 'steady';
  return { level, adherence: week.rate, streak: streakDays(circle, now), signals };
}
