import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { newId } from '../lib/security.js';
import { addDays, localDate } from '../lib/time.js';
import { adherence, carePulse, dosesOn, isScheduledOn, parseDoseKey, refillStatus, settingsOf } from './care.js';

export const ROLES = Object.freeze(['elder', 'caretaker', 'family']);

const PERMISSIONS = Object.freeze({
  elder: { manageMembers: true, removeMembers: true, editProfile: true, editSettings: true, approve: true },
  caretaker: { manageMembers: true, removeMembers: false, editProfile: true, editSettings: false, approve: false },
  family: { manageMembers: false, removeMembers: false, editProfile: false, editSettings: false, approve: false },
});

const ACTIVITY_LIMIT = 200;
const OUTBOX_LIMIT = 100;
const DOSE_HISTORY_DAYS = 90;
const MEDICATION_FIELDS = ['name', 'dosage', 'instructions', 'times', 'days', 'perDose', 'stock'];

export const can = (member, permission) => Boolean(PERMISSIONS[member.role]?.[permission]);

export function assertCan(member, permission) {
  if (!can(member, permission)) throw forbidden();
}

export function buildCircle({ code, elder, elderMember, now }) {
  return {
    id: code,
    createdAt: now.toISOString(),
    elder: { conditions: [], allergies: [], emergencyContact: null, notes: '', ...elder },
    settings: {},
    members: [{ ...elderMember, role: 'elder', notify: true, createdAt: now.toISOString() }],
    medications: [],
    appointments: [],
    doses: {},
    notified: {},
    activity: [],
    outbox: [],
  };
}

export function findMember(circle, memberId) {
  return circle.members.find((m) => m.id === memberId) ?? null;
}

export function logActivity(circle, member, action, detail, now) {
  circle.activity.unshift({ at: now.toISOString(), by: member?.name ?? 'Saathi', action, detail });
  circle.activity.length = Math.min(circle.activity.length, ACTIVITY_LIMIT);
}

function findMedication(circle, id) {
  const medication = circle.medications.find((m) => m.id === id);
  if (!medication) throw notFound('Medicine not found');
  return medication;
}

function needsApproval(circle, member) {
  return member.role !== 'elder' && settingsOf(circle).requireApproval;
}

function pick(source, fields) {
  return Object.fromEntries(fields.filter((f) => source[f] !== undefined).map((f) => [f, source[f]]));
}

export function addMedication(circle, member, input, now) {
  const pendingApproval = needsApproval(circle, member);
  const stamp = now.toISOString();
  const medication = {
    id: newId('med'),
    ...pick(input, MEDICATION_FIELDS),
    status: pendingApproval ? 'pending' : 'active',
    proposal: null,
    startDate: localDate(now, circle.elder.timezone),
    createdAt: stamp,
    activatedAt: pendingApproval ? null : stamp,
    createdBy: member.id,
    createdByName: member.name,
  };
  circle.medications.push(medication);
  logActivity(circle, member, pendingApproval ? 'proposed a medicine' : 'added a medicine', medication.name, now);
  return { medication, pendingApproval };
}

export function updateMedication(circle, member, id, patch, now) {
  const medication = findMedication(circle, id);
  const changes = pick(patch, MEDICATION_FIELDS);
  if (needsApproval(circle, member) && medication.status === 'active') {
    medication.proposal = { type: 'update', patch: changes, by: member.id, byName: member.name, at: now.toISOString() };
    logActivity(circle, member, 'proposed a change to', medication.name, now);
    return { medication, pendingApproval: true };
  }
  Object.assign(medication, changes, { updatedAt: now.toISOString() });
  logActivity(circle, member, 'updated', medication.name, now);
  return { medication, pendingApproval: false };
}

export function removeMedication(circle, member, id, now) {
  const medication = findMedication(circle, id);
  if (needsApproval(circle, member) && medication.status === 'active') {
    medication.proposal = { type: 'remove', patch: {}, by: member.id, byName: member.name, at: now.toISOString() };
    logActivity(circle, member, 'proposed stopping', medication.name, now);
    return { pendingApproval: true };
  }
  circle.medications = circle.medications.filter((m) => m.id !== id);
  logActivity(circle, member, 'removed', medication.name, now);
  return { pendingApproval: false };
}

