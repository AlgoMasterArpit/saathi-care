import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, isValidTimeZone, localDate, localTime, weekday, zonedToUtc } from '../src/lib/time.js';

describe('time helpers', () => {
  it('converts a wall-clock time in India to UTC', () => {
    assert.equal(zonedToUtc('2026-11-15', '08:30', 'Asia/Kolkata').toISOString(), '2026-11-15T03:00:00.000Z');
  });

  it('respects daylight saving in New York', () => {
    assert.equal(zonedToUtc('2026-07-01', '09:00', 'America/New_York').toISOString(), '2026-07-01T13:00:00.000Z');
    assert.equal(zonedToUtc('2026-12-01', '09:00', 'America/New_York').toISOString(), '2026-12-01T14:00:00.000Z');
  });

  it('reads the local date and time in a timezone', () => {
    const instant = new Date('2026-11-15T20:00:00Z');
    assert.equal(localDate(instant, 'Asia/Kolkata'), '2026-11-16');
    assert.equal(localTime(instant, 'Asia/Kolkata'), '01:30');
  });

  it('adds days across month boundaries', () => {
    assert.equal(addDays('2026-11-30', 1), '2026-12-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });

  it('returns the weekday of a date', () => {
    assert.equal(weekday('2026-11-15'), 0);
  });

  it('validates timezone names', () => {
    assert.equal(isValidTimeZone('Asia/Kolkata'), true);
    assert.equal(isValidTimeZone('Mars/Olympus'), false);
  });
});
