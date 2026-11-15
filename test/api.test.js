import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { DEMO_CODE, DEMO_PASSCODES, seedDemo } from '../src/demo.js';
import { createReminderRunner } from '../src/scheduler.js';
import { createGemini } from '../src/services/gemini.js';
import { createMailer } from '../src/services/mailer.js';
import { createMemoryStore } from '../src/store/memory.js';

const fakeGenAI = {
  models: {
    async generateContent({ config }) {
      const byShape = {
        name: { name: 'Metformin', dosage: '500 mg', instructions: 'After food', times: ['08:00', '20:00'], days: [], perDose: 1, stock: null },
        medications: { medications: [], doctor: 'Dr. Rao', notes: 'Second line unreadable' },
        headline: { headline: 'A steady week', summary: 'Most doses taken.', wins: ['Morning doses on time'], concerns: [], doctorQuestions: ['Any changes needed?'] },
      };
      const key = Object.keys(byShape).find((k) => k in config.responseSchema.properties);
      return { text: JSON.stringify(byShape[key]) };
    },
  },
};

describe('Saathi API', () => {
  let server;
  let base;
  const sent = [];
  const store = createMemoryStore();
  const config = { sessionSecret: 's'.repeat(64), sessionTtlMs: 3_600_000, cronSecret: 'cron-secret-value' };
  const mailer = createMailer({ user: 'saathi@gmail.com', transport: { sendMail: async (message) => sent.push(message) } });
  const ai = createGemini({ client: fakeGenAI, model: 'test-model' });
  const runner = createReminderRunner({ store, mailer, logger: { info() {}, error() {} } });

  const call = async (method, path, { token, body } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  };

  let elderToken;
  let familyToken;
  let familyPasscode;

  before(async () => {
    await seedDemo(store);
    server = createApp({ store, ai, mailer, config, runner }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api`;
  });

  after(() => server.close());

  it('reports health without leaking secrets', async () => {
    const { status, body } = await call('GET', '/health');
    assert.equal(status, 200);
    assert.deepEqual(body, { status: 'ok', store: 'memory', ai: true, email: true });
  });

  it('serves strict security headers', async () => {
    const response = await fetch(base.replace('/api', '/'));
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-powered-by'), null);
  });

  it('creates a circle with validation', async () => {
    const bad = await call('POST', '/circles', { body: { elder: { name: '', email: 'nope', timezone: 'Mars/Base' }, passcode: '1' } });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.details.map((d) => d.field).sort(), ['elder.email', 'elder.name', 'elder.timezone', 'passcode']);

    const { status, body } = await call('POST', '/circles', { body: { elder: { name: 'Asha Rao', email: 'asha@mail.com', timezone: 'Asia/Kolkata' }, passcode: 'sunrise-42' } });
    assert.equal(status, 201);
    assert.match(body.circleCode, /^SA-[A-Z0-9]{6}$/);
    assert.equal(body.member.role, 'elder');
    elderToken = body.token;
  });

  it('rejects malformed json and unauthenticated access', async () => {
    assert.equal((await call('POST', '/circles', { body: '{oops' })).status, 400);
    assert.equal((await call('GET', '/circle')).status, 401);
    assert.equal((await call('GET', '/circle', { token: 'forged.token' })).status, 401);
  });

  it('invites a family member who signs in with their own passcode', async () => {
    const invite = await call('POST', '/circle/members', { token: elderToken, body: { name: 'Arjun', email: 'arjun@mail.com', role: 'family' } });
    assert.equal(invite.status, 201);
    familyPasscode = invite.body.passcode;
    const view = await call('GET', '/circle', { token: elderToken });

    const wrong = await call('POST', '/sessions', { body: { circleCode: view.body.code, passcode: '0000-0000' } });
    assert.equal(wrong.status, 401);
    const login = await call('POST', '/sessions', { body: { circleCode: view.body.code.toLowerCase(), passcode: familyPasscode } });
    assert.equal(login.status, 200);
    assert.equal(login.body.member.role, 'family');
    familyToken = login.body.token;
  });

  it('routes family medicine changes through the elder', async () => {
    const proposed = await call('POST', '/circle/medications', { token: familyToken, body: { name: 'Metformin', dosage: '500 mg', times: ['20:00', '08:00'] } });
    assert.equal(proposed.status, 201);
    assert.equal(proposed.body.pendingApproval, true);
    assert.deepEqual(proposed.body.medication.times, ['08:00', '20:00']);

    const forbidden = await call('POST', `/circle/medications/${proposed.body.medication.id}/decision`, { token: familyToken, body: { approve: true } });
    assert.equal(forbidden.status, 403);

    const approved = await call('POST', `/circle/medications/${proposed.body.medication.id}/decision`, { token: elderToken, body: { approve: true } });
    assert.equal(approved.body.medication.status, 'active');

    const view = await call('GET', '/circle', { token: familyToken });
    assert.equal(view.body.medications[0].status, 'active');
    assert.equal(view.body.me.can.approve, false);
    assert.ok(view.body.activity.some((a) => a.action === 'approved'));
  });

  it('rejects unknown fields and bad times', async () => {
    const { status } = await call('POST', '/circle/medications', { token: elderToken, body: { name: 'X', times: ['25:00'], isAdmin: true } });
    assert.equal(status, 400);
  });

  it('manages appointments with iso timestamps', async () => {
    const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const created = await call('POST', '/circle/appointments', { token: familyToken, body: { doctor: 'Dr. Iyer', startsAt, questions: ['Is my sugar ok?'] } });
    assert.equal(created.status, 201);
    const updated = await call('PATCH', `/circle/appointments/${created.body.appointment.id}`, { token: elderToken, body: { location: 'Apollo Clinic' } });
    assert.equal(updated.body.appointment.location, 'Apollo Clinic');
    assert.equal((await call('DELETE', `/circle/appointments/${created.body.appointment.id}`, { token: elderToken })).status, 204);
  });

  it('revokes access immediately when a member is removed', async () => {
    const view = await call('GET', '/circle', { token: elderToken });
    const arjun = view.body.members.find((m) => m.role === 'family');
    assert.equal((await call('DELETE', `/circle/members/${arjun.id}`, { token: familyToken })).status, 403);
    assert.equal((await call('DELETE', `/circle/members/${arjun.id}`, { token: elderToken })).status, 204);
    assert.equal((await call('GET', '/circle', { token: familyToken })).status, 401);
  });

  it('lets the demo caretaker log a dose', async () => {
    const login = await call('POST', '/sessions', { body: { circleCode: DEMO_CODE, passcode: DEMO_PASSCODES.caretaker } });
    const view = await call('GET', '/circle', { token: login.body.token });
    const dose = view.body.today.doses[0];
    const logged = await call('POST', '/circle/doses', { token: login.body.token, body: { key: dose.key, status: 'taken' } });
    assert.equal(logged.body.dose.loggedBy, 'Ravi Kumar');
  });

  it('returns validated Gemini output for parsing, scanning and briefs', async () => {
    const parsed = await call('POST', '/ai/medication', { token: elderToken, body: { text: 'metformin 500 twice a day after food' } });
    assert.deepEqual(parsed.body.medication.times, ['08:00', '20:00']);
    const scan = await call('POST', '/ai/scan', { token: elderToken, body: { image: Buffer.from('fake').toString('base64'), mimeType: 'image/png' } });
    assert.equal(scan.body.notes, 'Second line unreadable');
    const brief = await call('POST', '/ai/brief', { token: elderToken, body: { language: 'hi' } });
    assert.equal(brief.body.headline, 'A steady week');
    assert.equal((await call('POST', '/ai/brief', { body: {} })).status, 401);
  });

  it('protects the cron endpoint and sends due reminders', async () => {
    assert.equal((await call('POST', '/cron/tick')).status, 401);
    const response = await fetch(`${base}/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': config.cronSecret } });
    const summary = await response.json();
    assert.equal(response.status, 200);
    assert.ok(summary.circles >= 2);
  });

  it('sends a test email to the signed-in member', async () => {
    const before = sent.length;
    const { body } = await call('POST', '/circle/test-email', { token: elderToken });
    assert.equal(body.delivered, true);
    assert.equal(sent.length, before + 1);
    assert.deepEqual(sent.at(-1).to, ['asha@mail.com']);
  });

  it('returns json 404 for unknown api routes and serves the app shell elsewhere', async () => {
    assert.equal((await call('GET', '/nope')).status, 404);
    const page = await fetch(base.replace('/api', '/today'));
    assert.equal(page.status, 200);
  });
});
