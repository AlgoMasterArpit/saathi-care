import { api, handleUnauthorized, session } from './api.js';
import { renderAppointments, renderMedicines, renderToday } from './care.js';
import { renderActivity, renderCircle, renderInsights } from './circle.js';
import { clear, h, loadPrefs, savePrefs, toast } from './dom.js';
import { icon } from './icons.js';
import { renderWelcome } from './welcome.js';

const TABS = [
  { id: 'today', label: 'Today', short: 'Today', icon: 'sun', render: renderToday },
  { id: 'medicines', label: 'Medicines', short: 'Meds', icon: 'pill', render: renderMedicines },
  { id: 'appointments', label: 'Appointments', short: 'Visits', icon: 'calendar', render: renderAppointments },
  { id: 'insights', label: 'Insights', short: 'Insights', icon: 'chart', render: renderInsights },
  { id: 'circle', label: 'Circle', short: 'Circle', icon: 'users', render: renderCircle },
  { id: 'activity', label: 'Activity', short: 'Activity', icon: 'bell', render: renderActivity },
];
const ROLE_LABEL = { elder: 'Elder', caretaker: 'Caretaker', family: 'Family' };
const REFRESH_MS = 60_000;

const main = document.getElementById('main');
const nav = document.getElementById('app-nav');
const tablist = document.getElementById('tablist');
const headerSession = document.getElementById('header-session');

const state = { data: null, tab: 'today', timer: null };

function tabFromHash() {
  const id = location.hash.slice(1);
  return TABS.some((t) => t.id === id) ? id : 'today';
}

function applyPrefs(prefs) {
  document.documentElement.dataset.textSize = String(prefs.size);
  document.documentElement.classList.toggle('high-contrast', Boolean(prefs.contrast));
  for (const button of document.querySelectorAll('.size-btn')) button.setAttribute('aria-pressed', String(Number(button.dataset.size) === prefs.size));
  document.getElementById('contrast-toggle').setAttribute('aria-pressed', String(Boolean(prefs.contrast)));
}

function setupDisplayControls() {
  const prefs = loadPrefs();
  applyPrefs(prefs);
  for (const button of document.querySelectorAll('.size-btn')) {
    button.addEventListener('click', () => {
      prefs.size = Number(button.dataset.size);
      applyPrefs(prefs);
      savePrefs(prefs);
    });
  }
  document.getElementById('contrast-toggle').addEventListener('click', () => {
    prefs.contrast = !prefs.contrast;
    applyPrefs(prefs);
    savePrefs(prefs);
  });
}

function buildTabs() {
  clear(
    tablist,
    TABS.map((tab) => {
      const button = h(
        'button',
        { type: 'button', role: 'tab', id: `tab-${tab.id}`, 'aria-controls': 'panel', class: 'tab' },
        icon(tab.icon),
        h('span', { class: 'tab-label' }, tab.label),
        h('span', { class: 'tab-short' }, tab.short),
      );
      button.addEventListener('click', () => go(tab.id));
      return button;
    }),
  );
}

tablist.addEventListener('keydown', (event) => {
  const index = TABS.findIndex((t) => t.id === state.tab);
  const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 };
  if (!(event.key in moves)) return;
  event.preventDefault();
  const next = TABS[(moves[event.key] + TABS.length) % TABS.length];
  go(next.id, { focusTab: true });
});

function syncTabs() {
  for (const tab of TABS) {
    const button = document.getElementById(`tab-${tab.id}`);
    const selected = tab.id === state.tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
}

function renderHeader() {
  const { data } = state;
  clear(
    headerSession,
    h(
      'div',
      { class: 'session-info' },
      h('p', { class: 'session-circle' }, `${data.elder.name}'s circle `, h('span', { class: 'code-chip' }, icon('lock'), h('span', { class: 'visually-hidden' }, 'Circle code '), data.code)),
      h('p', { class: 'session-me' }, h('span', { class: 'avatar avatar-sm', 'aria-hidden': 'true' }, data.me.name.slice(0, 1).toUpperCase()), data.me.name, ' ', h('span', { class: `chip chip-${data.me.role}` }, ROLE_LABEL[data.me.role] ?? data.me.role)),
    ),
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: signOut }, 'Sign out'),
  );
  headerSession.hidden = false;
}

function renderPanel({ focusHeading = false } = {}) {
  const tab = TABS.find((t) => t.id === state.tab);
  const activeKey = document.activeElement?.dataset?.key;
  const panel = h('div', { id: 'panel', role: 'tabpanel', 'aria-labelledby': `tab-${tab.id}`, class: 'panel' }, tab.render(state.data, { refresh, go }));
  clear(main, panel);
  document.title = `${tab.label} · Saathi`;
  if (focusHeading) panel.querySelector('.view-title')?.focus();
  else if (activeKey) main.querySelector(`[data-key="${CSS.escape(activeKey)}"]`)?.focus();
}

function go(id, { focusTab = false } = {}) {
  state.tab = id;
  if (location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);
  syncTabs();
  renderPanel({ focusHeading: !focusTab });
  if (focusTab) document.getElementById(`tab-${id}`).focus();
}

async function refresh() {
  try {
    state.data = await api.circle();
  } catch (error) {
    if (error.status !== 401) toast(error.message);
    return;
  }
  renderHeader();
  if (!document.querySelector('dialog[open]')) renderPanel();
}

function startPolling() {
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (document.visibilityState === 'visible' && state.data) refresh();
  }, REFRESH_MS);
}

function skeleton() {
  const block = (cls) => h('div', { class: `skeleton ${cls}`, 'aria-hidden': 'true' });
  return h(
    'div',
    { class: 'skeleton-wrap', role: 'status' },
    h('span', { class: 'visually-hidden' }, 'Loading your circle…'),
    block('sk-title'),
    block('sk-line'),
    h('div', { class: 'today-grid' }, block('sk-card'), block('sk-card'), block('sk-card')),
    block('sk-list'),
  );
}

async function showApp() {
  main.replaceChildren(skeleton());
  try {
    state.data = await api.circle();
  } catch (error) {
    if (error.status !== 401) {
      toast(error.message);
      showWelcome();
    }
    return;
  }
  nav.hidden = false;
  buildTabs();
  renderHeader();
  state.tab = tabFromHash();
  go(state.tab);
  startPolling();
}

function showWelcome() {
  clearInterval(state.timer);
  state.data = null;
  nav.hidden = true;
  headerSession.hidden = true;
  document.title = 'Saathi — care that keeps the elder in charge';
  if (location.hash) history.replaceState(null, '', location.pathname);
  renderWelcome(main, showApp);
  main.querySelector('h1')?.focus();
}

function signOut() {
  session.clear();
  toast('Signed out');
  showWelcome();
}

handleUnauthorized(() => {
  toast('Your session ended. Please sign in again.');
  showWelcome();
});

window.addEventListener('hashchange', () => {
  if (state.data) go(tabFromHash());
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.data) refresh();
});

setupDisplayControls();
if (session.get()) showApp();
else showWelcome();
