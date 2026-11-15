import { api, session } from './api.js';
import { busy, field, formError, h, toast, validateForm } from './dom.js';

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
        h('p', { class: 'demo-name' }, person.name, ' ', h('span', { class: 'chip' }, person.role)),
        h('p', { class: 'muted' }, 'Passcode ', h('code', {}, person.passcode)),
        button,
      );
    }),
  );

  container.replaceChildren(
    h(
      'section',
      { class: 'hero', 'aria-labelledby': 'hero-title' },
      h('p', { class: 'eyebrow' }, 'Saathi · साथी · companion'),
      h('h1', { id: 'hero-title', tabindex: '-1' }, 'Care that keeps the elder in charge'),
      h(
        'p',
        { class: 'lead' },
        'One shared circle for medicines, doctor visits and daily routines. Gentle email reminders, family kept in the loop, and nothing changes without the elder saying yes.',
      ),
      h(
        'ul',
        { class: 'feature-list' },
        h('li', {}, h('span', { class: 'feature-icon', 'aria-hidden': 'true' }, '💊'), 'Today view with one-tap “Taken”'),
        h('li', {}, h('span', { class: 'feature-icon', 'aria-hidden': 'true' }, '✉️'), 'Email reminders that escalate kindly'),
        h('li', {}, h('span', { class: 'feature-icon', 'aria-hidden': 'true' }, '📷'), 'Scan a prescription with Gemini'),
        h('li', {}, h('span', { class: 'feature-icon', 'aria-hidden': 'true' }, '🛡️'), 'Elder approves every change'),
      ),
    ),
    h(
      'section',
      { class: 'card demo-card', 'aria-labelledby': 'demo-title' },
      h('h2', { id: 'demo-title' }, 'Try the live demo'),
      h('p', {}, 'Circle code ', h('code', {}, DEMO.code), '. See the same circle through three different people.'),
      demoList,
    ),
    h('div', { class: 'two-col' }, createForm, joinForm),
  );
}
