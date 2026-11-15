import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../public/${path}`, import.meta.url), 'utf8');
const html = read('index.html');
const css = read('css/styles.css');
const scripts = readdirSync(new URL('../public/js/', import.meta.url)).map((file) => ({ file, source: read(`js/${file}`) }));

describe('accessible app shell', () => {
  it('declares language, viewport and a descriptive title', () => {
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.doesNotMatch(html, /maximum-scale|user-scalable=no/);
    assert.match(html, /<title>[^<]{10,}<\/title>/);
  });

  it('offers a skip link to a focusable main landmark', () => {
    assert.match(html, /<a class="skip-link" href="#main">/);
    assert.match(html, /<main id="main" tabindex="-1">/);
    assert.match(html, /<header[\s>]/);
    assert.match(html, /<footer[\s>]/);
    assert.match(html, /<nav [^>]*aria-label=/);
  });

  it('announces status changes through a polite live region', () => {
    assert.match(html, /role="status" aria-live="polite"/);
  });

  it('gives every image alternative text and every control an accessible name', () => {
    for (const img of html.match(/<img [^>]*>/g) ?? []) assert.match(img, /alt="/);
    for (const button of html.match(/<button[^>]*>[^<]*<\/button>/g) ?? []) {
      assert.ok(/aria-label="/.test(button) || />[^<\s][^<]*</.test(button), button);
    }
  });

  it('labels the display controls and exposes their state', () => {
    assert.match(html, /role="group" aria-label="Display settings"/);
    assert.equal((html.match(/aria-pressed=/g) ?? []).length, 4);
  });
});

describe('accessible styles', () => {
  it('respects reduced motion and shows visible focus', () => {
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /:focus-visible/);
  });

  it('keeps touch targets at least 44px', () => {
    assert.match(css, /min-height:\s*44px/);
    assert.match(css, /min-width:\s*44px/);
  });

  it('ships a high contrast theme and a print stylesheet', () => {
    assert.match(css, /contrast/);
    assert.match(css, /@media print/);
  });

  it('hides content visually without hiding it from screen readers', () => {
    assert.match(css, /\.visually-hidden\s*\{[^}]*clip/);
  });
});

describe('safe, accessible client code', () => {
  it('never injects markup with innerHTML or inline handlers', () => {
    for (const { file, source } of scripts) {
      assert.doesNotMatch(source, /\.innerHTML\s*=|insertAdjacentHTML|document\.write/, file);
      assert.doesNotMatch(source, /\bon(click|load|error)\s*=\s*['"]/, file);
    }
  });

  it('keeps html free of inline scripts and styles so the strict CSP holds', () => {
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
    assert.doesNotMatch(html, /\sstyle="/);
  });

  it('moves focus and announces navigation for keyboard and screen reader users', () => {
    const app = scripts.find((s) => s.file === 'app.js').source;
    assert.match(app, /\.focus\(/);
    assert.match(app, /aria-selected|aria-current/);
    assert.match(app, /ArrowRight|ArrowLeft/);
  });

  it('opens links in new tabs safely and says so to screen readers', () => {
    for (const { file, source } of scripts) {
      for (const link of source.match(/target: '_blank'[^)]*/g) ?? []) {
        assert.match(link, /rel: 'noopener noreferrer'/, file);
      }
    }
    const care = scripts.find((s) => s.file === 'care.js').source;
    assert.match(care, /opens in a new tab/);
  });
});
