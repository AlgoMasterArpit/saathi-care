import { z } from 'zod';
import { badRequest } from './lib/errors.js';
import { isValidTimeZone } from './lib/time.js';

const text = (max) => z.string().trim().max(max);
const name = text(80).min(1, 'Required');
const email = z.string().trim().toLowerCase().email('Enter a valid email').max(254);
const timezone = z.string().refine(isValidTimeZone, 'Unknown timezone');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const passcode = z.string().min(6, 'Use at least 6 characters').max(64);
const isoDateTime = z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString());

export const circleCode = z.string().trim().toUpperCase().regex(/^SA-[A-Z0-9]{6}$/, 'Circle codes look like SA-ABC123');

export const createCircleSchema = z.object({
  elder: z.object({ name, email, timezone }),
  passcode,
});

export const sessionSchema = z.object({ circleCode, passcode: z.string().min(1).max(64) });

export const profileSchema = z
  .object({
    name,
    email,
    timezone,
    conditions: z.array(text(60).min(1)).max(20),
    allergies: z.array(text(60).min(1)).max(20),
    emergencyContact: z.object({ name, phone: text(30).min(3) }).nullable(),
    notes: text(1000),
  })
  .partial()
  .strict();

export const settingsSchema = z
  .object({
    requireApproval: z.boolean(),
    graceMinutes: z.number().int().min(5).max(240),
    escalateAfterMisses: z.number().int().min(1).max(10),
    upcomingLeadMinutes: z.number().int().min(0).max(120),
  })
  .partial()
  .strict();

export const memberSchema = z.object({ name, email, role: z.enum(['caretaker', 'family']) }).strict();

export const memberPrefsSchema = z.object({ notify: z.boolean() }).strict();

const medicationFields = {
  name,
  dosage: text(40).default(''),
  instructions: text(200).default(''),
  times: z
    .array(time)
    .min(1, 'Add at least one time')
    .max(6)
    .transform((times) => [...new Set(times)].sort()),
  days: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .default([])
    .transform((days) => [...new Set(days)].sort()),
  perDose: z.number().positive().max(10).default(1),
  stock: z.number().int().min(0).max(10000).nullable().default(null),
};

export const medicationSchema = z.object(medicationFields).strict();

export const medicationPatchSchema = z
  .object({
    name,
    dosage: text(40),
    instructions: text(200),
    times: medicationFields.times,
    days: z.array(z.number().int().min(0).max(6)).max(7),
    perDose: z.number().positive().max(10),
    stock: z.number().int().min(0).max(10000).nullable(),
  })
  .partial()
  .strict();

export const decisionSchema = z.object({ approve: z.boolean() }).strict();

export const doseSchema = z.object({ key: z.string().max(80), status: z.enum(['taken', 'skipped']) }).strict();

const appointmentFields = {
  doctor: name,
  specialty: text(60).default(''),
  location: text(160).default(''),
  startsAt: isoDateTime,
  notes: text(1000).default(''),
  questions: z.array(text(200).min(1)).max(10).default([]),
};

export const appointmentSchema = z.object(appointmentFields).strict();

export const appointmentPatchSchema = z
  .object({ ...appointmentFields, specialty: text(60), location: text(160), notes: text(1000), questions: z.array(text(200).min(1)).max(10) })
  .partial()
  .strict();

export const aiMedicationSchema = z.object({ text: text(500).min(3) }).strict();

export const aiScanSchema = z
  .object({
    image: z.string().max(5_600_000).regex(/^[A-Za-z0-9+/=]+$/, 'Image must be base64'),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  })
  .strict();

export const aiBriefSchema = z.object({ language: z.enum(['en', 'hi']).default('en') }).strict();

export function validate(schema, value) {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
  throw badRequest('Please check the highlighted fields', details);
}
