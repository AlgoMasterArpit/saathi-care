import { api, session } from './api.js';
import { busy, field, formError, h, prefersReducedMotion, ring, toast, validateForm } from './dom.js';
import { icon } from './icons.js';

const DEMO = {
  code: 'SA-DEMO42',
  people: [
    { name: 'Kamla Devi', role: 'Elder', passcode: '246810' },
    { name: 'Ravi', role: 'Caretaker', passcode: '135790' },
    { name: 'Priya', role: 'Daughter', passcode: '112233' },
  ],
};

const COMMON_ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];

function timezoneSelect() {
  let local = 'Asia/Kolkata';
  try {
    local = Intl.DateTimeFormat().resolvedOptions().timeZone || local;
  } catch {
    local = 'Asia/Kolkata';
  }
  const zones = [...new Set([local, ...COMMON_ZONES])];
  return h('select', { name: 'timezone', required: true }, zones.map((zone) => h('option', { value: zone, selected: zone === local }, zone.replace(/_/g, ' '))));
}

export function renderWelcome(container, onSignedIn) {
  const signIn = async (code, passcode) => {
    const result = await api.signIn(code, passcode);
    session.set(result.token);
    toast(`Welcome, ${result.member.name}`);
    onSignedIn();
  };

  const createForm = h('form', { class: 'card form-card', novalidate: true, 'aria-labelledby': 'create-title' });
  const elderName = h('input', { name: 'name', autocomplete: 'name', required: true, maxlength: 80 });
  const elderEmail = h('input', { name: 'email', type: 'email', autocomplete: 'email', required: true, maxlength: 120 });
  const zone = timezoneSelect();
  const pass = h('input', { name: 'passcode', type: 'password', autocomplete: 'new-password', required: true, minlength: 6, maxlength: 64 });
  const confirmPass = h('input', { name: 'confirm', type: 'password', autocomplete: 'new-password', required: true, minlength: 6, maxlength: 64 });
  const createButton = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Create care circle');
  createForm.append(
    h('h2', { id: 'create-title' }, 'Start a care circle'),
    h('p', { class: 'muted' }, 'Set it up for yourself or with your parent. The elder owns the circle and approves changes.'),
    field({ label: "Elder's name", input: elderName }),
    field({ label: "Elder's email", input: elderEmail, hint: 'Gentle reminders are sent here.' }),
    field({ label: 'Time zone', input: zone }),
    field({ label: 'Elder passcode', input: pass, hint: 'At least 6 characters. Easy to remember, hard to guess.' }),
    field({ label: 'Confirm passcode', input: confirmPass }),
    createButton,
  );
  const createErrors = formError(createForm);
  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    createErrors.hide();
    confirmPass.setCustomValidity(confirmPass.value && confirmPass.value !== pass.value ? 'Passcodes do not match.' : '');
    if (!validateForm(createForm)) return;
    try {
      await busy(createButton, async () => {
        const result = await api.createCircle({
          elder: { name: elderName.value.trim(), email: elderEmail.value.trim(), timezone: zone.value },
          passcode: pass.value,
        });
        session.set(result.token);
        toast(`Circle ${result.circleCode} is ready. Share this code with family.`);
        onSignedIn();
      });
    } catch (error) {
      createErrors.show(error.message);
    }
  });

  const joinForm = h('form', { class: 'card form-card', novalidate: true, 'aria-labelledby': 'join-title' });
  const code = h('input', {
    name: 'circleCode',
    required: true,
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    pattern: '[Ss][Aa]-[A-Za-z0-9]{6}',
    placeholder: 'SA-XXXXXX',
    maxlength: 9,
  });
  const joinPass = h('input', { name: 'passcode', type: 'password', autocomplete: 'current-password', required: true, maxlength: 64 });
  const joinButton = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Join circle');
  joinForm.append(
    h('h2', { id: 'join-title' }, 'Join a circle'),
    h('p', { class: 'muted' }, 'Family and caretakers sign in with the circle code and their own passcode.'),
    field({ label: 'Circle code', input: code, hint: 'Looks like SA-7K2P9Q.' }),
    field({ label: 'Your passcode', input: joinPass }),
    joinButton,
  );
  const joinErrors = formError(joinForm);
  joinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    joinErrors.hide();
    if (!validateForm(joinForm)) return;
    try {
      await busy(joinButton, () => signIn(code.value.trim().toUpperCase(), joinPass.value));
    } catch (error) {
      joinErrors.show(error.message);
    }
  });

  const demoList = h(
    'ul',
    { class: 'demo-people' },
    DEMO.people.map((person) => {
      const button = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, `Sign in as ${person.name}`);
      button.addEventListener('click', async () => {
        try {
          await busy(button, () => signIn(DEMO.code, person.passcode));
        } catch (error) {
          toast(error.message);
        }
      });
      return h(
        'li',
        { class: 'demo-person' },
        h('div', { class: 'demo-who' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, person.name.slice(0, 1)), h('p', { class: 'demo-name' }, person.name, ' ', h('span', { class: 'chip' }, person.role))),
        h('p', { class: 'muted' }, 'Passcode ', h('code', {}, person.passcode)),
        button,
      );
    }),
  );

  const jump = (target) => {
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    target.querySelector('button, input')?.focus({ preventScroll: true });
  };
  const demoSection = h(
    'section',
    { class: 'card demo-card', 'aria-labelledby': 'demo-title' },
    h('div', { class: 'demo-head' }, h('h2', { id: 'demo-title' }, 'Try the live demo'), h('p', {}, 'Circle code ', h('code', {}, DEMO.code), ' — see the same circle through three different people.')),
    demoList,
  );
  const forms = h('div', { class: 'two-col' }, createForm, joinForm);

  const previewDose = (time, name, status, label) =>
    h('li', { class: `pv-dose pv-${status}` }, h('span', { class: 'pv-time' }, time), h('span', { class: 'pv-name' }, name), h('span', { class: `badge badge-${status}` }, icon(status === 'taken' ? 'check' : status === 'due' ? 'clock' : 'circle'), label));

  const preview = h(
    'div',
    { class: 'preview', role: 'img', 'aria-label': "Preview of Saathi's Today screen: 2 of 3 medicines taken, Care Pulse all steady" },
    h(
      'div',
      { class: 'preview-card', 'aria-hidden': 'true' },
      h('div', { class: 'pv-head' }, h('span', { class: 'avatar' }, 'K'), h('div', {}, h('p', { class: 'pv-hello' }, 'Good morning, Kamla'), h('p', { class: 'pv-sub' }, 'Thursday · 3 medicines today'))),
      h(
        'div',
        { class: 'pv-stats' },
        ring(67, { label: '', big: '2/3', small: 'taken', size: 92, stroke: 9 }),
        h('div', { class: 'pv-pulse' }, h('p', { class: 'pulse-level tone-ok' }, icon('leaf'), 'All steady'), h('p', { class: 'pv-sub' }, icon('heart'), '12 day streak')),
      ),
      h('ul', { class: 'pv-doses' }, previewDose('8:30 AM', 'Metformin 500 mg', 'taken', 'Taken'), previewDose('9:00 AM', 'Amlodipine 5 mg', 'taken', 'Taken'), previewDose('1:30 PM', 'Calcium + D3', 'due', 'Due now')),
    ),
    h('p', { class: 'pv-float pv-float-a', 'aria-hidden': 'true' }, icon('mail'), 'Priya was notified'),
    h('p', { class: 'pv-float pv-float-b', 'aria-hidden': 'true' }, icon('shield'), 'Kamla approved B12'),
  );

  const FEATURES = [
    ['pill', 'One-tap Today view', 'Big, clear dose cards. Tap Taken and the whole circle knows, instantly.'],
    ['mail', 'Kind escalation emails', 'A nudge before each dose, a note if one is missed, family looped in after repeated misses.'],
    ['camera', 'Scan with Gemini', 'Photograph a prescription or describe a medicine. You review before anything is saved.'],
    ['shield', 'Elder approves changes', 'Family and caretakers can propose. Only the elder says yes. Every action is logged.'],
  ];
  const TRUST = [
    ['lock', 'Passcode per person'],
    ['shield', 'Elder approves every change'],
    ['mail', 'Kind escalation emails'],
    ['sparkles', 'Gemini helps, never prescribes'],
  ];

  const heroDemoBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => jump(demoSection) }, 'Try the live demo', icon('arrow'));
  const heroStartBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-lg', onclick: () => jump(createForm) }, 'Start a care circle');

  container.replaceChildren(
    h(
      'section',
      { class: 'hero', 'aria-labelledby': 'hero-title' },
      h(
        'div',
        { class: 'hero-copy' },
        h('p', { class: 'eyebrow' }, 'Saathi · ', h('span', { lang: 'hi' }, 'साथी'), ' · companion'),
        h('h1', { id: 'hero-title', tabindex: '-1' }, 'Care that keeps the elder ', h('span', { class: 'accent' }, 'in charge')),
        h(
          'p',
          { class: 'lead' },
          'One shared circle for medicines, doctor visits and daily routines. Gentle email reminders, family kept in the loop, and nothing changes without the elder saying yes.',
        ),
        h('div', { class: 'hero-cta' }, heroDemoBtn, heroStartBtn),
      ),
      preview,
    ),
    h('ul', { class: 'trust-strip', 'aria-label': 'Why families trust Saathi' }, TRUST.map(([name, text]) => h('li', {}, icon(name), text))),
    h(
      'section',
      { class: 'features', 'aria-labelledby': 'features-title' },
      h('h2', { id: 'features-title', class: 'visually-hidden' }, 'What Saathi does'),
      h('ul', { class: 'feature-grid' }, FEATURES.map(([name, title, text]) => h('li', { class: 'feature' }, h('span', { class: 'feature-icon' }, icon(name)), h('h3', {}, title), h('p', { class: 'muted' }, text)))),
    ),
    demoSection,
    forms,
  );
}
