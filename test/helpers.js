import { buildCircle } from '../src/domain/circle.js';

export const TZ = 'Asia/Kolkata';

export const istDate = (date, time) => new Date(`${date}T${time}:00+05:30`);

export function makeCircle({ now = istDate('2026-11-15', '12:00'), medications = [], appointments = [], members = [] } = {}) {
  const created = new Date(now.getTime() - 10 * 86_400_000);
  const circle = buildCircle({
    code: 'SA-TEST01',
    elder: { name: 'Asha Rao', email: 'asha@mail.com', timezone: TZ },
    elderMember: { id: 'mem_elder', name: 'Asha Rao', email: 'asha@mail.com', passcodeHash: 'x' },
    now: created,
  });
  circle.members.push(
    { id: 'mem_care', name: 'Nurse Joy', email: 'joy@mail.com', role: 'caretaker', notify: true },
    { id: 'mem_fam', name: 'Arjun Rao', email: 'arjun@mail.com', role: 'family', notify: true },
    ...members,
  );
  circle.medications = medications.map((m, i) => ({
    id: `med_${i}`,
    dosage: '',
    instructions: '',
    days: [],
    perDose: 1,
    status: 'active',
    proposal: null,
    startDate: '2026-11-01',
    createdAt: created.toISOString(),
    ...m,
  }));
  circle.appointments = appointments;
  return circle;
}

export const memberOf = (circle, role) => circle.members.find((m) => m.role === role);
