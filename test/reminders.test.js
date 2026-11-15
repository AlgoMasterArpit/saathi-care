import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { doseKey } from '../src/domain/care.js';
import { planReminders, pruneNotified, recipientsFor } from '../src/domain/reminders.js';
import { istDate, makeCircle } from './helpers.js';

const kinds = (plans) => plans.map((p) => p.kind).sort();

describe('reminder planning', () => {
  it('sends an upcoming reminder to the elder shortly before a dose', () => {
    const now = istDate('2026-11-15', '07:50');
    const circle = makeCircle({ now, medications: [{ name: 'Metformin', dosage: '500 mg', instructions: 'After food', times: ['08:00'] }] });
    const [plan] = planReminders(circle, now).filter((p) => p.kind === 'dose-upcoming');
    assert.deepEqual(plan.roles, ['elder']);
    assert.match(plan.subject, /Metformin 500 mg/);
    assert.match(plan.text, /Note: After food/);
  });

  it('alerts elder and caretaker after the grace period, then escalates to family', () => {
    const now = istDate('2026-11-15', '09:00');
    const circle = makeCircle({ now, medications: [{ name: 'Statin', times: ['08:00'] }] });
    circle.doses[doseKey('med_0', '2026-11-13', '08:00')] = { status: 'taken' };
    const plans = planReminders(circle, now);
    assert.deepEqual(kinds(plans), ['dose-escalation', 'dose-missed']);
    assert.deepEqual(plans.find((p) => p.kind === 'dose-escalation').roles, ['elder', 'caretaker', 'family']);
    assert.match(plans.find((p) => p.kind === 'dose-escalation').text, /does not give medical advice/);
  });

  it('does not repeat a reminder that was already sent', () => {
    const now = istDate('2026-11-15', '09:00');
    const circle = makeCircle({ now, medications: [{ name: 'Statin', times: ['08:00'] }] });
    for (const plan of planReminders(circle, now)) circle.notified[plan.key] = now.toISOString();
    assert.equal(planReminders(circle, now).length, 0);
  });

  it('stays quiet for taken doses and doses missed long ago', () => {
    const now = istDate('2026-11-15', '20:00');
    const circle = makeCircle({ now, medications: [{ name: 'Statin', times: ['08:00'] }] });
    circle.doses[doseKey('med_0', '2026-11-14', '08:00')] = { status: 'taken' };
    assert.equal(planReminders(circle, now).filter((p) => p.kind.startsWith('dose')).length, 0);
  });

  it('reminds the whole circle a day and two hours before appointments', () => {
    const appointment = { id: 'apt_1', doctor: 'Dr. Iyer', specialty: 'Cardiology', location: 'Apollo', startsAt: istDate('2026-11-16', '10:00').toISOString(), questions: ['Is my BP ok?'] };
    const dayBefore = makeCircle({ appointments: [appointment] });
    const [plan] = planReminders(dayBefore, istDate('2026-11-15', '12:00'));
    assert.equal(plan.kind, 'appointment-tomorrow');
    assert.match(plan.text, /Is my BP ok\?/);
    const [soon] = planReminders(dayBefore, istDate('2026-11-16', '08:30'));
    assert.equal(soon.kind, 'appointment-soon');
    assert.equal(planReminders(dayBefore, istDate('2026-11-16', '11:00')).length, 0);
  });

  it('warns before a medicine runs out', () => {
    const now = istDate('2026-11-15', '12:00');
    const circle = makeCircle({ now, medications: [{ name: 'Statin', times: ['22:00'], stock: 2 }] });
    const plan = planReminders(circle, now).find((p) => p.kind === 'refill-low');
    assert.equal(plan.key, 'refill:med_0:2');
  });

  it('only emails members who opted in', () => {
    const circle = makeCircle();
    circle.members[2].notify = false;
    assert.deepEqual(recipientsFor(circle, ['elder', 'caretaker', 'family']), ['asha@mail.com', 'joy@mail.com']);
  });

  it('prunes old notification keys', () => {
    const now = istDate('2026-11-15', '12:00');
    const pruned = pruneNotified({ old: '2026-11-01T00:00:00Z', fresh: now.toISOString() }, now);
    assert.deepEqual(Object.keys(pruned), ['fresh']);
  });
});
