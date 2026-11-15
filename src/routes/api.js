import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  addAppointment,
  addMedication,
  addMember,
  briefContext,
  buildCircle,
  decideMedication,
  findMember,
  logActivity,
  logDose,
  recordOutbox,
  removeAppointment,
  removeMedication,
  removeMember,
  toView,
  updateAppointment,
  updateMedication,
  updateProfile,
  updateSettings,
} from '../domain/circle.js';
import { conflict, notFound, unauthorized } from '../lib/errors.js';
import { generateCircleCode, generatePasscode, hashPasscode, issueToken, newId, readToken, safeEqual, verifyPasscode } from '../lib/security.js';
import * as schemas from '../schemas.js';

const { validate } = schemas;

const limiter = (windowMinutes, limit) =>
  rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
  });

export function createApiRouter({ store, ai, mailer, config, runner, clock = () => new Date() }) {
  const router = Router();
  const signInLimiter = limiter(15, 10);
  const aiLimiter = limiter(10, 30);
  const emailLimiter = limiter(60, 5);

  const features = () => ({ ai: ai.enabled, email: mailer.enabled });

  const session = (circleId, member) => ({
    token: issueToken({ c: circleId, m: member.id }, config.sessionSecret, config.sessionTtlMs, clock().getTime()),
    circleCode: circleId,
    member: { id: member.id, name: member.name, role: member.role },
  });

  async function authenticate(req, _res, next) {
    const header = req.get('authorization') ?? '';
    const claims = header.startsWith('Bearer ') ? readToken(header.slice(7), config.sessionSecret, clock().getTime()) : null;
    if (!claims) throw unauthorized();
    const circle = await store.get(claims.c);
    const member = circle && findMember(circle, claims.m);
    if (!member) throw unauthorized('Your access has ended. Please sign in again.');
    req.auth = { circleId: claims.c, memberId: claims.m };
    req.circle = circle;
    req.member = member;
    next();
  }

  async function mutate(req, change) {
    const now = clock();
    const outcome = await store.update(req.auth.circleId, (draft) => {
      const member = findMember(draft, req.auth.memberId);
      if (!member) throw unauthorized();
      return change(draft, member, now);
    });
    if (!outcome) throw notFound('Circle not found');
    return outcome.result;
  }

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', store: store.kind, ...features() });
  });

  router.post('/circles', signInLimiter, async (req, res) => {
    const input = validate(schemas.createCircleSchema, req.body);
    const now = clock();
    const elderMember = { id: newId('mem'), name: input.elder.name, email: input.elder.email, passcodeHash: await hashPasscode(input.passcode) };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const circle = buildCircle({ code: generateCircleCode(), elder: input.elder, elderMember, now });
      logActivity(circle, elderMember, 'started the care circle', '', now);
      if (await store.create(circle)) return res.status(201).json(session(circle.id, circle.members[0]));
    }
    throw conflict('Could not create a circle right now. Please try again.');
  });

  router.post('/sessions', signInLimiter, async (req, res) => {
    const { circleCode, passcode } = validate(schemas.sessionSchema, req.body);
    const circle = await store.get(circleCode);
    for (const member of circle?.members ?? []) {
      if (await verifyPasscode(passcode, member.passcodeHash)) return res.json(session(circle.id, member));
    }
    throw unauthorized('Circle code or passcode is incorrect');
  });

  router.post('/cron/tick', async (req, res) => {
    if (!config.cronSecret) throw notFound();
    if (!safeEqual(req.get('x-cron-secret') ?? '', config.cronSecret)) throw unauthorized();
    res.json(await runner.run());
  });

  router.use('/circle', authenticate);
  router.use('/ai', authenticate, aiLimiter);

  router.get('/circle', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(toView(req.circle, req.member, clock(), features()));
  });

  router.patch('/circle/profile', async (req, res) => {
    const patch = validate(schemas.profileSchema, req.body);
    await mutate(req, (circle, member, now) => updateProfile(circle, member, patch, now));
    res.status(204).end();
  });

  router.patch('/circle/settings', async (req, res) => {
    const patch = validate(schemas.settingsSchema, req.body);
    await mutate(req, (circle, member, now) => updateSettings(circle, member, patch, now));
    res.status(204).end();
  });

  router.post('/circle/members', async (req, res) => {
    const input = validate(schemas.memberSchema, req.body);
    const passcode = generatePasscode();
    const passcodeHash = await hashPasscode(passcode);
    const member = await mutate(req, (circle, actor, now) => addMember(circle, actor, input, passcodeHash, now));
    res.status(201).json({ member: { id: member.id, name: member.name, role: member.role, email: member.email }, passcode });
  });

  router.patch('/circle/members/me', async (req, res) => {
    const { notify } = validate(schemas.memberPrefsSchema, req.body);
    await mutate(req, (_circle, member) => {
      member.notify = notify;
    });
    res.status(204).end();
  });

  router.delete('/circle/members/:id', async (req, res) => {
    await mutate(req, (circle, member, now) => removeMember(circle, member, req.params.id, now));
    res.status(204).end();
  });

  router.post('/circle/medications', async (req, res) => {
    const input = validate(schemas.medicationSchema, req.body);
    res.status(201).json(await mutate(req, (circle, member, now) => addMedication(circle, member, input, now)));
  });

  router.patch('/circle/medications/:id', async (req, res) => {
    const patch = validate(schemas.medicationPatchSchema, req.body);
    res.json(await mutate(req, (circle, member, now) => updateMedication(circle, member, req.params.id, patch, now)));
  });

  router.delete('/circle/medications/:id', async (req, res) => {
    const { pendingApproval } = await mutate(req, (circle, member, now) => removeMedication(circle, member, req.params.id, now));
    if (pendingApproval) return res.status(202).json({ pendingApproval });
    res.status(204).end();
  });

  router.post('/circle/medications/:id/decision', async (req, res) => {
    const { approve } = validate(schemas.decisionSchema, req.body);
    const medication = await mutate(req, (circle, member, now) => decideMedication(circle, member, req.params.id, approve, now));
    res.json({ medication });
  });

  router.post('/circle/doses', async (req, res) => {
    const { key, status } = validate(schemas.doseSchema, req.body);
    res.json({ dose: await mutate(req, (circle, member, now) => logDose(circle, member, key, status, now)) });
  });

  router.post('/circle/appointments', async (req, res) => {
    const input = validate(schemas.appointmentSchema, req.body);
    res.status(201).json({ appointment: await mutate(req, (circle, member, now) => addAppointment(circle, member, input, now)) });
  });

  router.patch('/circle/appointments/:id', async (req, res) => {
    const patch = validate(schemas.appointmentPatchSchema, req.body);
    res.json({ appointment: await mutate(req, (circle, member, now) => updateAppointment(circle, member, req.params.id, patch, now)) });
  });

  router.delete('/circle/appointments/:id', async (req, res) => {
    await mutate(req, (circle, member, now) => removeAppointment(circle, member, req.params.id, now));
    res.status(204).end();
  });

  router.post('/circle/test-email', emailLimiter, async (req, res) => {
    const to = [req.member.email];
    const outcome = req.circle.demo
      ? { delivered: false }
      : await mailer.send({
          to,
          subject: 'Saathi test reminder',
          text: `Hello ${req.member.name},\nThis is how Saathi reminders will look for the ${req.circle.elder.name} care circle.`,
        });
    await mutate(req, (circle, _member, now) =>
      recordOutbox(circle, { at: now.toISOString(), kind: 'test', subject: 'Saathi test reminder', to, delivered: outcome.delivered }),
    );
    res.json({ delivered: outcome.delivered, recipients: to });
  });

  router.post('/ai/medication', async (req, res) => {
    const { text } = validate(schemas.aiMedicationSchema, req.body);
    res.json({ medication: await ai.parseMedication(text) });
  });

  router.post('/ai/scan', express.json({ limit: '6mb' }), async (req, res) => {
    const { image, mimeType } = validate(schemas.aiScanSchema, req.body);
    res.json(await ai.scanPrescription({ data: image, mimeType }));
  });

  router.post('/ai/brief', async (req, res) => {
    const { language } = validate(schemas.aiBriefSchema, req.body);
    res.json(await ai.careBrief(briefContext(req.circle, clock()), language));
  });

  router.use((_req, _res, next) => next(notFound('Unknown API route')));

  return router;
}
