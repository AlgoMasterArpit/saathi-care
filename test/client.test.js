import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ApiError, api, handleUnauthorized, session } from '../public/js/api.js';
import { clock12, describeDays, formatDate, googleCalendarUrl, googleMapsUrl, untilText } from '../public/js/format.js';

describe('client formatting', () => {
  it('formats 24 hour times for elders', () => {
    assert.equal(clock12('00:05'), '12:05 AM');
    assert.equal(clock12('08:30'), '8:30 AM');
    assert.equal(clock12('12:00'), '12:00 PM');
    assert.equal(clock12('21:30'), '9:30 PM');
  });

  it('describes weekday schedules in plain words', () => {
    assert.equal(describeDays([]), 'Every day');
    assert.equal(describeDays([0, 1, 2, 3, 4, 5, 6]), 'Every day');
    assert.equal(describeDays([5, 1, 3]), 'Mon, Wed, Fri');
  });

  it('formats calendar dates without timezone drift', () => {
    assert.match(formatDate('2026-11-15'), /Sun.*15.*Nov/);
  });

  it('counts down to the next dose', () => {
    assert.equal(untilText(10_000), '1 min');
    assert.equal(untilText(45 * 60_000), '45 min');
    assert.equal(untilText(120 * 60_000), '2 h');
    assert.equal(untilText(135 * 60_000), '2 h 15 m');
  });

  it('builds a one-hour google calendar event with questions to ask', () => {
    const url = new URL(googleCalendarUrl({ doctor: 'Dr. Iyer', startsAt: '2026-11-17T05:30:00.000Z', location: 'Apollo Clinic', notes: 'Bring reports', questions: ['Is my HbA1c better?'] }, 'Kamla Devi'));
    assert.equal(url.hostname, 'calendar.google.com');
    assert.equal(url.searchParams.get('action'), 'TEMPLATE');
    assert.equal(url.searchParams.get('text'), 'Kamla Devi: Dr. Iyer');
    assert.equal(url.searchParams.get('dates'), '20261117T053000Z/20261117T063000Z');
    assert.equal(url.searchParams.get('details'), 'Bring reports\n• Is my HbA1c better?');
    assert.equal(url.searchParams.get('location'), 'Apollo Clinic');
  });

  it('encodes clinic addresses for google maps', () => {
    const url = new URL(googleMapsUrl('Apollo Clinic, Indiranagar & Co'));
    assert.equal(url.searchParams.get('query'), 'Apollo Clinic, Indiranagar & Co');
  });
});

describe('client api', () => {
  const calls = [];
  let reply;

  beforeEach(() => {
    const store = new Map();
    globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    globalThis.fetch = async (path, init) => {
      calls.push({ path, ...init });
      return reply();
    };
    calls.length = 0;
  });

  afterEach(() => {
    delete globalThis.sessionStorage;
    delete globalThis.fetch;
  });

  const json = (status, body) => () => ({ status, ok: status < 400, json: async () => body });

  it('sends the bearer token and json body', async () => {
    session.set('tok');
    reply = json(200, { dose: { status: 'taken' } });
    const result = await api.logDose('med_1@2026-11-15T08:00', 'taken');
    assert.deepEqual(result, { dose: { status: 'taken' } });
    assert.equal(calls[0].path, '/api/circle/doses');
    assert.equal(calls[0].headers.Authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(calls[0].body), { key: 'med_1@2026-11-15T08:00', status: 'taken' });
  });

  it('encodes ids in paths and handles empty 204 replies', async () => {
    reply = () => ({ status: 204, ok: true, json: async () => assert.fail('no body expected') });
    assert.equal(await api.removeMedication('med/../x'), null);
    assert.equal(calls[0].path, '/api/circle/medications/med%2F..%2Fx');
    assert.equal(calls[0].method, 'DELETE');
  });

  it('clears the session and signals sign-out on 401', async () => {
    session.set('expired');
    let signedOut = false;
    handleUnauthorized(() => {
      signedOut = true;
    });
    reply = json(401, { error: 'Your access has ended. Please sign in again.' });
    await assert.rejects(api.circle(), (error) => error instanceof ApiError && error.status === 401 && /access has ended/.test(error.message));
    assert.equal(signedOut, true);
    assert.equal(session.get(), null);
  });

  it('surfaces validation details and a friendly offline message', async () => {
    reply = json(400, { error: 'Please check the highlighted fields', details: [{ field: 'name', message: 'Required' }] });
    await assert.rejects(api.addMedication({}), (error) => error.details[0].field === 'name');
    globalThis.fetch = async () => {
      throw new TypeError('network down');
    };
    await assert.rejects(api.circle(), (error) => error.status === 0 && /offline/.test(error.message));
  });

  it('survives storage being unavailable', () => {
    globalThis.sessionStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    assert.equal(session.get(), null);
    assert.doesNotThrow(() => session.set('x'));
    assert.doesNotThrow(() => session.clear());
  });
});
