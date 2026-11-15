import { api } from './api.js';
import {
  WEEKDAYS,
  busy,
  clock12,
  describeDays,
  field,
  formError,
  formatDateTime,
  formatTime,
  h,
  nextId,
  openDialog,
  prefersReducedMotion,
  ring,
  toast,
  validateForm,
} from './dom.js';
import { icon } from './icons.js';

const STATUS = {
  taken: { icon: 'check', label: 'Taken' },
  skipped: { icon: 'minus', label: 'Skipped' },
  missed: { icon: 'alert', label: 'Missed' },
  due: { icon: 'clock', label: 'Due now' },
  upcoming: { icon: 'circle', label: 'Upcoming' },
};

const PULSE = {
  steady: { label: 'All steady', icon: 'leaf', tone: 'ok' },
  watch: { label: 'Keep an eye', icon: 'eye', tone: 'warn' },
  act: { label: 'Needs attention', icon: 'alert', tone: 'danger' },
};

export function statusBadge(status) {
  const meta = STATUS[status] ?? STATUS.upcoming;
  return h('span', { class: `badge badge-${status}` }, icon(meta.icon), meta.label);
}

const FIELD_LABEL = { name: 'name', dosage: 'strength', instructions: 'instructions', perDose: 'units per dose', stock: 'stock' };

export function describeProposal(med) {
  if (med.status === 'pending') return `${med.createdByName ?? 'Someone'} wants to add this · ${med.times.map(clock12).join(', ')} · ${describeDays(med.days)}`;
  if (med.proposal.type === 'remove') return `${med.proposal.byName} proposes stopping this medicine`;
  const changes = Object.entries(med.proposal.patch ?? {}).map(([key, value]) => {
    if (key === 'times') return `times → ${value.map(clock12).join(', ')}`;
    if (key === 'days') return `days → ${describeDays(value)}`;
    return `${FIELD_LABEL[key] ?? key} → ${value === null || value === '' ? 'none' : value}`;
  });
  return `${med.proposal.byName} proposes: ${changes.join('; ') || 'a change'}`;
}

export function decisionButtons(med, ctx) {
  const approve = h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': `Approve ${med.name}` }, icon('check'), 'Approve');
  const decline = h('button', { type: 'button', class: 'btn btn-secondary', 'aria-label': `Decline ${med.name}` }, icon('x'), 'Decline');
  approve.addEventListener('click', () => run(approve, async () => {
    await api.decide(med.id, true);
    await ctx.refresh();
  }, `${med.name} approved`));
  decline.addEventListener('click', () => run(decline, async () => {
    await api.decide(med.id, false);
    await ctx.refresh();
  }, `${med.name} declined`));
  return [approve, decline];
}

