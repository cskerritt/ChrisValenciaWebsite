import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import portfolio from '../../src/data/portfolio.json';

const ALLOWED_STYLES = [
  'illustrative',
  'neo-traditional',
  'new-school',
  'cover-up',
  'blackwork',
  'color',
] as const;

const MAX_ALT = 125;
const MAX_BYTES = 400_000;
const PUBLIC_DIR = resolve(__dirname, '../../public');

describe('portfolio manifest', () => {
  it('has 32 entries with unique ids', () => {
    expect(portfolio).toHaveLength(32);
    const ids = portfolio.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(portfolio)('$id has a non-empty alt of at most 125 characters', (entry) => {
    expect(entry.alt.trim().length).toBeGreaterThan(0);
    expect(entry.alt.length).toBeLessThanOrEqual(MAX_ALT);
  });

  it.each(portfolio)('$id has a title, placement and at least one style', (entry) => {
    expect(entry.title.trim().length).toBeGreaterThan(0);
    expect(entry.placement.trim().length).toBeGreaterThan(0);
    expect(entry.style.length).toBeGreaterThan(0);
  });

  it.each(portfolio)('$id uses only allowed style keys', (entry) => {
    for (const s of entry.style) {
      expect(ALLOWED_STYLES).toContain(s);
    }
    expect(new Set(entry.style).size).toBe(entry.style.length);
  });

  it.each(portfolio)('$id points at an image that exists under public/ and is under 400 KB', (entry) => {
    expect(entry.file).toBe(`/images/portfolio/${entry.id}.jpg`);
    const abs = resolve(PUBLIC_DIR, `.${entry.file}`);
    expect(existsSync(abs), `${abs} should exist`).toBe(true);
    expect(statSync(abs).size).toBeLessThanOrEqual(MAX_BYTES);
  });

  it.each(portfolio)('$id has positive integer dimensions with a longest edge of 1400', (entry) => {
    expect(Number.isInteger(entry.width) && entry.width > 0).toBe(true);
    expect(Number.isInteger(entry.height) && entry.height > 0).toBe(true);
    expect(Math.max(entry.width, entry.height)).toBe(1400);
  });

  it('marks exactly 8 pieces as featured', () => {
    expect(portfolio.filter((p) => p.featured === true)).toHaveLength(8);
  });

  it('gives every primary style page at least 4 pieces to show', () => {
    for (const key of ['illustrative', 'neo-traditional', 'new-school']) {
      const n = portfolio.filter((p) => (p.style as string[]).includes(key)).length;
      expect(n, `${key} should have >= 4 pieces`).toBeGreaterThanOrEqual(4);
    }
  });
});
