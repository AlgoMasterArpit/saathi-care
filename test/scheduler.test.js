import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runReminderTick } from '../src/scheduler.js';
import { renderEmail, createMailer } from '../src/services/mailer.js';
import { createMemoryStore } from '../src/store/memory.js';
import { istDate, makeCircle } from './helpers.js';

describe('reminder scheduler', () => {
  it('emails the right people once and records the outbox', async () => {
    const now = istDate('2026-11-15', '08:45');
    const store = createMemoryStore();
    await store.create(makeCircle({ now, medications: [{ name: 'Statin', times: ['08:00'] }] }));
    const deliveries = [];
    const mailer = { send: async (message) => (deliveries.push(message), { delivered: true }) };

    const first = await runReminderTick({ store, mailer, now });
    const second = await runReminderTick({ store, mailer, now });

    assert.equal(first.reminders, deliveries.length);
    assert.equal(second.reminders, 0);
    const missed = deliveries.find((d) => d.subject.startsWith('Missed dose'));
    assert.deepEqual(missed.to, ['asha@mail.com', 'joy@mail.com']);
    const circle = await store.get('SA-TEST01');
    assert.equal(circle.outbox.length, first.reminders);
    assert.ok(circle.outbox.every((entry) => entry.delivered));
  });

  it('never emails real people from the public demo circle', async () => {
    const now = istDate('2026-11-15', '08:45');
    const store = createMemoryStore();
    const circle = makeCircle({ now, medications: [{ name: 'Statin', times: ['08:00'] }] });
    circle.demo = true;
    await store.create(circle);
    let calls = 0;
    const summary = await runReminderTick({ store, mailer: { send: async () => (calls += 1) }, now });
    assert.equal(calls, 0);
    assert.ok(summary.reminders > 0);
    assert.equal(summary.delivered, 0);
  });
});

describe('mailer', () => {
  it('escapes content and adds an accessible call to action', () => {
    const { html, text } = renderEmail({ subject: '<b>Dose</b>', text: 'Take <script>', appUrl: 'https://saathi.app' });
    assert.ok(html.includes('&lt;b&gt;Dose&lt;/b&gt;'));
    assert.ok(!html.includes('<script>'));
    assert.match(html, /Open Saathi/);
    assert.match(text, /https:\/\/saathi\.app/);
  });

  it('skips reserved example domains and reports when disabled', async () => {
    const sent = [];
    const mailer = createMailer({ user: 'a@gmail.com', transport: { sendMail: async (m) => sent.push(m) } });
    const outcome = await mailer.send({ to: ['kamla@example.com', 'real@mail.com', 'real@mail.com'], subject: 'Hi', text: 'Hello' });
    assert.deepEqual(outcome, { delivered: true, recipients: ['real@mail.com'] });
    assert.equal(sent.length, 1);
    assert.equal((await createMailer().send({ to: ['real@mail.com'], subject: 'Hi', text: 'x' })).delivered, false);
  });

  it('reports failed deliveries without throwing', async () => {
    const mailer = createMailer({ user: 'a@gmail.com', transport: { sendMail: async () => Promise.reject(new Error('smtp down')) } });
    assert.equal((await mailer.send({ to: ['real@mail.com'], subject: 'Hi', text: 'x' })).delivered, false);
  });
});
