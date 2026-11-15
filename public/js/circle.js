import { api } from './api.js';
import { run, viewHeading } from './care.js';
import { icon } from './icons.js';
import { busy, describeDays, clock12, field, formError, formatDate, formatDateTime, h, nextId, openDialog, toast, validateForm } from './dom.js';

const ROLE_LABEL = { elder: 'Elder', caretaker: 'Caretaker', family: 'Family' };
const KIND_LABEL = {
  'dose-upcoming': 'Dose reminder',
  'dose-missed': 'Missed dose',
  'dose-escalation': 'Check-in request',
  'appointment-tomorrow': 'Appointment tomorrow',
  'appointment-soon': 'Appointment soon',
  'refill-low': 'Refill reminder',
  test: 'Test email',
};

function rateText(rate) {
  return rate === null || rate === undefined ? 'No doses yet' : `${rate}%`;
}

function bar(rate, label) {
  const fill = h('span', { class: 'bar-fill' });
  fill.style.width = `${rate ?? 0}%`;
  return h('span', { class: `bar ${rate !== null && rate < 60 ? 'bar-low' : rate !== null && rate < 85 ? 'bar-mid' : ''}`, role: 'img', 'aria-label': label }, fill);
}

function briefPanel() {
  const langId = nextId('lang');
  const language = h('select', { id: langId }, h('option', { value: 'en' }, 'English'), h('option', { value: 'hi', lang: 'hi' }, 'हिन्दी (Hindi)'));
  const output = h('div', { class: 'brief-output', 'aria-live': 'polite' });
  const button = h('button', { type: 'button', class: 'btn btn-primary' }, icon('sparkles'), 'Write this week’s brief');
  button.addEventListener('click', async () => {
    output.setAttribute('aria-busy', 'true');
    output.replaceChildren(h('p', { class: 'muted' }, 'Gemini is reading this week’s care record…'));
    try {
      const brief = await busy(button, () => api.aiBrief(language.value));
      const lang = language.value;
      const list = (title, items) => (items?.length ? h('div', {}, h('h4', {}, title), h('ul', { class: 'bullets' }, items.map((i) => h('li', {}, i)))) : null);
      output.replaceChildren(
        h(
          'article',
          { class: 'brief', lang },
          h('h3', {}, brief.headline),
          h('p', {}, brief.summary),
          list(lang === 'hi' ? 'अच्छी बातें' : 'Wins', brief.wins),
          list(lang === 'hi' ? 'ध्यान देने योग्य' : 'Worth a look', brief.concerns),
          list(lang === 'hi' ? 'डॉक्टर से पूछें' : 'Questions for the doctor', brief.doctorQuestions),
        ),
      );
    } catch (error) {
      output.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, error.message));
    } finally {
      output.removeAttribute('aria-busy');
    }
  });
  return h(
    'section',
    { class: 'card ai-card', 'aria-labelledby': 'brief-title' },
    h('h2', { id: 'brief-title' }, 'Weekly care brief by Gemini'),
    h('p', { class: 'muted' }, 'A warm summary for the whole circle, written from the real dose record, with questions to take to the next appointment.'),
    h('div', { class: 'inline-form' }, h('label', { for: langId }, 'Language'), language, button),
    output,
    h('p', { class: 'hint' }, 'Saathi never gives medical advice. Always confirm medicine changes with a doctor or pharmacist.'),
  );
}