function untilText(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} m` : `${hours} h`;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function viewHeading(title, subtitle) {
  return h('div', { class: 'view-head' }, h('h1', { tabindex: '-1', class: 'view-title' }, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null);
}

export async function run(button, task, success) {
  try {
    await busy(button, task);
    if (success) toast(success);
  } catch (error) {
    toast(error.message);
  }
}

function greeting(timeZone) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function speakDay(data) {
  const pending = data.today.doses.filter((d) => d.status === 'upcoming' || d.status === 'due' || d.status === 'missed');
  const parts = [`${greeting(data.elder.timezone)}, ${data.elder.name}.`];
  if (pending.length) {
    parts.push(`You have ${pending.length} ${pending.length === 1 ? 'medicine' : 'medicines'} still to take today.`);
    for (const dose of pending) parts.push(`${dose.name} ${dose.dosage} at ${clock12(dose.time)}.${dose.instructions ? ` ${dose.instructions}.` : ''}`);
  } else {
    parts.push("All of today's medicines are done. Well done.");
  }
  const next = data.appointments.find((a) => Date.parse(a.startsAt) > Date.now());
  if (next) parts.push(`Your next appointment is with ${next.doctor} on ${formatDateTime(next.startsAt, data.elder.timezone)}.`);
  const utterance = new SpeechSynthesisUtterance(parts.join(' '));
  utterance.lang = 'en-IN';
  utterance.rate = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function appointmentSummary(appointment, timeZone) {
  return h(
    'div',
    { class: 'appt-summary' },
    h('p', { class: 'appt-when' }, icon('calendar'), formatDateTime(appointment.startsAt, timeZone)),
    h('p', { class: 'appt-doctor' }, appointment.doctor, appointment.specialty ? ` · ${appointment.specialty}` : ''),
    appointment.location ? h('p', { class: 'muted appt-loc' }, icon('pin'), appointment.location) : null,
  );
}

function decisionsCard(data, ctx) {
  const waiting = data.medications.filter((m) => m.status === 'pending' || m.proposal);
  if (!waiting.length) return null;
  return h(
    'section',
    { class: 'card decisions', 'aria-labelledby': 'decisions-title' },
    h(
      'div',
      { class: 'decisions-head' },
      h('span', { class: 'decisions-icon' }, icon('shield')),
      h('div', {}, h('h2', { id: 'decisions-title' }, 'Waiting for your decision'), h('p', { class: 'muted' }, 'Nothing changes on your list until you say yes.')),
    ),
    h(
      'ul',
      { class: 'decision-list' },
      waiting.map((med) =>
        h(
          'li',
          { class: 'decision' },
          h('div', { class: 'decision-main' }, h('p', { class: 'dose-name' }, med.name, ' ', h('span', { class: 'dose-dosage' }, med.dosage)), h('p', { class: 'muted' }, describeProposal(med))),
          h('div', { class: 'dose-actions' }, decisionButtons(med, ctx)),
        ),
      ),
    ),
  );
}

function progressCard(data) {
  const { doses } = data.today;
  const taken = doses.filter((d) => d.status === 'taken').length;
  const total = doses.length;
  const next = doses.find((d) => d.status === 'due' || d.status === 'upcoming');
  const missed = doses.filter((d) => d.status === 'missed').length;
  let nextLine;
  if (!total) nextLine = 'No medicines scheduled today.';
  else if (!next) nextLine = taken === total ? 'All done for today. Well done!' : 'No more doses scheduled today.';
  else if (next.status === 'due') nextLine = `${next.name} is due now`;
  else nextLine = `Next: ${next.name} in ${untilText(Date.parse(next.dueAt) - Date.now())}`;
  const readAloud = 'speechSynthesis' in window ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => speakDay(data) }, icon('speaker'), 'Read my day aloud') : null;
  return h(
    'section',
    { class: 'card progress-card', 'aria-labelledby': 'progress-title' },
    h('h2', { id: 'progress-title' }, 'Today so far'),
    h(
      'div',
      { class: 'progress-body' },
      ring(total ? (taken / total) * 100 : 0, { label: `${taken} of ${total} medicines taken today`, big: `${taken}/${total}`, small: 'taken', tone: missed ? 'warn' : 'ok' }),
      h(
        'div',
        { class: 'progress-text' },
        h('p', { class: 'next-line' }, icon('clock'), h('span', {}, nextLine)),
        missed ? h('p', { class: 'missed-line' }, icon('alert'), h('span', {}, `${missed} missed earlier today`)) : null,
      ),
    ),
    readAloud,
  );
}

function pulseCard(pulse) {
  const meta = PULSE[pulse.level] ?? PULSE.steady;
  return h(
    'section',
    { class: `card pulse pulse-${pulse.level}`, 'aria-labelledby': 'pulse-title' },
    h('h2', { id: 'pulse-title' }, 'Care Pulse'),
    h(
      'div',
      { class: 'pulse-body' },
      ring(pulse.adherence, {
        label: pulse.adherence === null ? 'No doses recorded this week' : `${pulse.adherence}% of doses taken this week`,
        big: pulse.adherence === null ? '—' : `${pulse.adherence}%`,
        small: 'this week',
        size: 104,
        stroke: 10,
        tone: meta.tone,
      }),
      h(
        'div',
        {},
        h('p', { class: `pulse-level tone-${meta.tone}` }, icon(meta.icon), meta.label),
        h('p', { class: 'muted streak' }, icon('heart'), `${pulse.streak} ${pulse.streak === 1 ? 'day' : 'days'} streak`),
      ),
    ),
    pulse.signals.length
      ? h('ul', { class: 'signals' }, pulse.signals.map((s) => h('li', { class: `signal signal-${s.severity}` }, icon(s.severity === 'act' ? 'alert' : s.severity === 'watch' ? 'eye' : 'bell'), h('span', {}, s.message))))
      : h('p', { class: 'muted' }, 'Nothing needs attention right now.'),
  );
}

export function renderToday(data, ctx) {
  const { elder, me, pulse, today, settings } = data;
  const tz = elder.timezone;
  const isElder = me.role === 'elder';

  const doseItems = today.doses.map((dose) => {
    const takeBtn = h('button', { type: 'button', class: 'btn btn-take', 'aria-pressed': String(dose.status === 'taken'), 'data-key': `take-${dose.key}` }, icon('check'), 'Taken');
    const skipBtn = h('button', { type: 'button', class: 'btn btn-secondary', 'aria-pressed': String(dose.status === 'skipped'), 'data-key': `skip-${dose.key}` }, 'Skip');
    const label = `${dose.name} at ${clock12(dose.time)}`;
    takeBtn.setAttribute('aria-label', `Mark ${label} as taken`);
    skipBtn.setAttribute('aria-label', `Mark ${label} as skipped`);
    const item = h(
      'li',
      { class: `dose dose-${dose.status}` },
      h('p', { class: 'dose-time' }, clock12(dose.time)),
      h(
        'div',
        { class: 'dose-main' },
        h('p', { class: 'dose-name' }, dose.name, ' ', h('span', { class: 'dose-dosage' }, dose.dosage)),
        dose.instructions ? h('p', { class: 'muted' }, dose.instructions) : null,
        h(
          'p',
          { class: 'dose-status' },
          statusBadge(dose.status),
          dose.loggedBy ? h('span', { class: 'muted' }, ` by ${dose.loggedBy}${dose.loggedAt ? ` at ${formatTime(dose.loggedAt, tz)}` : ''}`) : null,
        ),
      ),
      h('div', { class: 'dose-actions' }, takeBtn, skipBtn),
    );
    takeBtn.addEventListener('click', () => run(takeBtn, async () => {
      await api.logDose(dose.key, 'taken');
      if (dose.status !== 'taken' && !prefersReducedMotion()) {
        item.classList.add('dose-celebrate');
        await wait(650);
      }
      await ctx.refresh();
    }, `${dose.name} marked as taken`));
    skipBtn.addEventListener('click', () => run(skipBtn, async () => {
      await api.logDose(dose.key, 'skipped');
      await ctx.refresh();
    }, `${dose.name} marked as skipped`));
    return item;
  });

  const next = data.appointments.find((a) => Date.parse(a.startsAt) > Date.now());

  return h(
    'div',
    { class: 'view' },
    viewHeading(
      `${greeting(tz)}, ${elder.name}`,
      isElder ? "Here is your day. You're in charge — tap Taken when you've had a medicine." : `You're viewing ${elder.name}'s day as ${me.name}.`,
    ),
    isElder ? decisionsCard(data, ctx) : null,
    !isElder && settings.requireApproval ? h('p', { class: 'banner' }, icon('shield'), `Changes you make to medicines go to ${elder.name} for approval.`) : null,
    h(
      'div',
      { class: 'today-grid' },
      progressCard(data),
      pulseCard(pulse),
      h(
        'section',
        { class: 'card appt-next', 'aria-labelledby': 'next-appt-title' },
        h('h2', { id: 'next-appt-title' }, 'Next appointment'),
        next ? appointmentSummary(next, tz) : h('p', { class: 'muted' }, 'No upcoming appointments.'),
        h('button', { type: 'button', class: 'btn btn-link', onclick: () => ctx.go('appointments') }, 'See all appointments', icon('arrow')),
      ),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'today-title' },
      h('h2', { id: 'today-title' }, "Today's medicines"),
      doseItems.length ? h('ol', { class: 'dose-list' }, doseItems) : h('p', { class: 'muted' }, 'No medicines scheduled today.'),
    ),
  );
}

function medicationForm(data, ctx, initial = {}, id = null) {
  const form = h('form', { class: 'stack', novalidate: true });
  const name = h('input', { name: 'name', required: true, maxlength: 80, value: initial.name ?? '' });
  const dosage = h('input', { name: 'dosage', maxlength: 40, value: initial.dosage ?? '', placeholder: 'e.g. 500 mg tablet' });
  const instructions = h('input', { name: 'instructions', maxlength: 200, value: initial.instructions ?? '', placeholder: 'e.g. after breakfast' });
  const perDose = h('input', { name: 'perDose', type: 'number', min: '0.5', max: '10', step: '0.5', required: true, value: String(initial.perDose ?? 1) });
  const stock = h('input', { name: 'stock', type: 'number', min: '0', max: '10000', step: '1', value: initial.stock ?? '' });

  const timesList = h('ul', { class: 'times-list' });
  const addTimeRow = (value = '') => {
    const input = h('input', { type: 'time', required: true, value, id: nextId('time') });
    const row = h(
      'li',
      { class: 'time-row' },
      h('label', { for: input.id, class: 'visually-hidden' }, 'Dose time'),
      input,
      h('button', {
        type: 'button',
        class: 'btn btn-ghost',
        'aria-label': 'Remove this time',
        onclick: () => {
          if (timesList.children.length > 1) row.remove();
        },
      }, 'Remove'),
    );
    timesList.append(row);
    return input;
  };
  for (const time of initial.times?.length ? initial.times : ['08:00']) addTimeRow(time);

  const days = new Set(initial.days ?? []);
  const dayBoxes = WEEKDAYS.map((label, index) => {
    const box = h('input', { type: 'checkbox', value: String(index), checked: days.has(index), id: nextId('day') });
    return h('label', { class: 'day-check', for: box.id }, box, label);
  });

  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, id ? 'Save changes' : 'Add medicine');
  form.append(
    field({ label: 'Medicine name', input: name }),
    h('div', { class: 'grid-2' }, field({ label: 'Strength / form', input: dosage }), field({ label: 'Instructions', input: instructions })),
    h(
      'fieldset',
      { class: 'fieldset' },
      h('legend', {}, 'Times each day'),
      timesList,
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => addTimeRow().focus() }, icon('plus'), 'Add a time'),
    ),
    h('fieldset', { class: 'fieldset' }, h('legend', {}, 'Days (leave all unticked for every day)'), h('div', { class: 'days' }, dayBoxes)),
    h('div', { class: 'grid-2' }, field({ label: 'Units per dose', input: perDose }), field({ label: 'Units in stock (optional)', input: stock, hint: 'Used to warn before it runs out.' })),
    submit,
  );
  const errors = formError(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errors.hide();
    if (!validateForm(form)) return;
    const times = [...new Set([...timesList.querySelectorAll('input')].map((i) => i.value).filter(Boolean))].sort();
    const payload = {
      name: name.value.trim(),
      dosage: dosage.value.trim(),
      instructions: instructions.value.trim(),
      times,
      days: dayBoxes.map((l) => l.querySelector('input')).filter((b) => b.checked).map((b) => Number(b.value)),
      perDose: Number(perDose.value),
      stock: stock.value === '' ? null : Number(stock.value),
    };
    try {
      await busy(submit, async () => {
        const result = id ? await api.updateMedication(id, payload) : await api.addMedication(payload);
        form.closest('dialog')?.close();
        toast(result?.pendingApproval ? `Sent to ${data.elder.name} for approval` : id ? 'Medicine updated' : 'Medicine added');
        await ctx.refresh();
      });
    } catch (error) {
      errors.show(error.message);
    }
  });
  return form;
}

function openMedicationDialog(data, ctx, initial, id) {
  openDialog({ title: id ? `Edit ${initial.name}` : 'Add a medicine', content: medicationForm(data, ctx, initial, id) });
}

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

function aiPanel(data, ctx) {
  const textId = nextId('ai-text');
  const text = h('textarea', { id: textId, rows: 3, maxlength: 500, placeholder: 'e.g. Amlodipine 5 mg once every morning after breakfast, 30 tablets left' });
  const fillBtn = h('button', { type: 'button', class: 'btn btn-primary' }, icon('sparkles'), 'Fill the form with Gemini');
  fillBtn.addEventListener('click', async () => {
    if (!text.value.trim()) {
      text.focus();
      toast('Describe the medicine first');
      return;
    }
    try {
      await busy(fillBtn, async () => {
        const { medication } = await api.aiMedication(text.value.trim());
        openMedicationDialog(data, ctx, medication, null);
      });
    } catch (error) {
      toast(error.message);
    }
  });

  const results = h('div', { class: 'scan-results', 'aria-live': 'polite' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', id: nextId('scan') });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast('Please choose a photo under 4 MB');
      fileInput.value = '';
      return;
    }
    results.replaceChildren(h('p', { class: 'muted' }, 'Reading the prescription with Gemini…'));
    results.setAttribute('aria-busy', 'true');
    try {
      const image = await readFileBase64(file);
      const scan = await api.aiScan(image, file.type || 'image/jpeg');
      results.replaceChildren(
        h('h3', {}, scan.medications.length ? `Found ${scan.medications.length} medicine(s)` : 'No medicines found'),
        scan.doctor ? h('p', {}, 'Prescribed by ', scan.doctor) : null,
        scan.notes ? h('p', { class: 'notice' }, h('strong', {}, 'Please double-check: '), scan.notes) : null,
        h(
          'ul',
          { class: 'scan-list' },
          scan.medications.map((med) =>
            h(
              'li',
              { class: 'scan-item' },
              h('div', {}, h('p', { class: 'dose-name' }, med.name, ' ', h('span', { class: 'dose-dosage' }, med.dosage)), h('p', { class: 'muted' }, med.times.map(clock12).join(', ') || 'Time not stated', ' · ', describeDays(med.days))),
              h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openMedicationDialog(data, ctx, med, null) }, `Review & add ${med.name}`),
            ),
          ),
        ),
      );
    } catch (error) {
      results.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, error.message));
    } finally {
      results.removeAttribute('aria-busy');
      fileInput.value = '';
    }
  });

  return h(
    'section',
    { class: 'card ai-card', 'aria-labelledby': 'ai-title' },
    h('h2', { id: 'ai-title' }, 'Add with AI'),
    h('p', { class: 'muted' }, 'Gemini fills in the form for you to check. Nothing is saved until you confirm.'),
    h('div', { class: 'grid-2' },
      h('div', { class: 'stack' }, h('label', { for: textId }, 'Describe it in your own words'), text, fillBtn),
      h('div', { class: 'stack' }, h('label', { for: fileInput.id }, 'Scan a prescription or medicine strip'), fileInput, h('p', { class: 'hint' }, 'Photos stay private and are not stored.'), results),
    ),
  );
}

function medicationCard(med, data, ctx) {
  const { me, elder } = data;
  const chips = [];
  if (med.status === 'pending') chips.push(h('span', { class: 'chip chip-warn' }, `Pending approval${med.createdByName ? ` · added by ${med.createdByName}` : ''}`));
  if (med.proposal) {
    chips.push(h('span', { class: 'chip chip-warn' }, `${med.proposal.type === 'remove' ? 'Removal' : 'Change'} proposed by ${med.proposal.byName}`));
  }
  if (med.refill?.low) chips.push(h('span', { class: 'chip chip-danger' }, icon('alert'), `Refill soon · ${med.refill.daysLeft} day(s) left`));

  const actions = [];
  if ((med.status === 'pending' || med.proposal) && me.can.approve) actions.push(...decisionButtons(med, ctx));
  const edit = h('button', { type: 'button', class: 'btn btn-secondary', 'aria-label': `Edit ${med.name}`, onclick: () => openMedicationDialog(data, ctx, med, med.id) }, icon('edit'), 'Edit');
  const remove = h('button', { type: 'button', class: 'btn btn-ghost danger', 'aria-label': `Remove ${med.name}` }, icon('trash'), 'Remove');
  remove.addEventListener('click', () => {
    if (!window.confirm(`Remove ${med.name}?`)) return;
    run(remove, async () => {
      const result = await api.removeMedication(med.id);
      toast(result?.pendingApproval ? `Removal sent to ${elder.name} for approval` : `${med.name} removed`);
      await ctx.refresh();
    });
  });
  actions.push(edit, remove);

  return h(
    'li',
    { class: 'card med-card' },
    h('div', { class: 'med-head' }, h('h3', {}, med.name, ' ', h('span', { class: 'dose-dosage' }, med.dosage)), chips.length ? h('div', { class: 'chips' }, chips) : null),
    h('ul', { class: 'chips', 'aria-label': 'Dose times' }, med.times.map((t) => h('li', { class: 'chip chip-time' }, clock12(t)))),
    h('p', {}, describeDays(med.days), med.perDose && med.perDose !== 1 ? ` · ${med.perDose} per dose` : ''),
    med.instructions ? h('p', { class: 'muted' }, med.instructions) : null,
    med.refill && !med.refill.low ? h('p', { class: 'muted' }, `${med.refill.stock} in stock · about ${med.refill.daysLeft} days left`) : null,
    h('div', { class: 'actions' }, actions),
  );
}

export function renderMedicines(data, ctx) {
  const { me, settings, elder, medications, features } = data;
  const addBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openMedicationDialog(data, ctx, {}, null) }, icon('plus'), 'Add medicine');
  const needsApproval = me.role !== 'elder' && settings.requireApproval;
  return h(
    'div',
    { class: 'view' },
    h('div', { class: 'section-head' }, viewHeading('Medicines', `${medications.length} on ${elder.name}'s list`), addBtn),
    needsApproval ? h('p', { class: 'banner' }, icon('shield'), `Changes you make go to ${elder.name} for approval.`) : null,
    features.ai ? aiPanel(data, ctx) : null,
    medications.length ? h('ul', { class: 'card-list' }, medications.map((m) => medicationCard(m, data, ctx))) : h('p', { class: 'card muted' }, 'No medicines yet. Add one to start the daily schedule.'),
  );
}

