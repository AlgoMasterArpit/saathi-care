import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { HttpError } from '../lib/errors.js';

const SAFETY_RULES = `You support elderly people and their families in India and elsewhere.
Never diagnose, never recommend starting, stopping or changing a dose, and never invent medicines.
When something is unclear, leave the field empty rather than guessing.
Always use plain, warm, respectful language that keeps the elder in charge of their own care.`;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const PLACEHOLDER = /^(null|none|nil|n\/?a|unknown|not (stated|specified|mentioned)|-+)$/i;

const blank = (value) => (value === null || value === undefined || (typeof value === 'string' && PLACEHOLDER.test(value.trim())) ? '' : value);
const text = (max) => z.preprocess(blank, z.string().trim().max(max)).default('');
const clockTime = z.preprocess((value) => (typeof value === 'string' && /^\d:\d\d$/.test(value.trim()) ? `0${value.trim()}` : value), z.string().regex(TIME));

const medicationShape = z.object({
  name: z.preprocess(blank, z.string().trim().min(1).max(80)),
  dosage: text(40),
  instructions: text(200),
  times: z.array(clockTime).max(6).default([]),
  days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  perDose: z.number().positive().max(10).default(1),
  stock: z.number().int().min(0).max(10000).nullable().default(null),
});

const scanShape = z.object({
  medications: z
    .array(z.unknown())
    .max(40)
    .transform((items) => items.flatMap((item) => {
      const parsed = medicationShape.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }).slice(0, 15)),
  doctor: text(80),
  notes: text(400),
});

const briefShape = z.object({
  headline: z.string().max(160),
  summary: z.string().max(800),
  wins: z.array(z.string().max(200)).max(5),
  concerns: z.array(z.string().max(200)).max(5),
  doctorQuestions: z.array(z.string().max(200)).max(6),
});

const medicationSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Medicine name as written, e.g. Metformin' },
    dosage: { type: 'string', description: 'Strength and form, e.g. 500 mg tablet' },
    instructions: { type: 'string', description: 'Food or timing guidance, e.g. after breakfast' },
    times: { type: 'array', items: { type: 'string' }, description: '24h HH:MM times. Morning 08:00, afternoon 14:00, evening 18:00, night 21:00 unless stated' },
    days: { type: 'array', items: { type: 'integer' }, description: 'Weekdays 0=Sunday..6=Saturday; empty array means every day' },
    perDose: { type: 'number', description: 'Units per dose, default 1' },
    stock: { type: 'integer', nullable: true, description: 'Units on hand if mentioned' },
  },
  required: ['name', 'dosage', 'instructions', 'times', 'days', 'perDose'],
};

const SCHEMAS = {
  medication: medicationSchema,
  scan: {
    type: 'object',
    properties: {
      medications: { type: 'array', items: medicationSchema },
      doctor: { type: 'string' },
      notes: { type: 'string', description: 'Anything a caregiver should double-check, e.g. illegible handwriting' },
    },
    required: ['medications', 'doctor', 'notes'],
  },
  brief: {
    type: 'object',
    properties: {
      headline: { type: 'string' },
      summary: { type: 'string' },
      wins: { type: 'array', items: { type: 'string' } },
      concerns: { type: 'array', items: { type: 'string' } },
      doctorQuestions: { type: 'array', items: { type: 'string' } },
    },
    required: ['headline', 'summary', 'wins', 'concerns', 'doctorQuestions'],
  },
};

const LANGUAGES = { en: 'English', hi: 'Hindi (Devanagari script)' };

export function createGemini({ apiKey, model = 'gemini-3.5-flash', fallbackModel = 'gemini-3.1-flash-lite', client, logger } = {}) {
  const ai = client ?? (apiKey ? new GoogleGenAI({ apiKey, httpOptions: { timeout: 20_000 } }) : null);
  const models = [...new Set([model, fallbackModel].filter(Boolean))];

  async function generate(contents, schemaName, shape) {
    if (!ai) throw new HttpError(503, 'AI assistant is not configured');
    let response;
    for (const candidate of models) {
      try {
        response = await ai.models.generateContent({
          model: candidate,
          contents,
          config: {
            systemInstruction: SAFETY_RULES,
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: SCHEMAS[schemaName],
          },
        });
        break;
      } catch (error) {
        logger?.warn('gemini call failed', { model: candidate, error: error.message?.slice(0, 200) });
      }
    }
    if (!response) throw new HttpError(502, 'The AI assistant is unavailable right now. Please try again.');
    let parsed;
    try {
      parsed = shape.safeParse(JSON.parse(response.text ?? ''));
    } catch {
      parsed = { success: false };
    }
    if (!parsed.success) throw new HttpError(502, 'The AI assistant returned something unexpected. Please try again.');
    return parsed.data;
  }

  return {
    enabled: Boolean(ai),
    parseMedication(text) {
      return generate(
        [{ role: 'user', parts: [{ text: `Turn this description into one medication schedule:\n"""${text}"""` }] }],
        'medication',
        medicationShape,
      );
    },
    scanPrescription({ data, mimeType }) {
      return generate(
        [
          {
            role: 'user',
            parts: [
              { inlineData: { data, mimeType } },
              { text: 'Read this prescription or medicine label. List each medicine with its schedule. Flag anything hard to read in notes. If the image is not a prescription or medicine label, return an empty medications list, leave doctor empty, and say what the image shows in notes.' },
            ],
          },
        ],
        'scan',
        scanShape,
      );
    },
    careBrief(context, language = 'en') {
      return generate(
        [
          {
            role: 'user',
            parts: [
              {
                text: `Write a short weekly care brief in ${LANGUAGES[language] ?? LANGUAGES.en} for an elder and their care circle, based only on these facts. Celebrate wins, name concerns gently, and suggest questions to ask the doctor at the next visit.\n${JSON.stringify(context)}`,
              },
            ],
          },
        ],
        'brief',
        briefShape,
      );
    },
  };
}
