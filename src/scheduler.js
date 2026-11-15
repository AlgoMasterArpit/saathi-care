import { pruneDoses, recordOutbox } from './domain/circle.js';
import { planReminders, pruneNotified, recipientsFor } from './domain/reminders.js';

export async function runReminderTick({ store, mailer, now = new Date() }) {
  const summary = { circles: 0, reminders: 0, delivered: 0 };

  for (const id of await store.ids()) {
    const circle = await store.get(id);
    if (!circle) continue;
    summary.circles += 1;

    const sent = [];
    for (const plan of planReminders(circle, now)) {
      const to = recipientsFor(circle, plan.roles);
      const outcome = circle.demo ? { delivered: false } : await mailer.send({ to, subject: plan.subject, text: plan.text });
      sent.push({ plan, to, delivered: outcome.delivered });
    }
    if (!sent.length) continue;

    await store.update(id, (draft) => {
      draft.notified = pruneNotified(draft.notified, now);
      for (const { plan, to, delivered } of sent) {
        draft.notified[plan.key] = now.toISOString();
        recordOutbox(draft, { at: now.toISOString(), kind: plan.kind, subject: plan.subject, to, delivered });
      }
      pruneDoses(draft, now);
    });
    summary.reminders += sent.length;
    summary.delivered += sent.filter((s) => s.delivered).length;
  }

  return summary;
}

export function createReminderRunner({ store, mailer, logger, clock = () => new Date() }) {
  let inFlight = null;

  const run = () => {
    inFlight ??= runReminderTick({ store, mailer, now: clock() })
      .then((summary) => {
        if (summary.reminders) logger.info('reminders sent', summary);
        return summary;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const start = (intervalMs) => {
    const tick = () => run().catch((error) => logger.error('reminder tick failed', { error: error.message }));
    const timer = setInterval(tick, intervalMs);
    timer.unref();
    tick();
    return () => clearInterval(timer);
  };

  return { run, start };
}