export function decideMedication(circle, member, id, approve, now) {
  assertCan(member, 'approve');
  const medication = findMedication(circle, id);
  if (medication.status !== 'pending' && !medication.proposal) throw conflict('Nothing is waiting for a decision');

  if (medication.status === 'pending') {
    if (approve) {
      medication.status = 'active';
      medication.activatedAt = now.toISOString();
      medication.startDate = localDate(now, circle.elder.timezone);
    } else {
      circle.medications = circle.medications.filter((m) => m.id !== id);
    }
  } else if (approve && medication.proposal.type === 'remove') {
    circle.medications = circle.medications.filter((m) => m.id !== id);
  } else {
    if (approve) Object.assign(medication, medication.proposal.patch, { updatedAt: now.toISOString() });
    medication.proposal = null;
  }
  logActivity(circle, member, approve ? 'approved' : 'declined', medication.name, now);
  return medication;
}

export function logDose(circle, member, key, status, now) {
  const parsed = parseDoseKey(key);
  if (!parsed) throw badRequest('Unknown dose');
  const medication = findMedication(circle, parsed.medId);
  const today = localDate(now, circle.elder.timezone);
  if (parsed.date > today || parsed.date < addDays(today, -2)) throw badRequest('Doses can only be logged for the last two days');
  if (!isScheduledOn(medication, parsed.date) || !medication.times.includes(parsed.time)) throw badRequest('That dose is not on the schedule');

  const previous = circle.doses[key]?.status;
  if (typeof medication.stock === 'number') {
    const units = medication.perDose ?? 1;
    if (status === 'taken' && previous !== 'taken') medication.stock = Math.max(0, medication.stock - units);
    if (status !== 'taken' && previous === 'taken') medication.stock += units;
  }
  circle.doses[key] = { status, at: now.toISOString(), by: member.name };
  logActivity(circle, member, status === 'taken' ? 'marked taken' : 'marked skipped', `${medication.name} at ${parsed.time}`, now);
  return dosesOn(circle, parsed.date, now).find((dose) => dose.key === key);
}

export function addAppointment(circle, member, input, now) {
  const appointment = { id: newId('apt'), ...input, createdBy: member.name, createdAt: now.toISOString() };
  circle.appointments.push(appointment);
  logActivity(circle, member, 'added an appointment with', appointment.doctor, now);
  return appointment;
}

function findAppointment(circle, id) {
  const appointment = circle.appointments.find((a) => a.id === id);
  if (!appointment) throw notFound('Appointment not found');
  return appointment;
}

export function updateAppointment(circle, member, id, patch, now) {
  const appointment = findAppointment(circle, id);
  Object.assign(appointment, patch);
  if (patch.startsAt) {
    for (const key of Object.keys(circle.notified)) if (key.endsWith(`:${id}`)) delete circle.notified[key];
  }
  logActivity(circle, member, 'updated the appointment with', appointment.doctor, now);
  return appointment;
}

export function removeAppointment(circle, member, id, now) {
  const appointment = findAppointment(circle, id);
  circle.appointments = circle.appointments.filter((a) => a.id !== id);
  logActivity(circle, member, 'removed the appointment with', appointment.doctor, now);
}

export function addMember(circle, member, input, passcodeHash, now) {
  assertCan(member, 'manageMembers');
  if (circle.members.length >= 12) throw conflict('A circle can have up to 12 members');
  const newMember = { id: newId('mem'), ...input, passcodeHash, notify: true, createdAt: now.toISOString() };
  circle.members.push(newMember);
  logActivity(circle, member, `invited a ${input.role}`, input.name, now);
  return newMember;
}

