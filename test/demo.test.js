import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEMO_CODE, seedDemo } from '../src/demo.js';
import { createMemoryStore } from '../src/store/memory.js';

describe('demo circle', () => {
  it('seeds once, then refreshes only after it goes stale', async () => {
    const store = createMemoryStore();
    const start = new Date('2026-11-15T06:00:00Z');
    assert.equal(await seedDemo(store, start), true);
    await store.update(DEMO_CODE, (draft) => {
      draft.medications = [];
    });

    assert.equal(await seedDemo(store, new Date(start.getTime() + 60 * 60_000)), false);
    assert.equal((await store.get(DEMO_CODE)).medications.length, 0);

    const later = new Date(start.getTime() + 7 * 60 * 60_000);
    assert.equal(await seedDemo(store, later), true);
    const refreshed = await store.get(DEMO_CODE);
    assert.equal(refreshed.medications.length, 5);
    assert.equal(refreshed.seededAt, later.toISOString());
    assert.equal(refreshed.demo, true);
  });
});
