import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTree } from '../src/concepts';
import { legacyExpressions, upgradeLegacy } from '../src/legacy';

test('bare references in prose are wrapped in backticks', () => {
  assert.equal(
    upgradeLegacy('The $.screens.Splash checks for $.auth.token, then $.screens.Login.'),
    'The `$.screens.Splash` checks for `$.auth.token`, then `$.screens.Login`.'
  );
});

test('an old definition heading becomes a new one, and keeps its definition', () => {
  const upgraded = upgradeLegacy('#### $.auth.token\n\nA token, see $.screens.Login.\n\n---\n');
  assert.equal(upgraded, '#### `$.auth.token`\n\nA token, see `$.screens.Login`.\n\n---\n');
  assert.deepEqual(buildTree(upgraded), {
    auth: {
      '($)': 'auth',
      token: { '($)': 'token', '($->def)': 'A token, see `$.screens.Login`.\n\n' },
    },
    screens: { '($)': 'screens', Login: { '($)': 'Login' } },
  });
});

test('bare scope function calls are wrapped too, named in full', () => {
  assert.equal(upgradeLegacy('$->dump'), '`$->dump`');
  assert.equal(upgradeLegacy('$->define.auth.token'), '`$->define.auth.token`');
  assert.equal(upgradeLegacy('"($->def)": "x" and $->defined'), '"($->def)": "x" and $->defined');
});

test('the new style is left alone, so upgrading twice changes nothing more', () => {
  const text = 'Both `$.a.b` and `$->dump`, and #### `$.a`';
  assert.deepEqual(legacyExpressions(text), []);
  const once = upgradeLegacy('$.a and `$.b` and $.c');
  assert.equal(once, '`$.a` and `$.b` and `$.c`');
  assert.equal(upgradeLegacy(once), once);
});

test('inline code holding more than the expression is left alone', () => {
  for (const text of ['run `jq $.store.book` now', 'a ``x `$.b` y`` z', 'see `#### $.a.b`']) {
    assert.equal(upgradeLegacy(text), text);
  }
});

test('fenced code blocks are left alone', () => {
  const text = ['```bash', 'jq $.store.book', '```', '~~~', '$.a', '~~~', 'but $.b'].join('\n');
  assert.equal(upgradeLegacy(text), text.replace('but $.b', 'but `$.b`'));
});

test('an expression touching a stray backtick is left alone', () => {
  assert.equal(upgradeLegacy('`$.a.b'), '`$.a.b');
  assert.equal(upgradeLegacy('$.a.b`'), '$.a.b`');
});

test('an unmatched backtick does not hide what follows it', () => {
  assert.equal(upgradeLegacy('a stray ` then $.a.b'), 'a stray ` then `$.a.b`');
});

test('dollars that were never concepts are left alone', () => {
  const text = 'it costs $5 or $100, $x$ in maths, run $(pwd), the $ sign';
  assert.deepEqual(legacyExpressions(text), []);
});

test('offsets hold across CRLF line endings', () => {
  assert.equal(upgradeLegacy('a $.b\r\nc $.d\r\n'), 'a `$.b`\r\nc `$.d`\r\n');
});
