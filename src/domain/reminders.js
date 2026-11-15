import { addDays, localDate, DAY, HOUR, MINUTE } from '../lib/time.js';
import { consecutiveMisses, dosesOn, refillStatus, settingsOf } from './care.js';

const MISSED_LOOKBACK = 6 * HOUR;

function formatWhen(iso, timeZone) {
  return new Intl.DateTimeFormat('en-IN', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function planReminders(circle, now) {
  const settings = settingsOf(circle);
  const { name: elderName, timezone } = circle.elder;
  const today = localDate(now, timezone);
  const nowMs = now.getTime();
  const plans = [];

  const add = (key, kind, roles, subject, lines) => {
    if (!circle.notified?.[key]) plans.push({ key, kind, roles, subject, text: lines.join('\n') });
  };

  for (const date of [addDays(today, -1), today]) {
    for (const dose of dosesOn(circle, date, now)) {
      const dueMs = Date.parse(dose.dueAt);
      const what = `${dose.name} ${dose.dosage}`.trim();
      const hint = dose.instructions ? `Note: ${dose.instructions}` : null;

      if (dose.status === 'upcoming' && dueMs - nowMs <= settings.upcomingLeadMinutes * MINUTE) {
        add(`up:${dose.key}`, 'dose-upcoming', ['elder'], `Coming up at ${dose.time}: ${what}`, [
          `Hello ${elderName},`,
          `Your ${what} is due at ${dose.time}.`,
          hint,
          'Tap "Taken" in Saathi once you have had it, so your circle knows you are doing well.',
        ]);
      }

      if (dose.status === 'missed' && nowMs - dueMs <= MISSED_LOOKBACK) {
        add(`miss:${dose.key}`, 'dose-missed', ['elder', 'caretaker'], `Missed dose: ${what} (${dose.time})`, [
          `${elderName}'s ${what} was due at ${dose.time} and has not been marked as taken.`,
          hint,
          'If it was taken, mark it in Saathi. If it was skipped on purpose, mark it as skipped so the record stays accurate.',
        ]);

        const misses = consecutiveMisses(circle, dose.medId, now);
        if (misses >= settings.escalateAfterMisses) {
          add(`esc:${dose.key}`, 'dose-escalation', ['elder', 'caretaker', 'family'], `Please check in: ${misses} missed doses of ${dose.name}`, [
            `${elderName} has missed ${misses} doses of ${what} in a row.`,
            'A quick, kind call often helps more than another reminder.',
            'Saathi does not give medical advice. Ask the doctor or pharmacist before changing or doubling a dose.',
          ]);
        }
      }
    }
  }

  for (const appointment of circle.appointments) {
    const untilMs = Date.parse(appointment.startsAt) - nowMs;
    if (untilMs <= 0) continue;
    const when = formatWhen(appointment.startsAt, timezone);
    const where = appointment.location ? `Where: ${appointment.location}` : null;
    const details = [`${elderName} sees ${appointment.doctor}${appointment.specialty ? ` (${appointment.specialty})` : ''} on ${when}.`, where];
    if (appointment.questions?.length) details.push('', 'Questions to ask:', ...appointment.questions.map((q) => `- ${q}`));

    if (untilMs <= 2 * HOUR) {
      add(`appt2:${appointment.id}`, 'appointment-soon', ['elder', 'caretaker', 'family'], `In under 2 hours: ${appointment.doctor}`, details);
    } else if (untilMs <= DAY) {
      add(`appt24:${appointment.id}`, 'appointment-tomorrow', ['elder', 'caretaker', 'family'], `Tomorrow: appointment with ${appointment.doctor}`, details);
    }
  }

  for (const med of circle.medications) {
    if (med.status !== 'active') continue;
    const refill = refillStatus(med);
    if (refill?.low) {
      add(`refill:${med.id}:${refill.daysLeft}`, 'refill-low', ['elder', 'caretaker'], `Refill soon: ${med.name}`, [
        `About ${refill.daysLeft} day(s) of ${med.name} left (${refill.stock} remaining).`,
        'Order a refill now so there is no gap.',
      ]);
    }
  }

  return plans;
}

export function recipientsFor(circle, roles) {
  return circle.members.filter((m) => roles.includes(m.role) && m.email && m.notify !== false).map((m) => m.email);
}

export function pruneNotified(notified, now, keepMs = 3 * DAY) {
  const cutoff = now.getTime() - keepMs;
  return Object.fromEntries(Object.entries(notified ?? {}).filter(([, at]) => Date.parse(at) >= cutoff));
}
