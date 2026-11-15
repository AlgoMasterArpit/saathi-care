import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adherence, carePulse, consecutiveMisses, doseKey, dosesOn, parseDoseKey, refillStatus, streakDays } from '../src/domain/care.js';
import { istDate, makeCircle } from './helpers.js';

const now = istDate('2026-11-15', '12:00');

describe('daily schedule', () => {
  it('labels doses as taken, missed, due or upcoming', () => {
    const circle = makeCircle({ now, medications: [{ name: 'Metformin', times: ['08:00', '11:45', '20:00'] }, { name: 'Statin', times: ['09:00'] }] });
    circle.doses[doseKey('med_0', '2026-11-15', '08:00')] = { status: 'taken', at: now.toISOString(), by: 'Asha Rao' };
    const statuses = Object.fromEntries(dosesOn(circle, '2026-11-15', now).map((d) => [`${d.name} ${d.time}`, d.status]));
    assert.deepEqual(statuses, { 'Metformin 08:00': 'taken', 'Statin 09:00': 'missed', 'Metformin 11:45': 'due', 'Metformin 20:00': 'upcoming' });
  });

  it('honours weekdays, start dates and pending status', () => {
    const circle = makeCircle({
      now,
      medications: [
        { name: 'Weekly', times: ['08:00'], days: [1] },
        { name: 'Future', times: ['08:00'], startDate: '2026-11-20' },
        { name: 'Pending', times: ['08:00'], status: 'pending' },
      ],
    });
    assert.equal(dosesOn(circle, '2026-11-15', now).length, 0);
    assert.equal(dosesOn(circle, '2026-11-16', now).length, 1);
  });

  it('skips doses that were due before a medicine was activated', () => {
    const circle = makeCircle({ now, medications: [{ name: 'New', times: ['08:00', '20:00'], activatedAt: istDate('2026-11-15', '10:00').toISOString() }] });
    assert.deepEqual(dosesOn(circle, '2026-11-15', now).map((d) => d.time), ['20:00']);
  });

  it('parses dose keys and rejects junk', () => {
    assert.deepEqual(parseDoseKey('med_a-1@2026-11-15T08:00'), { medId: 'med_a-1', date: '2026-11-15', time: '08:00' });
    assert.equal(parseDoseKey('med@bad'), null);
  });
});

describe('adherence and pulse', () => {
  const circle = makeCircle({ now, medications: [{ name: 'Statin', times: ['09:00'], stock: 2 }] });
  for (const date of ['2026-11-10', '2026-11-11', '2026-11-12']) circle.doses[doseKey('med_0', date, '09:00')] = { status: 'taken' };

  it('counts only resolved doses over the window', () => {
    const week = adherence(circle, now, 7);
    assert.equal(week.total, 7);
    assert.equal(week.taken, 3);
    assert.equal(week.rate, 43);
    assert.equal(week.daily.length, 7);
    assert.equal(week.medications[0].rate, 43);
  });

  it('counts consecutive misses back from now', () => {
    assert.equal(consecutiveMisses(circle, 'med_0', now), 3);
  });

  it('returns zero streak after a miss today', () => {
    assert.equal(streakDays(circle, now), 0);
  });

  it('forecasts refills from stock and schedule', () => {
    assert.deepEqual(refillStatus({ stock: 10, times: ['08:00', '20:00'], perDose: 1, days: [] }), { stock: 10, daysLeft: 5, low: false });
    assert.deepEqual(refillStatus({ stock: 3, times: ['08:00'], perDose: 1, days: [1, 3, 5] }), { stock: 3, daysLeft: 7, low: false });
    assert.equal(refillStatus({ stock: null, times: ['08:00'] }), null);
  });

  it('raises an act-level pulse with plain-language reasons', () => {
    const pulse = carePulse(circle, now);
    assert.equal(pulse.level, 'act');
    assert.ok(pulse.signals.some((s) => s.message.includes('3 doses missed in a row')));
    assert.ok(pulse.signals.some((s) => s.message.includes('supply left')));
  });

  it('stays steady when everything is taken', () => {
    const calm = makeCircle({ now, medications: [{ name: 'Statin', times: ['09:00'] }] });
    calm.medications[0].createdAt = istDate('2026-11-14', '00:00').toISOString();
    calm.doses[doseKey('med_0', '2026-11-14', '09:00')] = { status: 'taken' };
    calm.doses[doseKey('med_0', '2026-11-15', '09:00')] = { status: 'taken' };
    const pulse = carePulse(calm, now);
    assert.equal(pulse.level, 'steady');
    assert.equal(pulse.adherence, 100);
    assert.equal(pulse.streak, 2);
  });
});
