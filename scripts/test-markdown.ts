/** Markdown in messages: what agents write, what must stay plain, and input built to hang or inject. */
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown, type Inline } from '../src/web/lib/markdown.ts';

const text = (value: string): Inline => ({ type: 'text', text: value });
const plain = (value: string) => assert.deepEqual(parseInline(value), [text(value)], value);

assert.deepEqual(parseInline('a **b `c`** d'), [
  text('a '),
  { type: 'strong', children: [text('b '), { type: 'code', text: 'c' }] },
  text(' d'),
]);
assert.deepEqual(parseInline('`**not bold**`'), [{ type: 'code', text: '**not bold**' }]);
assert.deepEqual(
  parseInline('*em* _em_ ~~x~~').map((n) => n.type),
  ['em', 'text', 'em', 'text', 'del'],
);
for (const value of ['snake_case_name', '2 * 3 * 4', '** open', 'src/**/*.ts', '__init__.py', 'a*b*c']) plain(value);

// Links: web only, so a message can neither run script nor open a local file.
assert.deepEqual(parseInline('[docs](https://a.b/c_(d))'), [
  { type: 'link', href: 'https://a.b/c_(d)', children: [text('docs')] },
]);
assert.deepEqual(parseInline('see https://a.b/c.'), [
  text('see '),
  { type: 'link', href: 'https://a.b/c', children: [text('https://a.b/c')] },
  text('.'),
]);
for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///c:/x', 'src/a.ts'])
  assert.ok(!JSON.stringify(parseInline(`[x](${href})`)).includes('"link"'), href);
plain('<img src=x onerror=alert(1)>');

const types = (source: string) => parseMarkdown(source).map((b) => b.type);
assert.deepEqual(types('# T\ntext\n- a\n- b\n\n> q\n\n---\n```ts\n# not a heading\n```\nend'), [
  'heading',
  'paragraph',
  'list',
  'quote',
  'rule',
  'code',
  'paragraph',
]);
assert.deepEqual(parseMarkdown('one\ntwo'), [{ type: 'paragraph', children: [text('one\ntwo')] }]);
assert.deepEqual(parseMarkdown('```\nopen'), [{ type: 'code', text: 'open' }]);

const [list] = parseMarkdown('3. a\n   more\n   - x\n     - y\n\n4. b');
assert.ok(list?.type === 'list');
assert.equal(list.start, 3);
assert.equal(list.items.length, 2);
assert.deepEqual(
  list.items[0]!.map((b) => b.type),
  ['paragraph', 'list'],
);
assert.equal(parseMarkdown('- a\n- b\n1. c').length, 2, 'bullets and numbers are two lists');

const [table] = parseMarkdown('| a | b |\n|---|:-:|\n| `x` | y \\| z |');
assert.ok(table?.type === 'table');
assert.deepEqual(table.rows, [[[{ type: 'code', text: 'x' }], [text('y | z')]]]);
assert.deepEqual(types('a | b\nplain'), ['paragraph'], 'a pipe alone is no table');

// Every input ends, and none takes long: a message can be 256 KiB.
const started = Date.now();
for (const part of ['**a ', '`', '[', '[a](', '> ', '- ', '~~x ', '| ', '_a ', '*a ', 'http://'])
  parseMarkdown(part.repeat(60_000 / part.length));
for (const unit of ['> ', '  - x\n', '|a|\n|-|\n', '1. a\n\n', '```\n', '- a\n']) parseMarkdown(unit.repeat(5_000));
parseMarkdown(Array.from({ length: 300 }, (_, i) => `${' '.repeat(i * 2)}- x`).join('\n'));
const took = Date.now() - started;
assert.ok(took < 5_000, `hostile input took ${took} ms`);

console.log(`Markdown checks passed (${took} ms on hostile input).`);
