import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addMedication, addMember, decideMedication, logDose, removeMedication, removeMember, toView, updateMedication, updateSettings } from '../src/domain/circle.js';
import { HttpError } from '../src/lib/errors.js';
import { istDate, makeCircle, memberOf } from './helpers.js';

const now = istDate('2026-11-15', '12:00');
const medInput = { name: 'Vitamin B12', dosage: '1500 mcg', instructions: '', times: ['08:30'], days: [], perDose: 1, stock: 30 };
const rejectsWith = (status) => (error) => error instanceof HttpError && error.status === status;

describe('elder-first approvals', () => {
  it('activates medicines the elder adds', () => {
    const circle = makeCircle({ now });
    const { medication, pendingApproval } = addMedication(circle, memberOf(circle, 'elder'), medInput, now);
    assert.equal(pendingApproval, false);
    assert.equal(medication.status, 'active');
  });

  it('holds medicines added by family until the elder approves', () => {
    const circle = makeCircle({ now });
    const { medication, pendingApproval } = addMedication(circle, memberOf(circle, 'family'), medInput, now);
    assert.equal(pendingApproval, true);
    assert.equal(medication.status, 'pending');
    assert.throws(() => decideMedication(circle, memberOf(circle, 'caretaker'), medication.id, true, now), rejectsWith(403));
    decideMedication(circle, memberOf(circle, 'elder'), medication.id, true, now);
    assert.equal(circle.medications[0].status, 'active');
    assert.equal(circle.activity[0].action, 'approved');
  });

  it('lets the elder decline a proposed medicine', () => {
    const circle = makeCircle({ now });
    const { medication } = addMedication(circle, memberOf(circle, 'caretaker'), medInput, now);
    decideMedication(circle, memberOf(circle, 'elder'), medication.id, false, now);
    assert.equal(circle.medications.length, 0);
  });

  it('turns edits and removals by others into proposals', () => {
    const circle = makeCircle({ now, medications: [{ name: 'Statin', times: ['21:00'] }] });
    const family = memberOf(circle, 'family');
    updateMedication(circle, family, 'med_0', { times: ['22:00'] }, now);
    assert.deepEqual(circle.medications[0].times, ['21:00']);
    assert.equal(circle.medications[0].proposal.type, 'update');
    decideMedication(circle, memberOf(circle, 'elder'), 'med_0', true, now);
    assert.deepEqual(circle.medications[0].times, ['22:00']);
    assert.equal(circle.medications[0].proposal, null);

    assert.deepEqual(removeMedication(circle, family, 'med_0', now), { pendingApproval: true });
    decideMedication(circle, memberOf(circle, 'elder'), 'med_0', true, now);
    assert.equal(circle.medications.length, 0);
  });

  it('skips approvals when the elder turns them off', () => {
    const circle = makeCircle({ now });
    updateSettings(circle, memberOf(circle, 'elder'), { requireApproval: false }, now);
    assert.equal(addMedication(circle, memberOf(circle, 'family'), medInput, now).pendingApproval, false);
    assert.throws(() => updateSettings(circle, memberOf(circle, 'caretaker'), { requireApproval: true }, now), rejectsWith(403));
  });

  it('refuses decisions when nothing is pending', () => {
    const circle = makeCircle({ now, medications: [{ name: 'Statin', times: ['21:00'] }] });
    assert.throws(() => decideMedication(circle, memberOf(circle, 'elder'), 'med_0', true, now), rejectsWith(409));
  });
});

describe('dose logging', () => {
  it('records who logged a dose and tracks stock both ways', () => {
    const circle = makeCircle({ now, medications: [{ name: 'Statin', times: ['09:00'], stock: 10, perDose: 2 }] });
    const key = 'med_0@2026-11-15T09:00';
    const dose = logDose(circle, memberOf(circle, 'caretaker'), key, 'taken', now);
    assert.equal(dose.status, 'taken');
    assert.equal(dose.loggedBy, 'Nurse Joy');
    assert.equal(circle.medications[0].stock, 8);
    logDose(circle, memberOf(circle, 'elder'), key, 'taken', now);
    assert.equal(circle.medications[0].stock, 8);
    logDose(circle, memberOf(circle, 'elder'), key, 'skipped', now);
    assert.equal(circle.medications[0].stock, 10);
  });

  it('rejects doses that are not on the schedule or too old', () => {
    const circle = makeCircle({ now, medications: [{ name: 'Statin', times: ['09:00'] }] });
    const elder = memberOf(circle, 'elder');
    assert.throws(() => logDose(circle, elder, 'med_0@2026-11-15T10:00', 'taken', now), rejectsWith(400));
    assert.throws(() => logDose(circle, elder, 'med_0@2026-11-10T09:00', 'taken', now), rejectsWith(400));
    assert.throws(() => logDose(circle, elder, 'med_0@2026-11-16T09:00', 'taken', now), rejectsWith(400));
    assert.throws(() => logDose(circle, elder, 'med_x@2026-11-15T09:00', 'taken', now), rejectsWith(404));
  });
});

describe('membership', () => {
  it('lets caretakers invite but only the elder remove', () => {
    const circle = makeCircle({ now });
    const added = addMember(circle, memberOf(circle, 'caretaker'), { name: 'Neha', email: 'neha@mail.com', role: 'family' }, 'hash', now);
    assert.throws(() => addMember(circle, memberOf(circle, 'family'), { name: 'X', email: 'x@mail.com', role: 'family' }, 'hash', now), rejectsWith(403));
    assert.throws(() => removeMember(circle, memberOf(circle, 'caretaker'), added.id, now), rejectsWith(403));
    assert.throws(() => removeMember(circle, memberOf(circle, 'elder'), 'mem_elder', now), rejectsWith(409));
    removeMember(circle, memberOf(circle, 'elder'), added.id, now);
    assert.equal(circle.members.some((m) => m.id === added.id), false);
  });

  it('never exposes passcode hashes in the view', () => {
    const circle = makeCircle({ now });
    const view = toView(circle, memberOf(circle, 'family'), now, { ai: false, email: false });
    assert.equal(JSON.stringify(view).includes('passcodeHash'), false);
    assert.equal(view.me.can.approve, false);
  });
});
