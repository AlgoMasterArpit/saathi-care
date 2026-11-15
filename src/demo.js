import { buildCircle, logActivity, recordOutbox } from './domain/circle.js';
import { doseKey, isScheduledOn } from './domain/care.js';
import { hashPasscode } from './lib/security.js';
import { addDays, localDate, zonedToUtc, DAY, HOUR } from './lib/time.js';

export const DEMO_CODE = 'SA-DEMO42';
export const DEMO_PASSCODES = Object.freeze({ elder: '246810', caretaker: '135790', family: '112233' });

const TIMEZONE = 'Asia/Kolkata';

const MEDICATIONS = [
  { id: 'med_metformin', name: 'Metformin', dosage: '500 mg tablet', instructions: 'After breakfast and dinner', times: ['08:30', '20:30'], days: [], perDose: 1, stock: 38 },
  { id: 'med_amlodipine', name: 'Amlodipine', dosage: '5 mg tablet', instructions: 'With water, same time daily', times: ['09:00'], days: [], perDose: 1, stock: 21 },
  { id: 'med_atorvastatin', name: 'Atorvastatin', dosage: '10 mg tablet', instructions: 'At bedtime', times: ['21:30'], days: [], perDose: 1, stock: 3 },
  { id: 'med_calcium', name: 'Calcium + Vitamin D3', dosage: '500 mg tablet', instructions: 'After lunch', times: ['13:30'], days: [1, 3, 5], perDose: 1, stock: 20 },
];

const MISSED = new Set(['med_atorvastatin@-1', 'med_atorvastatin@-2', 'med_metformin@-4@20:30', 'med_calcium@-5']);

function atLocal(now, dayOffset, time) {
  return zonedToUtc(addDays(localDate(now, TIMEZONE), dayOffset), time, TIMEZONE).toISOString();
}