function toLocalInput(iso) {
  const date = iso ? new Date(iso) : new Date(Date.now() + 86_400_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function appointmentForm(ctx, initial = {}, id = null) {
  const form = h('form', { class: 'stack', novalidate: true });
  const doctor = h('input', { required: true, maxlength: 80, value: initial.doctor ?? '', placeholder: 'e.g. Dr. Mehta' });
  const specialty = h('input', { maxlength: 60, value: initial.specialty ?? '', placeholder: 'e.g. Cardiologist' });
  const location = h('input', { maxlength: 160, value: initial.location ?? '', placeholder: 'Clinic name and area' });
  const startsAt = h('input', { type: 'datetime-local', required: true, value: toLocalInput(initial.startsAt) });
  const notes = h('textarea', { rows: 2, maxlength: 500 });
  notes.value = initial.notes ?? '';
  const questions = h('textarea', { rows: 3, maxlength: 1200 });
  questions.value = (initial.questions ?? []).join('\n');
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, id ? 'Save changes' : 'Add appointment');
  form.append(
    field({ label: 'Doctor', input: doctor }),
    h('div', { class: 'grid-2' }, field({ label: 'Speciality', input: specialty }), field({ label: 'Date and time', input: startsAt })),
    field({ label: 'Location', input: location }),
    field({ label: 'Notes', input: notes }),
    field({ label: 'Questions to ask (one per line)', input: questions }),
    submit,
  );
  const errors = formError(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errors.hide();
    if (!validateForm(form)) return;
    const payload = {
      doctor: doctor.value.trim(),
      specialty: specialty.value.trim(),
      location: location.value.trim(),
      startsAt: new Date(startsAt.value).toISOString(),
      notes: notes.value.trim(),
      questions: questions.value.split('\n').map((q) => q.trim()).filter(Boolean),
    };
    try {
      await busy(submit, async () => {
        if (id) await api.updateAppointment(id, payload);
        else await api.addAppointment(payload);
        form.closest('dialog')?.close();
        toast(id ? 'Appointment updated' : 'Appointment added');
        await ctx.refresh();
      });
    } catch (error) {
      errors.show(error.message);
    }
  });
  return form;
}

