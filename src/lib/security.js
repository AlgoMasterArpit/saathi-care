import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 32;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export async function hashPasscode(passcode) {
  const salt = randomBytes(16);
  const key = await scryptAsync(passcode.normalize('NFKC'), salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPasscode(passcode, stored) {
  const [scheme, salt, expected] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const expectedKey = Buffer.from(expected, 'base64url');
  const key = await scryptAsync(passcode.normalize('NFKC'), Buffer.from(salt, 'base64url'), expectedKey.length);
  return timingSafeEqual(key, expectedKey);
}

export function generateCircleCode() {
  let code = 'SA-';
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function generatePasscode() {
  const digits = String(randomInt(0, 100_000_000)).padStart(8, '0');
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

export function newId(prefix) {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueToken(claims, secret, ttlMs, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ ...claims, exp: now + ttlMs })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function readToken(token, secret, now = Date.now()) {
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature) return null;
  if (!safeEqual(signature, sign(payload, secret))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof claims.exp === 'number' && claims.exp > now ? claims : null;
  } catch {
    return null;
  }
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