export async function buildDemoCircle(now) {
  const [elderHash, caretakerHash, familyHash] = await Promise.all([
    hashPasscode(DEMO_PASSCODES.elder),
    hashPasscode(DEMO_PASSCODES.caretaker),
    hashPasscode(DEMO_PASSCODES.family),
  ]);
  const created = new Date(now.getTime() - 30 * DAY);
  const elder = { id: 'mem_kamla', name: 'Kamla Devi', email: 'kamla@example.com', passcodeHash: elderHash };
  const circle = buildCircle({
    code: DEMO_CODE,
    elder: {
      name: 'Kamla Devi',
      email: 'kamla@example.com',
      timezone: TIMEZONE,
      conditions: ['Type 2 diabetes', 'High blood pressure', 'Knee osteoarthritis'],
      allergies: ['Penicillin'],
      emergencyContact: { name: 'Priya Sharma (daughter)', phone: '+91 98765 43210' },
      notes: 'Prefers reminders in simple English. Walks every evening at 6 pm.',
    },
    elderMember: elder,
    now: created,
  });
  circle.demo = true;
  circle.members.push(
    { id: 'mem_ravi', name: 'Ravi Kumar', email: 'ravi.nurse@example.com', role: 'caretaker', passcodeHash: caretakerHash, notify: true, createdAt: created.toISOString() },
    { id: 'mem_priya', name: 'Priya Sharma', email: 'priya@example.com', role: 'family', passcodeHash: familyHash, notify: true, createdAt: created.toISOString() },
  );

  const startDate = localDate(created, TIMEZONE);
  circle.medications = MEDICATIONS.map((m) => ({
    ...m,
    status: 'active',
    proposal: null,
    startDate,
    createdAt: created.toISOString(),
    activatedAt: created.toISOString(),
    createdBy: 'mem_ravi',
    createdByName: 'Ravi Kumar',
  }));
  circle.medications.push({
    id: 'med_b12',
    name: 'Vitamin B12',
    dosage: '1500 mcg tablet',
    instructions: 'After breakfast',
    times: ['08:30'],
    days: [],
    perDose: 1,
    stock: 30,
    status: 'pending',
    proposal: null,
    startDate: localDate(now, TIMEZONE),
    createdAt: new Date(now.getTime() - 3 * HOUR).toISOString(),
    activatedAt: null,
    createdBy: 'mem_priya',
    createdByName: 'Priya Sharma',
  });

  const today = localDate(now, TIMEZONE);
  for (let offset = -7; offset <= 0; offset += 1) {
    const date = addDays(today, offset);
    for (const med of circle.medications.filter((m) => m.status === 'active')) {
      if (!isScheduledOn(med, date)) continue;
      for (const time of med.times) {
        const dueAt = zonedToUtc(date, time, TIMEZONE).getTime();
        const missed = MISSED.has(`${med.id}@${offset}`) || MISSED.has(`${med.id}@${offset}@${time}`);
        const settled = offset < 0 || now.getTime() - dueAt > 3 * HOUR;
        if (missed || !settled) continue;
        circle.doses[doseKey(med.id, date, time)] = {
          status: 'taken',
          at: new Date(dueAt + 12 * 60_000).toISOString(),
          by: offset % 3 === 0 ? 'Ravi Kumar' : 'Kamla Devi',
        };
      }
    }
  }

  circle.appointments = [
    {
      id: 'apt_endo',
      doctor: 'Dr. Meera Iyer',
      specialty: 'Endocrinologist',
      location: 'Apollo Clinic, Indiranagar, Bengaluru',
      startsAt: atLocal(now, 2, '11:00'),
      notes: 'Bring last 3 months of sugar readings.',
      questions: ['Is my HbA1c moving in the right direction?', 'Should I check sugar before or after walks?'],
      createdBy: 'Priya Sharma',
      createdAt: created.toISOString(),
    },
    {
      id: 'apt_cardio',
      doctor: 'Dr. Arvind Rao',
      specialty: 'Cardiologist',
      location: 'Manipal Hospital, Old Airport Road, Bengaluru',
      startsAt: atLocal(now, 9, '16:30'),
      notes: 'Routine BP review.',
      questions: [],
      createdBy: 'Ravi Kumar',
      createdAt: created.toISOString(),
    },
    {
      id: 'apt_ortho',
      doctor: 'Dr. Sanjay Menon',
      specialty: 'Orthopaedics',
      location: 'Sakra World Hospital, Bengaluru',
      startsAt: atLocal(now, -12, '10:00'),
      notes: 'Knee physiotherapy plan reviewed.',
      questions: [],
      createdBy: 'Kamla Devi',
      createdAt: created.toISOString(),
    },
  ];

  const ravi = circle.members[1];
  const priya = circle.members[2];
  const at = (hoursAgo) => new Date(now.getTime() - hoursAgo * HOUR);
  logActivity(circle, ravi, 'added an appointment with', 'Dr. Arvind Rao', at(30));
  logActivity(circle, elder, 'marked taken', 'Amlodipine at 09:00', at(26));
  logActivity(circle, priya, 'proposed a medicine', 'Vitamin B12', at(3));

  recordOutbox(circle, { at: atLocal(now, -1, '22:00'), kind: 'dose-missed', subject: 'Missed dose: Atorvastatin 10 mg tablet (21:30)', to: ['kamla@example.com', 'ravi.nurse@example.com'], delivered: false });
  recordOutbox(circle, { at: atLocal(now, -1, '22:00'), kind: 'dose-escalation', subject: 'Please check in: 2 missed doses of Atorvastatin', to: ['kamla@example.com', 'ravi.nurse@example.com', 'priya@example.com'], delivered: false });
  recordOutbox(circle, { at: atLocal(now, 0, '07:00'), kind: 'refill-low', subject: 'Refill soon: Atorvastatin', to: ['kamla@example.com', 'ravi.nurse@example.com'], delivered: false });
  return circle;
}

export async function seedDemo(store, now = new Date()) {
  if (await store.get(DEMO_CODE)) return false;
  return store.create(await buildDemoCircle(now));
}