export function renderInsights(data) {
  const { adherence, pulse, features } = data;
  const chart = h(
    'ol',
    { class: 'chart', 'aria-hidden': 'true' },
    adherence.daily.map((day, index) => {
      const col = h('span', { class: 'chart-fill' });
      col.style.height = `${Math.max(day.rate ?? 0, day.total ? 4 : 0)}%`;
      const isToday = index === adherence.daily.length - 1;
      const tone = day.rate !== null && day.rate < 60 ? 'bar-low' : day.rate !== null && day.rate < 85 ? 'bar-mid' : '';
      return h(
        'li',
        { class: `chart-col ${tone} ${isToday ? 'chart-today' : ''}`.trim() },
        h('span', { class: 'chart-value' }, day.rate === null ? '—' : `${day.rate}%`),
        h('span', { class: 'chart-track' }, col),
        h('span', { class: 'chart-count' }, day.total ? `${day.taken}/${day.total}` : ''),
        h('span', { class: 'chart-label' }, isToday ? 'Today' : formatDate(day.date).split(',')[0]),
      );
    }),
  );
  const table = h(
    'table',
    { class: 'data-table' },
    h('caption', {}, 'Doses taken each day, last 7 days'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Day'), h('th', { scope: 'col' }, 'Taken'), h('th', { scope: 'col' }, 'Rate'))),
    h('tbody', {}, adherence.daily.map((day) => h('tr', {}, h('th', { scope: 'row' }, formatDate(day.date)), h('td', {}, `${day.taken} of ${day.total}`), h('td', {}, rateText(day.rate))))),
  );

  return h(
    'div',
    { class: 'view' },
    viewHeading('Insights', 'How the week went, from the real dose record.'),
    h(
      'dl',
      { class: 'stat-cards' },
      h('div', { class: 'card stat' }, h('dt', {}, 'Taken this week'), h('dd', {}, rateText(adherence.rate))),
      h('div', { class: 'card stat' }, h('dt', {}, 'Doses logged'), h('dd', {}, `${adherence.taken} / ${adherence.total}`)),
      h('div', { class: 'card stat' }, h('dt', {}, 'Streak'), h('dd', {}, `${pulse.streak} ${pulse.streak === 1 ? 'day' : 'days'}`)),
    ),
    h('section', { class: 'card', 'aria-labelledby': 'week-title' }, h('h2', { id: 'week-title' }, 'Last 7 days'), chart, h('details', { class: 'table-details' }, h('summary', {}, 'Show as a table'), table)),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'per-med-title' },
      h('h2', { id: 'per-med-title' }, 'By medicine'),
      adherence.medications.length
        ? h('ul', { class: 'med-rates' }, adherence.medications.map((m) => h('li', {}, h('span', { class: 'med-rate-name' }, m.name), bar(m.rate, `${m.name}: ${m.taken} of ${m.total} doses taken`), h('span', { class: 'med-rate-value' }, `${rateText(m.rate)} (${m.taken}/${m.total})`))))
        : h('p', { class: 'muted' }, 'No doses recorded yet.'),
    ),
    features.ai ? briefPanel() : null,
  );
}

function listInput(values) {
  return h('input', { maxlength: 400, value: (values ?? []).join(', ') });
}

const splitList = (value) => value.split(',').map((v) => v.trim()).filter(Boolean);

function profileForm(data, ctx) {
  const { elder } = data;
  const form = h('form', { class: 'stack', novalidate: true });
  const name = h('input', { required: true, maxlength: 80, value: elder.name, autocomplete: 'off' });
  const email = h('input', { type: 'email', required: true, maxlength: 120, value: elder.email ?? '', autocomplete: 'off' });
  const conditions = listInput(elder.conditions);
  const allergies = listInput(elder.allergies);
  const contactName = h('input', { maxlength: 80, value: elder.emergencyContact?.name ?? '' });
  const contactPhone = h('input', { type: 'tel', maxlength: 30, value: elder.emergencyContact?.phone ?? '', autocomplete: 'off' });
  const notes = h('textarea', { rows: 3, maxlength: 1000 });
  notes.value = elder.notes ?? '';
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save profile');
  form.append(
    h('div', { class: 'grid-2' }, field({ label: 'Name', input: name }), field({ label: 'Email', input: email })),
    field({ label: 'Health conditions', input: conditions, hint: 'Separate with commas.' }),
    field({ label: 'Allergies', input: allergies, hint: 'Separate with commas.' }),
    h('div', { class: 'grid-2' }, field({ label: 'Emergency contact name', input: contactName }), field({ label: 'Emergency contact phone', input: contactPhone })),
    field({ label: 'Notes for the circle', input: notes }),
    submit,
  );
  const errors = formError(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errors.hide();
    if (!validateForm(form)) return;
    const contact = contactName.value.trim() || contactPhone.value.trim() ? { name: contactName.value.trim(), phone: contactPhone.value.trim() } : null;
    try {
      await busy(submit, async () => {
        await api.updateProfile({
          name: name.value.trim(),
          email: email.value.trim(),
          conditions: splitList(conditions.value),
          allergies: splitList(allergies.value),
          emergencyContact: contact,
          notes: notes.value.trim(),
        });
        form.closest('dialog')?.close();
        toast('Profile saved');
        await ctx.refresh();
      });
    } catch (error) {
      errors.show(error.message);
    }
  });
  return form;
}

