import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sheets = ['style.css', 'help.css'].map(name => ({ name, css: readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8') }));

test('shared visual roles use tokens rather than page-specific literals', () => {
  for (const { name, css } of sheets) {
    for (const match of css.matchAll(/(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
      const [, property, value] = match;
      if (property.startsWith('--')) continue;
      const location = `${name}:${css.slice(0, match.index).split('\n').length} ${property}: ${value}`;
      if (/^(font-size|font-weight|font-family|font|border-radius|outline|outline-offset|box-shadow)$/.test(property)) {
        assert.ok(!/(?:\d*\.)?\d+(?:px|rem|em)|\b[456]00\b/.test(value), location);
      }
      if (/^(color|background|background-color|border(?:-(?:top|right|bottom|left))?)$/.test(property)) {
        assert.ok(!/#(?:[\da-f]{3,8})\b|\b(?:rgb|hsl|light-dark)\(/i.test(value), location);
      }
      if (/^(padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block))?$/.test(property)) {
        // The screen-reader-only utility uses an off-screen 1px box, not visual spacing.
        assert.ok(!/\d+px/.test(value) || property === 'margin' && value === '-1px', location);
      }
    }
  }
});

test('visual token references are defined and contain no dependency cycles', () => {
  const css = sheets.map(sheet => sheet.css).join('\n');
  const definitions = new Map<string, string[]>();
  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
    definitions.set(name, [...(definitions.get(name) || []), value]);
  }
  const references = (value: string) => [...value.matchAll(/var\((--[\w-]+)/g)].map(match => match[1]);
  for (const name of references(css)) assert.ok(definitions.has(name), `Undefined token ${name}`);
  const visit = (name: string, path: string[]) => {
    assert.ok(!path.includes(name), `Cyclic tokens: ${[...path, name].join(' → ')}`);
    for (const value of definitions.get(name) || []) for (const reference of references(value)) visit(reference, [...path, name]);
  };
  for (const name of definitions.keys()) visit(name, []);
});
