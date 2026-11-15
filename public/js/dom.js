const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'hidden', 'required', 'multiple', 'open']);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = value;
    } else if (PROPS.has(key)) {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

let uid = 0;
export const nextId = (prefix = 'f') => `${prefix}-${(uid += 1)}`;

export function field({ label, input, hint, wide = false }) {
  const id = input.id || nextId('field');
  input.id = id;
  const describedBy = [];
  let hintEl = null;
  if (hint) {
    hintEl = h('p', { class: 'hint', id: `${id}-hint` }, hint);
    describedBy.push(hintEl.id);
  }
  const errorEl = h('p', { class: 'field-error', id: `${id}-error`, hidden: true });
  if (describedBy.length) input.setAttribute('aria-describedby', describedBy.join(' '));
  return h('div', { class: wide ? 'field field-wide' : 'field' }, h('label', { for: id }, label), hintEl, input, errorEl);
}

export function setFieldError(input, message) {
  const errorEl = document.getElementById(`${input.id}-error`);
  const ids = (input.getAttribute('aria-describedby') ?? '').split(' ').filter((x) => x && x !== `${input.id}-error`);
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    ids.push(`${input.id}-error`);
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
  } else {
    input.removeAttribute('aria-invalid');
    if (errorEl) errorEl.hidden = true;
  }
  if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
  else input.removeAttribute('aria-describedby');
}

export function validateForm(form) {
  let first = null;
  for (const input of form.querySelectorAll('input, select, textarea')) {
    if (!input.id) continue;
    const valid = input.checkValidity();
    setFieldError(input, valid ? '' : input.validationMessage);
    if (!valid && !first) first = input;
  }
  if (first) first.focus();
  return !first;
}

export function formError(form) {
  let box = form.querySelector(':scope > .form-error');
  if (!box) {
    box = h('p', { class: 'form-error', role: 'alert', hidden: true });
    form.prepend(box);
  }
  return {
    show(message) {
      box.textContent = message;
      box.hidden = false;
    },
    hide() {
      box.hidden = true;
      box.textContent = '';
    },
  };
}

let toastTimer;
export function toast(message) {
  const region = document.getElementById('toast');
  region.textContent = '';
  clearTimeout(toastTimer);
  requestAnimationFrame(() => {
    region.textContent = message;
    region.classList.add('visible');
  });
  toastTimer = setTimeout(() => region.classList.remove('visible'), 5000);
}

export function openDialog({ title, content, onClose }) {
  const headingId = nextId('dialog-title');
  const dialog = h(
    'dialog',
    { class: 'dialog', 'aria-labelledby': headingId },
    h(
      'div',
      { class: 'dialog-head' },
      h('h2', { id: headingId }, title),
      h('button', { type: 'button', class: 'btn btn-ghost icon-btn', 'aria-label': 'Close', onclick: () => dialog.close() }, '✕'),
    ),
    h('div', { class: 'dialog-body' }, content),
  );
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  });
  document.body.append(dialog);
  dialog.showModal();
  const focusable = dialog.querySelector('.dialog-body input, .dialog-body select, .dialog-body textarea, .dialog-body button');
  focusable?.focus();
  return dialog;
}

export async function busy(button, task) {
  const label = button.textContent;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Please wait…';
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = label;
  }
}

export function formatTime(iso, timeZone) {
  return new Intl.DateTimeFormat('en-IN', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function formatDateTime(iso, timeZone) {
  return new Intl.DateTimeFormat('en-IN', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function formatDate(dateStr) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${dateStr}T00:00:00Z`));
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeDays(days) {
  if (!days?.length || days.length === 7) return 'Every day';
  return [...days].sort((a, b) => a - b).map((d) => WEEKDAYS[d]).join(', ');
}

export function clock12(time) {
  const [hours, minutes] = time.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

const PREFS_KEY = 'saathi.display';

export function loadPrefs() {
  try {
    return { size: 1, contrast: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { size: 1, contrast: false };
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    return;
  }
}