export function removeMember(circle, member, memberId, now) {
  assertCan(member, 'removeMembers');
  const target = findMember(circle, memberId);
  if (!target) throw notFound('Member not found');
  if (target.role === 'elder') throw conflict('The elder cannot be removed from their own circle');
  circle.members = circle.members.filter((m) => m.id !== memberId);
  logActivity(circle, member, 'removed', target.name, now);
}

export function updateProfile(circle, member, patch, now) {
  assertCan(member, 'editProfile');
  Object.assign(circle.elder, patch);
  const elder = circle.members.find((m) => m.role === 'elder');
  if (patch.name) elder.name = patch.name;
  if (patch.email) elder.email = patch.email;
  logActivity(circle, member, 'updated the health profile', Object.keys(patch).join(', '), now);
}

export function updateSettings(circle, member, patch, now) {
  assertCan(member, 'editSettings');
  circle.settings = { ...circle.settings, ...patch };
  logActivity(circle, member, 'changed settings', Object.keys(patch).join(', '), now);
}

export function recordOutbox(circle, entry) {
  circle.outbox.unshift({ id: newId('msg'), ...entry });
  circle.outbox.length = Math.min(circle.outbox.length, OUTBOX_LIMIT);
}

export function pruneDoses(circle, now) {
  const cutoff = addDays(localDate(now, circle.elder.timezone), -DOSE_HISTORY_DAYS);
  for (const key of Object.keys(circle.doses)) {
    if ((parseDoseKey(key)?.date ?? '') < cutoff) delete circle.doses[key];
  }
}

const publicMember = ({ id, name, role, email, notify, createdAt }) => ({ id, name, role, email, notify, createdAt });

export function toView(circle, member, now, features) {
  const today = localDate(now, circle.elder.timezone);
  return {
    code: circle.id,
    elder: circle.elder,
    settings: settingsOf(circle),
    me: { ...publicMember(member), can: { ...PERMISSIONS[member.role] } },
    members: circle.members.map(publicMember),
    medications: circle.medications.map((m) => ({
      id: m.id,
      name: m.name,
      dosage: m.dosage ?? '',
      instructions: m.instructions ?? '',
      times: m.times,
      days: m.days ?? [],
      perDose: m.perDose ?? 1,
      stock: typeof m.stock === 'number' ? m.stock : null,
      status: m.status,
      proposal: m.proposal ? { type: m.proposal.type, patch: m.proposal.patch, byName: m.proposal.byName, at: m.proposal.at } : null,
      createdByName: m.createdByName,
      refill: refillStatus(m),
    })),
    today: { date: today, doses: dosesOn(circle, today, now) },
    earlier: [addDays(today, -1), addDays(today, -2)]
      .flatMap((date) => dosesOn(circle, date, now))
      .filter((dose) => dose.status === 'missed' || dose.status === 'skipped')
      .sort((a, b) => b.dueAt.localeCompare(a.dueAt)),
    appointments: [...circle.appointments].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    pulse: carePulse(circle, now),
    adherence: adherence(circle, now, 7),
    activity: circle.activity.slice(0, 50),
    outbox: circle.outbox.slice(0, 30),
    features,
  };
}

export function briefContext(circle, now) {
  const week = adherence(circle, now, 7);
  const pulse = carePulse(circle, now);
  return {
    elderFirstName: circle.elder.name.split(' ')[0],
    conditions: circle.elder.conditions,
    weeklyAdherencePercent: week.rate,
    daily: week.daily.map(({ date, taken, total }) => ({ date, taken, total })),
    medicines: circle.medications
      .filter((m) => m.status === 'active')
      .map((m) => ({
        name: m.name,
        dosage: m.dosage,
        times: m.times,
        adherencePercent: week.medications.find((x) => x.medId === m.id)?.rate ?? null,
        daysOfSupplyLeft: refillStatus(m)?.daysLeft ?? null,
      })),
    streakDays: pulse.streak,
    signals: pulse.signals.map((s) => s.message),
    nextAppointments: circle.appointments
      .filter((a) => a.startsAt >= now.toISOString())
      .slice(0, 3)
      .map((a) => ({ doctor: a.doctor, specialty: a.specialty, startsAt: a.startsAt })),
  };
}