function showPasscode(data, member, passcode) {
  const copy = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Copy sign-in details');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`Join ${data.elder.name}'s Saathi care circle\nCircle code: ${data.code}\nYour passcode: ${passcode}\n${location.origin}`);
      toast('Copied');
    } catch {
      toast('Copy is not available. Please write the passcode down.');
    }
  });
  openDialog({
    title: `${member.name} is invited`,
    content: h(
      'div',
      { class: 'stack' },
      h('p', {}, `Share these with ${member.name}. The passcode is shown only once.`),
      h('dl', { class: 'credentials' }, h('div', {}, h('dt', {}, 'Circle code'), h('dd', {}, h('code', {}, data.code))), h('div', {}, h('dt', {}, 'Passcode'), h('dd', {}, h('code', { class: 'big-code' }, passcode)))),
      copy,
    ),
  });
}

function inviteForm(data, ctx) {
  const form = h('form', { class: 'stack', novalidate: true, 'aria-labelledby': 'invite-title' });
  const name = h('input', { required: true, maxlength: 80, autocomplete: 'off' });
  const email = h('input', { type: 'email', required: true, maxlength: 120, autocomplete: 'off' });
  const role = h('select', {}, h('option', { value: 'family' }, 'Family member'), h('option', { value: 'caretaker' }, 'Caretaker'));
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Create invite');
  form.append(
    h('h3', { id: 'invite-title' }, 'Invite someone'),
    h('div', { class: 'grid-3' }, field({ label: 'Name', input: name }), field({ label: 'Email', input: email }), field({ label: 'Role', input: role })),
    h('p', { class: 'hint' }, 'Caretakers can manage the circle day to day. Family can follow along, log doses and suggest changes.'),
    submit,
  );
  const errors = formError(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errors.hide();
    if (!validateForm(form)) return;
    try {
      await busy(submit, async () => {
        const result = await api.addMember({ name: name.value.trim(), email: email.value.trim(), role: role.value });
        form.reset();
        await ctx.refresh();
        showPasscode(data, result.member, result.passcode);
      });
    } catch (error) {
      errors.show(error.message);
    }
  });
  return form;
}

function settingsForm(data, ctx) {
  const { settings } = data;
  const form = h('form', { class: 'stack', novalidate: true });
  const approvalId = nextId('approval');
  const approval = h('input', { type: 'checkbox', id: approvalId, checked: settings.requireApproval });
  const grace = h('input', { type: 'number', min: '5', max: '240', step: '5', required: true, value: String(settings.graceMinutes) });
  const escalate = h('input', { type: 'number', min: '1', max: '10', step: '1', required: true, value: String(settings.escalateAfterMisses) });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save settings');
  form.append(
    h('label', { class: 'check-row', for: approvalId }, approval, h('span', {}, 'Medicine changes by others need my approval')),
    h(
      'div',
      { class: 'grid-2' },
      field({ label: 'Minutes before a dose counts as missed', input: grace }),
      field({ label: 'Tell the whole family after this many misses in a row', input: escalate }),
    ),
    submit,
  );
  const errors = formError(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errors.hide();
    if (!validateForm(form)) return;
    try {
      await busy(submit, async () => {
        await api.updateSettings({ requireApproval: approval.checked, graceMinutes: Number(grace.value), escalateAfterMisses: Number(escalate.value) });
        toast('Settings saved');
        await ctx.refresh();
      });
    } catch (error) {
      errors.show(error.message);
    }
  });
  return form;
}

function printCard(data) {
  const { elder, medications, code } = data;
  const active = medications.filter((m) => m.status === 'active');
  const row = (label, value) => h('div', {}, h('dt', {}, label), h('dd', {}, value || 'None recorded'));
  const root = document.getElementById('print-root');
  root.replaceChildren(
    h(
      'article',
      { class: 'emergency-card' },
      h('h1', {}, 'Emergency health card'),
      h('p', { class: 'ec-name' }, elder.name),
      h(
        'dl',
        {},
        row('Conditions', elder.conditions?.join(', ')),
        row('Allergies', elder.allergies?.join(', ')),
        row('Emergency contact', elder.emergencyContact ? `${elder.emergencyContact.name} · ${elder.emergencyContact.phone}` : ''),
        row('Saathi circle', code),
      ),
      h('h2', {}, 'Current medicines'),
      active.length
        ? h('ul', {}, active.map((m) => h('li', {}, `${m.name} ${m.dosage} — ${m.times.map(clock12).join(', ')} (${describeDays(m.days)})${m.instructions ? `, ${m.instructions}` : ''}`)))
        : h('p', {}, 'None recorded'),
      h('p', { class: 'ec-foot' }, `Printed ${new Date().toLocaleDateString('en-IN')} from Saathi.`),
    ),
  );
  window.print();
}

export function renderCircle(data, ctx) {
  const { elder, members, me } = data;
  const can = me.can;

  const memberItems = members.map((member) => {
    const remove =
      can.removeMembers && member.id !== me.id && member.role !== 'elder'
        ? h('button', { type: 'button', class: 'btn btn-ghost danger', 'aria-label': `Remove ${member.name} from the circle` }, 'Remove')
        : null;
    remove?.addEventListener('click', () => {
      if (!window.confirm(`Remove ${member.name}? Their passcode will stop working.`)) return;
      run(remove, async () => {
        await api.removeMember(member.id);
        await ctx.refresh();
      }, `${member.name} removed`);
    });
    return h(
      'li',
      { class: 'member' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, member.name.slice(0, 1).toUpperCase()),
      h(
        'div',
        { class: 'member-main' },
        h('p', { class: 'member-name' }, member.name, member.id === me.id ? ' (you)' : '', ' ', h('span', { class: `chip chip-${member.role}` }, ROLE_LABEL[member.role] ?? member.role)),
        h('p', { class: 'muted' }, member.email || 'No email', ' · ', member.notify === false ? 'Reminders off' : 'Reminders on'),
      ),
      remove,
    );
  });

  const notifyId = nextId('notify');
  const notify = h('input', { type: 'checkbox', id: notifyId, checked: me.notify !== false });
  notify.addEventListener('change', async () => {
    try {
      await api.updateMe({ notify: notify.checked });
      toast(notify.checked ? 'Email reminders on' : 'Email reminders off');
      await ctx.refresh();
    } catch (error) {
      notify.checked = !notify.checked;
      toast(error.message);
    }
  });
  const testBtn = h('button', { type: 'button', class: 'btn btn-secondary' }, icon('mail'), 'Send me a test email');
  testBtn.addEventListener('click', async () => {
    try {
      const result = await busy(testBtn, () => api.testEmail());
      toast(result.delivered ? `Test email sent to ${result.recipients.join(', ')}` : 'Email delivery is not set up, so the test was logged in Activity instead.');
      await ctx.refresh();
    } catch (error) {
      toast(error.message);
    }
  });

  const editProfile = can.editProfile
    ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openDialog({ title: `Edit ${elder.name}'s profile`, content: profileForm(data, ctx) }) }, 'Edit profile')
    : null;
  const detail = (label, value) => h('div', {}, h('dt', {}, label), h('dd', {}, value || 'Not added'));

  return h(
    'div',
    { class: 'view' },
    viewHeading('Care circle', `Circle code ${data.code}. Everyone signs in with their own passcode, and the elder can remove anyone at any time.`),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'profile-title' },
      h('div', { class: 'section-head' }, h('h2', { id: 'profile-title' }, `${elder.name}'s profile`), h('div', { class: 'actions' }, editProfile, h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => printCard(data) }, icon('printer'), 'Print emergency card'))),
      h(
        'dl',
        { class: 'details' },
        detail('Conditions', elder.conditions?.join(', ')),
        detail('Allergies', elder.allergies?.join(', ')),
        detail('Emergency contact', elder.emergencyContact ? `${elder.emergencyContact.name} · ${elder.emergencyContact.phone}` : ''),
        detail('Time zone', elder.timezone.replace(/_/g, ' ')),
        detail('Notes', elder.notes),
      ),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'members-title' },
      h('h2', { id: 'members-title' }, 'Members'),
      h('ul', { class: 'members' }, memberItems),
      can.manageMembers ? inviteForm(data, ctx) : null,
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'my-reminders-title' },
      h('h2', { id: 'my-reminders-title' }, 'My reminders'),
      h('label', { class: 'check-row', for: notifyId }, notify, h('span', {}, `Email me reminders at ${me.email || 'my address'}`)),
      testBtn,
    ),
    can.editSettings
      ? h('section', { class: 'card', 'aria-labelledby': 'settings-title' }, h('h2', { id: 'settings-title' }, 'Reminder and approval settings'), settingsForm(data, ctx))
      : null,
  );
}

