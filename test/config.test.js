import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createGemini } from '../src/services/gemini.js';

describe('configuration', () => {
  it('refuses to start in production without a strong session secret', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /SESSION_SECRET/);
    assert.throws(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short' }), /SESSION_SECRET/);
  });

  it('generates an ephemeral secret for local development', () => {
    assert.equal(loadConfig({}).sessionSecret.length, 64);
  });

  it('accepts firestore credentials as raw or base64 json and strips app password spaces', () => {
    const json = JSON.stringify({ project_id: 'saathi-care', client_email: 'svc@saathi-care.iam.gserviceaccount.com' });
    const raw = loadConfig({ FIRESTORE_CREDENTIALS: json, GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' });
    const encoded = loadConfig({ FIRESTORE_CREDENTIALS: Buffer.from(json).toString('base64') });
    assert.equal(raw.firestore.credentials.project_id, 'saathi-care');
    assert.equal(encoded.firestore.credentials.project_id, 'saathi-care');
    assert.equal(raw.gmail.pass, 'abcdefghijklmnop');
  });
});

describe('gemini assistant', () => {
  it('falls back to the second model when the first fails', async () => {
    const calls = [];
    const client = {
      models: {
        async generateContent({ model }) {
          calls.push(model);
          if (model === 'primary') throw new Error('overloaded');
          return { text: JSON.stringify({ name: 'Metformin', dosage: '', instructions: '', times: ['08:00'], days: [], perDose: 1 }) };
        },
      },
    };
    const ai = createGemini({ client, model: 'primary', fallbackModel: 'backup' });
    assert.equal((await ai.parseMedication('metformin morning')).name, 'Metformin');
    assert.deepEqual(calls, ['primary', 'backup']);
  });

  it('rejects malformed model output instead of trusting it', async () => {
    const client = { models: { generateContent: async () => ({ text: JSON.stringify({ name: '', times: ['99:99'] }) }) } };
    await assert.rejects(createGemini({ client, model: 'm' }).parseMedication('x'), { status: 502 });
    const prose = { models: { generateContent: async () => ({ text: 'not json' }) } };
    await assert.rejects(createGemini({ client: prose, model: 'm' }).parseMedication('x'), { status: 502 });
  });

  it('keeps the readable medicines from a messy scan and blanks placeholder text', async () => {
    const reply = {
      medications: [
        { name: 'Telmisartan', dosage: '40 mg', instructions: 'null', times: ['8:00'], days: [], perDose: 1 },
        { name: '', dosage: 'smudged', times: [], days: [], perDose: 1 },
        { name: 'Metformin', dosage: 'N/A', instructions: 'after meals', times: ['25:99'], days: [], perDose: 1 },
      ],
      doctor: 'null',
      notes: 'Second line is smudged',
    };
    const client = { models: { generateContent: async () => ({ text: JSON.stringify(reply) }) } };
    const scan = await createGemini({ client, model: 'm' }).scanPrescription({ data: 'eA==', mimeType: 'image/jpeg' });
    assert.deepEqual(scan.medications.map((m) => [m.name, m.dosage, m.instructions, m.times]), [['Telmisartan', '40 mg', '', ['08:00']]]);
    assert.equal(scan.doctor, '');
    assert.equal(scan.notes, 'Second line is smudged');
  });

  it('returns an empty list with an explanation for photos that are not prescriptions', async () => {
    const client = { models: { generateContent: async () => ({ text: JSON.stringify({ medications: [], doctor: 'None', notes: 'This is a grocery list.' }) }) } };
    const scan = await createGemini({ client, model: 'm' }).scanPrescription({ data: 'eA==', mimeType: 'image/png' });
    assert.deepEqual(scan, { medications: [], doctor: '', notes: 'This is a grocery list.' });
  });

  it('reports a clear 503 when no key is configured', async () => {
    const ai = createGemini({});
    assert.equal(ai.enabled, false);
    await assert.rejects(ai.careBrief({}), { status: 503 });
  });
});