function calendarLink(appointment, elderName) {
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

function appointmentCard(appointment, data, ctx, past) {
  const tz = data.elder.timezone;
  const edit = h('button', { type: 'button', class: 'btn btn-secondary', 'aria-label': `Edit appointment with ${appointment.doctor}` }, 'Edit');
  edit.addEventListener('click', () => openDialog({ title: 'Edit appointment', content: appointmentForm(ctx, appointment, appointment.id) }));
  const remove = h('button', { type: 'button', class: 'btn btn-ghost danger', 'aria-label': `Delete appointment with ${appointment.doctor}` }, 'Delete');
  remove.addEventListener('click', () => {
    if (!window.confirm(`Delete the appointment with ${appointment.doctor}?`)) return;
    run(remove, async () => {
      await api.removeAppointment(appointment.id);
      await ctx.refresh();
    }, 'Appointment deleted');
  });
  const links = [];
  if (appointment.location) {
    links.push(h('a', { class: 'btn btn-link', href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(appointment.location)}`, target: '_blank', rel: 'noopener noreferrer' }, icon('pin'), 'Open in Google Maps', h('span', { class: 'visually-hidden' }, ' (opens in a new tab)')));
  }
  if (!past) {
    links.push(h('a', { class: 'btn btn-link', href: calendarLink(appointment, data.elder.name), target: '_blank', rel: 'noopener noreferrer' }, icon('calendar'), 'Add to Google Calendar', h('span', { class: 'visually-hidden' }, ' (opens in a new tab)')));
  }
  return h(
    'li',
    { class: `card appt-card${past ? ' appt-past' : ''}` },
    h('h3', {}, appointment.doctor, appointment.specialty ? h('span', { class: 'muted' }, ` · ${appointment.specialty}`) : null),
    h('p', { class: 'appt-when' }, icon('calendar'), formatDateTime(appointment.startsAt, tz)),
    appointment.location ? h('p', {}, appointment.location) : null,
    appointment.notes ? h('p', { class: 'muted' }, appointment.notes) : null,
    appointment.questions?.length ? h('div', {}, h('h4', {}, 'Questions to ask'), h('ul', { class: 'bullets' }, appointment.questions.map((q) => h('li', {}, q)))) : null,
    links.length ? h('div', { class: 'actions' }, links) : null,
    h('div', { class: 'actions' }, edit, remove),
  );
}

export function renderAppointments(data, ctx) {
  const now = Date.now();
  const upcoming = data.appointments.filter((a) => Date.parse(a.startsAt) >= now);
  const past = data.appointments.filter((a) => Date.parse(a.startsAt) < now).reverse();
  const addBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openDialog({ title: 'Add an appointment', content: appointmentForm(ctx) }) }, icon('plus'), 'Add appointment');
  return h(
    'div',
    { class: 'view' },
    h('div', { class: 'section-head' }, viewHeading('Appointments', `Times shown in ${data.elder.timezone.replace(/_/g, ' ')}. Everyone in the circle gets a reminder a day before and two hours before.`), addBtn),
    h(
      'section',
      { 'aria-labelledby': 'upcoming-title' },
      h('h2', { id: 'upcoming-title' }, 'Upcoming'),
      upcoming.length ? h('ul', { class: 'card-list' }, upcoming.map((a) => appointmentCard(a, data, ctx, false))) : h('p', { class: 'card muted' }, 'No upcoming appointments.'),
    ),
    past.length
      ? h('section', { 'aria-labelledby': 'past-title' }, h('h2', { id: 'past-title' }, 'Past'), h('ul', { class: 'card-list' }, past.slice(0, 10).map((a) => appointmentCard(a, data, ctx, true))))
      : null,
  );
}
