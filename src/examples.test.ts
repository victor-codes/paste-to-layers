import { describe, expect, it } from 'vitest';
// @ts-ignore no @types/node installed
import { readdirSync, readFileSync } from 'node:fs';
// @ts-ignore no @types/node installed
import { join } from 'node:path';
import { convert } from './parse';

declare const __dirname: string;
const dir = join(__dirname, '..', 'examples');
const files = readdirSync(dir).filter((f: string) => /\.(tsx|jsx)$/.test(f));

describe('examples', () => {
  it('finds examples', () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    it(`converts ${f}`, () => {
      const { root } = convert(readFileSync(join(dir, f), 'utf8'));
      expect(root.kind).toBe('frame');
      if (root.kind === 'frame') expect(root.children.length).toBeGreaterThan(0);
    });
  }
});

describe('Paper exports convert without warnings', () => {
  for (const f of ['paper-tailwind.tsx', 'paper-inline.tsx', 'paper-banner-tailwind.tsx', 'paper-absolute.tsx', 'paper-centered-root.tsx']) {
    it(f, () => expect(convert(readFileSync(join(dir, f), 'utf8')).warnings).toEqual([]));
  }
});
