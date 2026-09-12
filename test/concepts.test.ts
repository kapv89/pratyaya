import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTree,
  conceptSpans,
  scopeFunctionsMatching,
  dumpText,
  parseContextAt,
  suggestionsFor,
  Context,
} from '../src/concepts';

/** Context at the end of `text`, which is where a typing user's cursor is. */
function contextAtEnd(text: string): Context {
  return parseContextAt(text, text.length);
}

/** Suggestions a user would see with their cursor at the end of `text`. */
function suggestAtEnd(text: string): string[] {
  const context = contextAtEnd(text);
  assert.equal(context.kind, 'path');
  if (context.kind !== 'path') {
    throw new Error('unreachable');
  }
  return suggestionsFor(buildTree(text), context.segments, context.partial);
}

test('a first path builds the tree', () => {
  assert.deepEqual(buildTree('The $.screens.Splash screen'), {
    screens: {
      '($)': 'screens',
      Splash: { '($)': 'Splash' },
    },
  });
});

test('a sibling path extends an existing node', () => {
  const tree = buildTree('$.screens.Splash then $.screens.NewUsername');
  assert.deepEqual(tree, {
    screens: {
      '($)': 'screens',
      Splash: { '($)': 'Splash' },
      NewUsername: { '($)': 'NewUsername' },
    },
  });
});

test('a second top-level branch is added alongside the first', () => {
  const tree = buildTree(
    '$.screens.Splash $.screens.NewUsername $.components.PrivateKey'
  );
  assert.deepEqual(tree, {
    screens: {
      '($)': 'screens',
      Splash: { '($)': 'Splash' },
      NewUsername: { '($)': 'NewUsername' },
    },
    components: {
      '($)': 'components',
      PrivateKey: { '($)': 'PrivateKey' },
    },
  });
});

test('paths nest to arbitrary depth', () => {
  assert.deepEqual(buildTree('$.a.b.c'), {
    a: { '($)': 'a', b: { '($)': 'b', c: { '($)': 'c' } } },
  });
});

test('repeating a path does not duplicate nodes', () => {
  const tree = buildTree('$.screens.Splash and again $.screens.Splash');
  assert.deepEqual(tree, {
    screens: { '($)': 'screens', Splash: { '($)': 'Splash' } },
  });
});

test('a bare marker contributes nothing', () => {
  assert.deepEqual(buildTree('$ and $->dump'), {});
});

test('"$." suggests the top-level keys', () => {
  assert.deepEqual(suggestAtEnd('$.screens.Splash\n\n$.'), ['screens']);
});

test('"$.screens." suggests that node\'s children', () => {
  assert.deepEqual(suggestAtEnd('$.screens.Splash\n\n$.screens.'), ['Splash']);
});

test('a bare marker is prose, not a completion context', () => {
  assert.equal(contextAtEnd('$.screens.Splash\n\n$').kind, 'none');
});

test('a marker used as a dollar sign is left alone', () => {
  for (const text of ['it costs $5', 'about $100', 'the $ sign', '$x$ in maths', 'run $(pwd)']) {
    assert.equal(contextAtEnd(text).kind, 'none', text);
  }
  assert.deepEqual(buildTree('it costs $5 and $100, run $(pwd)'), {});
  assert.deepEqual(conceptSpans('it costs $5 and $100'), []);
});

test('typing filters suggestions by prefix', () => {
  const prose = '$.screens.Splash $.screens.NewUsername\n\n';
  assert.deepEqual(suggestAtEnd(prose + '$.screens.S'), ['Splash']);
  assert.deepEqual(suggestAtEnd(prose + '$.screens.N'), ['NewUsername']);
  assert.deepEqual(suggestAtEnd(prose + '$.screens.'), ['Splash', 'NewUsername']);
  assert.deepEqual(suggestAtEnd(prose + '$.screens.Zz'), []);
});

test('filtering is case insensitive and never echoes the exact word typed', () => {
  const prose = '$.screens.Splash\n\n';
  assert.deepEqual(suggestAtEnd(prose + '$.screens.spl'), ['Splash']);
  assert.deepEqual(suggestAtEnd(prose + '$.screens.Splash'), []);
});

test('an unknown parent yields no suggestions', () => {
  assert.deepEqual(suggestAtEnd('$.screens.Splash\n\n$.nope.'), []);
});

