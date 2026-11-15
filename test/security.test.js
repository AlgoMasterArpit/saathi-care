import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateCircleCode, generatePasscode, hashPasscode, issueToken, readToken, safeEqual, verifyPasscode } from '../src/lib/security.js';

const SECRET = 'a'.repeat(64);

describe('passcodes', () => {
  it('hashes with a random salt and verifies only the right passcode', async () => {
    const first = await hashPasscode('246810');
    const second = await hashPasscode('246810');
    assert.notEqual(first, second);
    assert.match(first, /^scrypt\$/);
    assert.equal(await verifyPasscode('246810', first), true);
    assert.equal(await verifyPasscode('246811', first), false);
  });

  it('rejects malformed stored hashes', async () => {
    assert.equal(await verifyPasscode('246810', 'plain-text'), false);
  });

  it('generates readable circle codes and passcodes', () => {
    assert.match(generateCircleCode(), /^SA-[A-HJ-NP-Z2-9]{6}$/);
    assert.match(generatePasscode(), /^\d{4}-\d{4}$/);
  });
});

describe('session tokens', () => {
  it('round-trips claims before expiry', () => {
    const token = issueToken({ c: 'SA-ABC123', m: 'mem_1' }, SECRET, 1000, 0);
    assert.deepEqual(readToken(token, SECRET, 500), { c: 'SA-ABC123', m: 'mem_1', exp: 1000 });
  });

  it('rejects expired, tampered and foreign tokens', () => {
    const token = issueToken({ c: 'SA-ABC123', m: 'mem_1' }, SECRET, 1000, 0);
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ c: 'SA-OTHER1', m: 'mem_1', exp: 1000 })).toString('base64url');
    assert.equal(readToken(token, SECRET, 1000), null);
    assert.equal(readToken(`${forged}.${signature}`, SECRET, 500), null);
    assert.equal(readToken(`${payload}.${signature}`, 'b'.repeat(64), 500), null);
    assert.equal(readToken('garbage', SECRET, 500), null);
  });

  it('compares secrets in constant time without throwing on length mismatch', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abcd'), false);
  });
});