export function renderActivity(data) {
  const tz = data.elder.timezone;
  return h(
    'div',
    { class: 'view' },
    viewHeading('Activity', 'A clear record of who did what, so the elder always knows what changed.'),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'audit-title' },
      h('h2', { id: 'audit-title' }, 'Changes and logs'),
      data.activity.length
        ? h(
            'ol',
            { class: 'timeline' },
            data.activity.map((item) =>
              h('li', {}, h('p', { class: 'muted' }, formatDateTime(item.at, tz)), h('p', {}, h('strong', {}, item.by), ` ${item.action}`, item.detail ? ` — ${item.detail}` : '')),
            ),
          )
        : h('p', { class: 'muted' }, 'Nothing yet.'),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'outbox-title' },
      h('h2', { id: 'outbox-title' }, 'Notification log'),
      h('p', { class: 'muted' }, `Every reminder Saathi sends is listed here.${data.features.email ? '' : ' Email delivery is not set up, so reminders are logged only.'}`),
      data.outbox.length
        ? h(
            'div',
            { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-labelledby': 'outbox-title' },
            h(
              'table',
              { class: 'data-table' },
              h('thead', {}, h('tr', {}, ['When', 'Type', 'Subject', 'Sent to', 'Status'].map((c) => h('th', { scope: 'col' }, c)))),
              h(
                'tbody',
                {},
                data.outbox.map((mail) =>
                  h(
                    'tr',
                    {},
                    h('td', {}, formatDateTime(mail.at, tz)),
                    h('td', {}, KIND_LABEL[mail.kind] ?? mail.kind),
                    h('td', {}, mail.subject),
                    h('td', {}, mail.to?.length ? mail.to.join(', ') : '—'),
                    h('td', {}, mail.delivered ? h('span', { class: 'badge badge-taken' }, icon('check'), 'Emailed') : h('span', { class: 'badge badge-upcoming' }, icon('circle'), 'Logged')),
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'No reminders sent yet.'),
    ),
  );
}