test('a mid-word cursor still sees the word it is inside', () => {
  const text = '$.screens.Splash';
  const context = parseContextAt(text, text.length - 3);
  assert.deepEqual(context, { kind: 'path', exprStart: 0, segments: ['screens'], partial: 'Spl' });
  assert.deepEqual(suggestionsFor(buildTree(text), ['screens'], 'Spl'), ['Splash']);
});

test('malformed expressions are invalid', () => {
  for (const text of ['$.\\.*$', '$..', '$.a..b', '$.a.b/c', '$->du!']) {
    assert.equal(contextAtEnd(text).kind, 'invalid', text);
  }
});

test('an invalid expression stays invalid as more is typed', () => {
  assert.equal(contextAtEnd('$.\\.*$.screens').kind, 'invalid');
  assert.equal(contextAtEnd('$.\\.*$.screens.Splash').kind, 'invalid');
});

test('the function accessor is recognised while it is being typed', () => {
  assert.deepEqual(contextAtEnd('$-'), { kind: 'function', exprStart: 0, partial: '' });
  assert.deepEqual(contextAtEnd('$->'), { kind: 'function', exprStart: 0, partial: '' });
  assert.deepEqual(contextAtEnd('$->du'), { kind: 'function', exprStart: 0, partial: 'du' });
  assert.deepEqual(contextAtEnd('$->dump'), { kind: 'function', exprStart: 0, partial: 'dump' });
});

test('the function accessor offers the scope functions, filtered by prefix', () => {
  assert.deepEqual(scopeFunctionsMatching('').map((fn) => fn.name), ['dump']);
  assert.deepEqual(scopeFunctionsMatching('du').map((fn) => fn.name), ['dump']);
  assert.deepEqual(scopeFunctionsMatching('zz'), []);
});

test('scope functions sit beside root rather than inside it', () => {
  // `->` reaches a function, and functions never become data.
  assert.deepEqual(buildTree('$->dump and $.screens.Splash'), {
    screens: { '($)': 'screens', Splash: { '($)': 'Splash' } },
  });

  // `.` reaches data, so a concept may be called dump without colliding.
  assert.deepEqual(buildTree('$.dump'), { dump: { '($)': 'dump' } });
});

test('prose outside an expression is not a completion context', () => {
  assert.equal(contextAtEnd('just some words').kind, 'none');
  assert.equal(contextAtEnd('$.screens.Splash is a screen').kind, 'none');
});

test('an expression closed by punctuation stops completing', () => {
  assert.equal(contextAtEnd('see $.screens.Splash,').kind, 'none');
  assert.equal(contextAtEnd('see ($.screens.Splash)').kind, 'none');
  assert.equal(contextAtEnd('see $.screens.Splash.').kind, 'path');
});

test('the expression starts at the first marker of the run', () => {
  const context = contextAtEnd('word$.screens.');
  assert.deepEqual(context, { kind: 'path', exprStart: 4, segments: ['screens'], partial: '' });
});

test('dump renders the whole tree as formatted json', () => {
  const tree = buildTree('$.screens.Splash');
  assert.equal(
    dumpText(tree, false),
    ['{', '  "screens": {', '    "($)": "screens",', '    "Splash": {', '      "($)": "Splash"', '    }', '  }', '}'].join('\n')
  );
  assert.match(dumpText(tree, true), /^```json\n[\s\S]*\n```$/);
});

test('a dumped block does not pollute the tree', () => {
  const tree = buildTree('$.screens.Splash');
  assert.deepEqual(buildTree('$.screens.Splash\n\n' + dumpText(tree, true)), tree);
});

test('concept spans cover the whole expression and nothing after it', () => {
  const text = 'The $.screens.Splash screen';
  const spans = conceptSpans(text);
  assert.deepEqual(spans.map((span) => text.slice(span.start, span.end)), ['$.screens.Splash']);
});

test('concept spans stop at prose punctuation', () => {
  const text = 'see $.screens.Splash, then $.components.PrivateKey.';
  assert.deepEqual(
    conceptSpans(text).map((span) => text.slice(span.start, span.end)),
    ['$.screens.Splash', '$.components.PrivateKey']
  );
});

test('concept spans cover the dump accessor but not a bare marker', () => {
  const text = 'a $ and $->dump here';
  assert.deepEqual(
    conceptSpans(text).map((span) => text.slice(span.start, span.end)),
    ['$->dump']
  );
});

test('concept spans ignore junk in a malformed expression', () => {
  const text = '$.\\.*$.x';
  assert.deepEqual(
    conceptSpans(text).map((span) => text.slice(span.start, span.end)),
    ['$.x']
  );
});
