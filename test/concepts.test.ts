import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyze,
  buildTree,
  conceptAt,
  conceptSpans,
  definitionHeadings,
  dumpJson,
  dumpText,
  isConceptName,
  parseContextAt,
  pathActions,
  previewJson,
  referenceText,
  renameRanges,
  scopeFunction,
  scopeFunctionsMatching,
  startsLine,
  suggestionsFor,
  walkSuggestions,
  Context,
} from '../src/concepts';

const define = scopeFunction('define')!.path!;

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
  assert.deepEqual(buildTree('The `$.screens.Splash` screen'), {
    screens: {
      '($)': 'screens',
      Splash: { '($)': 'Splash' },
    },
  });
});

test('a sibling path extends an existing node', () => {
  const tree = buildTree('`$.screens.Splash` then `$.screens.NewUsername`');
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
    '`$.screens.Splash` `$.screens.NewUsername` `$.components.PrivateKey`'
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
  assert.deepEqual(buildTree('`$.a.b.c`'), {
    a: { '($)': 'a', b: { '($)': 'b', c: { '($)': 'c' } } },
  });
});

test('repeating a path does not duplicate nodes', () => {
  const tree = buildTree('`$.screens.Splash` and again `$.screens.Splash`');
  assert.deepEqual(tree, {
    screens: { '($)': 'screens', Splash: { '($)': 'Splash' } },
  });
});

test('a bare marker contributes nothing', () => {
  assert.deepEqual(buildTree('$ and `$->dump`'), {});
});

test('a reference outside backticks is not a reference', () => {
  assert.deepEqual(buildTree('$.screens.Splash and #### $.auth.token'), {});
  assert.deepEqual(definitionHeadings('#### $.auth.token\nA token.'), []);
  assert.deepEqual(conceptSpans('$.screens.Splash and $->dump'), []);
  assert.equal(contextAtEnd('$.').kind, 'none');
  assert.equal(contextAtEnd('$->').kind, 'none');
});

test('a reference is only complete once its backtick closes it', () => {
  assert.deepEqual(buildTree('`$.screens.Splash'), {});
  assert.deepEqual(buildTree('`$.screens.Splash`'), buildTree('`$.screens` `$.screens.Splash`'));
});

test('references are written as inline code', () => {
  assert.equal(referenceText(['auth', 'token']), '`$.auth.token`');
  assert.equal(define.call(['auth', 'token']), '#### `$.auth.token`');
});

test('"`$." suggests the top-level keys', () => {
  assert.deepEqual(suggestAtEnd('`$.screens.Splash`\n\n`$.'), ['screens']);
});

test('"`$.screens." suggests that node\'s children', () => {
  assert.deepEqual(suggestAtEnd('`$.screens.Splash`\n\n`$.screens.'), ['Splash']);
});

test('a bare opener is prose, not a completion context', () => {
  assert.equal(contextAtEnd('`$.screens.Splash`\n\n`$').kind, 'none');
});

test('a marker used as a dollar sign is left alone', () => {
  for (const text of ['it costs $5', 'about $100', 'the $ sign', '$x$ in maths', 'run $(pwd)', '`$5', '`$(pwd)']) {
    assert.equal(contextAtEnd(text).kind, 'none', text);
  }
  assert.deepEqual(buildTree('it costs $5 and `$100`, run `$(pwd)`'), {});
  assert.deepEqual(conceptSpans('it costs $5 and `$100`'), []);
});

test('typing filters suggestions by prefix', () => {
  const prose = '`$.screens.Splash` `$.screens.NewUsername`\n\n';
  assert.deepEqual(suggestAtEnd(prose + '`$.screens.S'), ['Splash']);
  assert.deepEqual(suggestAtEnd(prose + '`$.screens.N'), ['NewUsername']);
  assert.deepEqual(suggestAtEnd(prose + '`$.screens.'), ['Splash', 'NewUsername']);
  assert.deepEqual(suggestAtEnd(prose + '`$.screens.Zz'), []);
});

test('filtering is case insensitive and never echoes the exact word typed', () => {
  const prose = '`$.screens.Splash`\n\n';
  assert.deepEqual(suggestAtEnd(prose + '`$.screens.spl'), ['Splash']);
  assert.deepEqual(suggestAtEnd(prose + '`$.screens.Splash'), []);
});

test('an unknown parent yields no suggestions', () => {
  assert.deepEqual(suggestAtEnd('`$.screens.Splash`\n\n`$.nope.'), []);
});

test('a mid-word cursor still sees the word it is inside', () => {
  const text = '`$.screens.Splash`';
  const context = parseContextAt(text, text.length - 4);
  assert.deepEqual(context, { kind: 'path', exprStart: 0, segments: ['screens'], partial: 'Spl' });
  assert.deepEqual(suggestionsFor(buildTree(text), ['screens'], 'Spl'), ['Splash']);
});

test('malformed expressions are invalid', () => {
  for (const text of ['`$.\\.*$', '`$..', '`$.a..b', '`$.a.b/c', '`$->du/mp']) {
    assert.equal(contextAtEnd(text).kind, 'invalid', text);
  }
});

test('an invalid expression stays invalid as more is typed', () => {
  assert.equal(contextAtEnd('`$.\\.*$.screens').kind, 'invalid');
  assert.equal(contextAtEnd('`$.\\.*$.screens.Splash').kind, 'invalid');
});

test('the function accessor is recognised while it is being typed', () => {
  assert.deepEqual(contextAtEnd('`$-'), { kind: 'function', exprStart: 0, partial: '' });
  assert.deepEqual(contextAtEnd('`$->'), { kind: 'function', exprStart: 0, partial: '' });
  assert.deepEqual(contextAtEnd('`$->du'), { kind: 'function', exprStart: 0, partial: 'du' });
  assert.deepEqual(contextAtEnd('`$->dump'), { kind: 'function', exprStart: 0, partial: 'dump' });
});

test('the function accessor offers the scope functions, filtered by prefix', () => {
  assert.deepEqual(scopeFunctionsMatching('').map((fn) => fn.name), ['dump', 'define']);
  assert.deepEqual(scopeFunctionsMatching('d').map((fn) => fn.name), ['dump', 'define']);
  assert.deepEqual(scopeFunctionsMatching('du').map((fn) => fn.name), ['dump']);
  assert.deepEqual(scopeFunctionsMatching('de').map((fn) => fn.name), ['define']);
  assert.deepEqual(scopeFunctionsMatching('zz'), []);
});

test('prose punctuation closes a function expression too', () => {
  assert.equal(contextAtEnd('run (`$->dump)').kind, 'none');
  assert.equal(contextAtEnd('see `$->define.auth,').kind, 'none');
});

test('scope functions sit beside root rather than inside it', () => {
  // `->` reaches a function, and functions never become data.
  assert.deepEqual(buildTree('`$->dump` and `$.screens.Splash`'), {
    screens: { '($)': 'screens', Splash: { '($)': 'Splash' } },
  });

  // `.` reaches data, so a concept may be called dump without colliding.
  assert.deepEqual(buildTree('`$.dump`'), { dump: { '($)': 'dump' } });
});

test('prose outside an expression is not a completion context', () => {
  assert.equal(contextAtEnd('just some words').kind, 'none');
  assert.equal(contextAtEnd('`$.screens.Splash` is a screen').kind, 'none');
});

test('an expression closed by its backtick or by punctuation stops completing', () => {
  assert.equal(contextAtEnd('see `$.screens.Splash`').kind, 'none');
  assert.equal(contextAtEnd('see `$.screens.Splash`.').kind, 'none');
  assert.equal(contextAtEnd('see `$->dump`').kind, 'none');
  assert.equal(contextAtEnd('see `$.screens.Splash,').kind, 'none');
  assert.equal(contextAtEnd('see (`$.screens.Splash)').kind, 'none');
  assert.equal(contextAtEnd('see `$.screens.Splash.').kind, 'path');
});

test('the expression starts at the last opener of the run', () => {
  assert.deepEqual(contextAtEnd('word`$.screens.'), {
    kind: 'path',
    exprStart: 4,
    segments: ['screens'],
    partial: '',
  });
  assert.deepEqual(contextAtEnd('`$.a`/`$.b.'), { kind: 'path', exprStart: 6, segments: ['b'], partial: '' });
});

test('dump renders the whole tree as formatted json', () => {
  const tree = buildTree('`$.screens.Splash`');
  assert.equal(
    dumpText(tree, false),
    ['{', '  "screens": {', '    "($)": "screens",', '    "Splash": {', '      "($)": "Splash"', '    }', '  }', '}'].join('\n')
  );
  assert.match(dumpText(tree, true), /^```json\n[\s\S]*\n```$/);
});

test('a dumped block does not pollute the tree', () => {
  const tree = buildTree('`$.screens.Splash`');
  assert.deepEqual(buildTree('`$.screens.Splash`\n\n' + dumpText(tree, true)), tree);
});

test('concept spans cover the whole expression, backticks included, and nothing after it', () => {
  const text = 'The `$.screens.Splash` screen';
  const spans = conceptSpans(text);
  assert.deepEqual(spans.map((span) => text.slice(span.start, span.end)), ['`$.screens.Splash`']);
});

test('concept spans stop at prose punctuation', () => {
  const text = 'see `$.screens.Splash`, then `$.components.PrivateKey`.';
  assert.deepEqual(
    conceptSpans(text).map((span) => text.slice(span.start, span.end)),
    ['`$.screens.Splash`', '`$.components.PrivateKey`']
  );
});

test('concept spans cover a function, closed or not, but not a bare marker', () => {
  const text = 'a $ and `$->dump` here and `$->du';
  assert.deepEqual(
    conceptSpans(text).map((span) => text.slice(span.start, span.end)),
    ['`$->dump`', '`$->du']
  );
});

test('concept spans ignore a malformed or unclosed reference', () => {
  const text = '`$.\\.*$` `$.x` `$.y';
  assert.deepEqual(
    conceptSpans(text).map((span) => text.slice(span.start, span.end)),
    ['`$.x`']
  );
});

// --- $->define -------------------------------------------------------------

test('the define walk is parsed level by level', () => {
  assert.deepEqual(contextAtEnd('`$->define'), { kind: 'function', exprStart: 0, partial: 'define' });
  assert.deepEqual(contextAtEnd('`$->define.'), {
    kind: 'functionPath',
    exprStart: 0,
    name: 'define',
    segments: [],
    partial: '',
  });
  assert.deepEqual(contextAtEnd('`$->define.au'), {
    kind: 'functionPath',
    exprStart: 0,
    name: 'define',
    segments: [],
    partial: 'au',
  });
  assert.deepEqual(contextAtEnd('`$->define.auth.web'), {
    kind: 'functionPath',
    exprStart: 0,
    name: 'define',
    segments: ['auth'],
    partial: 'web',
  });
});

test('only a path function may be followed by a path', () => {
  assert.equal(contextAtEnd('`$->dump.screens').kind, 'invalid');
  assert.equal(contextAtEnd('`$->nope.screens').kind, 'invalid');
});

test('the walk suggests concepts at each level', () => {
  const doc = '`$.auth.token` `$.auth.web` `$.screens.Splash`\n\n';
  const tree = buildTree(doc);

  const atRoot = contextAtEnd(doc + '`$->define.');
  assert.equal(atRoot.kind, 'functionPath');
  if (atRoot.kind !== 'functionPath') throw new Error('unreachable');
  assert.deepEqual(walkSuggestions(define, tree, atRoot.segments, atRoot.partial), ['auth', 'screens']);

  const typing = contextAtEnd(doc + '`$->define.s');
  assert.equal(typing.kind, 'functionPath');
  if (typing.kind !== 'functionPath') throw new Error('unreachable');
  assert.deepEqual(walkSuggestions(define, tree, typing.segments, typing.partial), ['screens']);

  const nested = contextAtEnd(doc + '`$->define.auth.');
  assert.equal(nested.kind, 'functionPath');
  if (nested.kind !== 'functionPath') throw new Error('unreachable');
  assert.deepEqual(walkSuggestions(define, tree, nested.segments, nested.partial), ['token', 'web']);
});

test('() appears on a real concept, and . only when it has children', () => {
  const tree = buildTree('`$.auth.token` `$.screens`');

  assert.deepEqual(pathActions(define, tree, [], 'auth'), { call: true, descend: true });
  assert.deepEqual(pathActions(define, tree, [], 'screens'), { call: true, descend: false });
  assert.deepEqual(pathActions(define, tree, ['auth'], 'token'), { call: true, descend: false });

  // Nothing to apply yet: mid-word, after a trailing dot, or an unknown name.
  assert.deepEqual(pathActions(define, tree, [], 'au'), { call: false, descend: false });
  assert.deepEqual(pathActions(define, tree, [], ''), { call: false, descend: false });
  assert.deepEqual(pathActions(define, tree, ['auth'], 'nope'), { call: false, descend: false });
});

test('define is only offered at the start of a line', () => {
  assert.equal(startsLine('`$->define.', 0), true);
  assert.equal(startsLine('  \t`$->define.', 3), true);
  assert.equal(startsLine('see `$->define.', 4), false);
  assert.equal(startsLine('a line\n`$->define.', 7), true);
});

test('a definition runs to the next rule', () => {
  const text = ['#### `$.screens.Splash`', 'The first screen.', '', '---', 'after'].join('\n');
  const [heading] = definitionHeadings(text);
  assert.deepEqual(heading.segments, ['screens', 'Splash']);
  assert.equal(heading.body, 'The first screen.\n\n');
  assert.equal(text.slice(heading.start, heading.end), '#### `$.screens.Splash`');
});

test('a definition runs to the next heading of level 1 to 4', () => {
  for (const terminator of ['# One', '## Two', '### Three', '#### `$.other`']) {
    const text = ['#### `$.a`', 'body', terminator, 'after'].join('\n');
    assert.equal(definitionHeadings(text)[0].body, 'body\n', terminator);
  }
  // Deeper headings are part of the definition, not the end of it.
  const text = ['#### `$.a`', 'body', '##### Five', 'more'].join('\n');
  assert.equal(definitionHeadings(text)[0].body, 'body\n##### Five\nmore');
});

test('headings and rules inside a fenced code block do not end a definition', () => {
  const text = ['#### `$.a`', 'Run:', '```bash', '# install', 'npm i', '---', '```', 'done', '## Next'].join('\n');
  assert.equal(definitionHeadings(text)[0].body, 'Run:\n```bash\n# install\nnpm i\n---\n```\ndone\n');
});

test('a fence closes only on a matching run at least as long as the opener', () => {
  const text = ['#### `$.a`', '~~~~', '```', '# still code', '~~~', '# still code', '~~~~', '# end'].join('\n');
  assert.equal(definitionHeadings(text)[0].body, '~~~~\n```\n# still code\n~~~\n# still code\n~~~~\n');
  // A backtick run with a backtick after it is inline code, not a fence.
  const inline = ['#### `$.a`', '``` `x` ```', '# end'].join('\n');
  assert.equal(definitionHeadings(inline)[0].body, '``` `x` ```\n');
});

test('an indented fence, as in a list item, counts', () => {
  const text = ['#### `$.a`', '1. Run:', '   ```bash', '   # install', '   ```', '# end'].join('\n');
  assert.equal(definitionHeadings(text)[0].body, '1. Run:\n   ```bash\n   # install\n   ```\n');
});

test('a fence that is never closed runs to the end of the document', () => {
  const text = ['#### `$.a`', '```', '# code', '---'].join('\n');
  assert.equal(definitionHeadings(text)[0].body, '```\n# code\n---');
});

test('a definition heading inside a fenced code block is not a definition', () => {
  const text = ['```markdown', '#### `$.a`', 'body', '```'].join('\n');
  assert.deepEqual(definitionHeadings(text), []);
  assert.deepEqual(buildTree(text), { a: { '($)': 'a' } }); // still a reference
});

test('a definition drops one blank line after its heading', () => {
  assert.equal(definitionHeadings('#### `$.a`\n\nbody\n---')[0].body, 'body\n');
  assert.equal(definitionHeadings('#### `$.a`\n\n\nbody\n---')[0].body, '\nbody\n');
  assert.equal(definitionHeadings('#### `$.a`\nbody\n---')[0].body, 'body\n');
  assert.equal(definitionHeadings('#### `$.a`\n\nbody')[0].body, 'body');
});

test('a definition running to the end of the document drops its last newline', () => {
  assert.equal(definitionHeadings('#### `$.a`\nbody\n')[0].body, 'body');
  assert.equal(definitionHeadings('#### `$.a`\nbody')[0].body, 'body');
  assert.equal(definitionHeadings('#### `$.a`\nbody\n\n')[0].body, 'body\n');
  assert.equal(definitionHeadings('#### `$.a`')[0].body, '');
});

test('a definition is stored on its concept, beside the name', () => {
  const text = ['`$.screens.Splash` is a screen.', '', '#### `$.screens.Splash`', 'The first screen.'].join('\n');
  assert.deepEqual(buildTree(text), {
    screens: {
      '($)': 'screens',
      Splash: { '($)': 'Splash', '($->def)': 'The first screen.' },
    },
  });
});

test('a definition heading declares its concept on its own', () => {
  assert.deepEqual(buildTree('#### `$.auth.token`\nA token.'), {
    auth: { '($)': 'auth', token: { '($)': 'token', '($->def)': 'A token.' } },
  });
});

test('definitions are part of the dump', () => {
  const json = dumpText(buildTree('#### `$.a`\nbody'), false);
  assert.match(json, /"\(\$->def\)": "body"/);
});

test('a dump written back into the document adds no concepts', () => {
  const text = '#### `$.a`\nbody\n---\n';
  const withDump = `${text}\n${dumpText(buildTree(text), true)}\n`;
  assert.deepEqual(buildTree(withDump), buildTree(text));
});

test('the last definition of a concept wins', () => {
  const text = ['#### `$.a`', 'first', '---', '#### `$.a`', 'second'].join('\n');
  const tree = buildTree(text) as { a: Record<string, string> };
  assert.equal(tree.a['($->def)'], 'second');
});

test('a definition heading is not mistaken for one when it is malformed', () => {
  assert.deepEqual(definitionHeadings('### `$.a`\nbody'), []); // three hashes
  assert.deepEqual(definitionHeadings('##### `$.a`\nbody'), []); // five
  assert.deepEqual(definitionHeadings('#### `$.a` trailing words\nbody'), []);
  assert.deepEqual(definitionHeadings('#### `$.a trailing`\nbody'), []);
  assert.deepEqual(definitionHeadings('#### not-a-concept\nbody'), []);
});

/** Applies a rename the way the editor does, writing the new name over each range. */
function rename(text: string, path: string[], newName: string): string {
  return renameRanges(text, path)
    .reverse()
    .reduce((out, range) => out.slice(0, range.start) + newName + out.slice(range.end), text);
}

test('the concept name under the cursor is found from either side of it', () => {
  const text = 'See `$.screens.Splash` now';
  const screens = { path: ['screens'], start: 7, end: 14 };
  const splash = { path: ['screens', 'Splash'], start: 15, end: 21 };
  assert.deepEqual(conceptAt(text, 7), screens);
  assert.deepEqual(conceptAt(text, 14), screens);
  assert.deepEqual(conceptAt(text, 18), splash);
  assert.deepEqual(conceptAt(text, 21), splash);
});

test('the backtick, the $, prose and scope functions are not concept names to rename', () => {
  const text = 'See `$.screens.Splash` now';
  assert.equal(conceptAt(text, 4), undefined); // before the backtick
  assert.equal(conceptAt(text, 5), undefined); // between the backtick and the $
  assert.equal(conceptAt(text, 6), undefined); // between the $ and the dot
  assert.equal(conceptAt(text, 23), undefined); // prose
  assert.equal(conceptAt('`$->define.screens`', 13), undefined);
});

test('renaming a concept renames it in every reference through it, and nothing else', () => {
  const text = [
    'The `$.screens.Splash` has a `$.screens.Splash.logo`,',
    '#### `$.screens.Splash`',
    'Not `$.other.Splash`, nor `$.screens.SplashV2`.',
    '```',
    '`$.screens.Splash`',
    '```',
  ].join('\n');
  assert.equal(
    rename(text, ['screens', 'Splash'], 'Launch'),
    [
      'The `$.screens.Launch` has a `$.screens.Launch.logo`,',
      '#### `$.screens.Launch`',
      'Not `$.other.Splash`, nor `$.screens.SplashV2`.',
      '```',
      '`$.screens.Launch`',
      '```',
    ].join('\n')
  );
});

test('renaming a top-level concept moves everything beneath it', () => {
  assert.equal(
    rename('`$.screens.Splash`, `$.screens.Login` and `$.screen`', ['screens'], 'pages'),
    '`$.pages.Splash`, `$.pages.Login` and `$.screen`'
  );
});

test('a definition stays with its concept through a rename', () => {
  assert.deepEqual(buildTree(rename('#### `$.auth.token`\nA token.', ['auth', 'token'], 'key')), {
    auth: { '($)': 'auth', key: { '($)': 'key', '($->def)': 'A token.' } },
  });
});

test('renaming onto an existing sibling merges the two', () => {
  const text = '`$.ui.LoginButton.icon` and `$.ui.login-button.label`';
  assert.deepEqual(buildTree(rename(text, ['ui', 'LoginButton'], 'login-button')), {
    ui: {
      '($)': 'ui',
      'login-button': {
        '($)': 'login-button',
        icon: { '($)': 'icon' },
        label: { '($)': 'label' },
      },
    },
  });
});

test('a concept name is letters, digits, _ and - only', () => {
  for (const name of ['Splash', 'login-button', 'v2_token', '9']) {
    assert.equal(isConceptName(name), true, name);
  }
  for (const name of ['', 'two words', 'a.b', '$x', 'naïve', 'a`b']) {
    assert.equal(isConceptName(name), false, name);
  }
});

test('a definition body is not scanned away from the concepts inside it', () => {
  const tree = buildTree('#### `$.a`\nSee `$.b.c` for more.');
  assert.deepEqual(Object.keys(tree), ['a', 'b']);
});

test('the define expression itself never becomes a concept', () => {
  assert.deepEqual(buildTree('`$->define.screens.Splash`'), {});
});

test('the walk leaves out a concept that is already defined', () => {
  const tree = buildTree(
    ['`$.screens.Splash` `$.screens.Login`', '', '#### `$.screens.Splash`', 'Defined.', '---'].join('\n')
  );
  assert.deepEqual(walkSuggestions(define, tree, ['screens'], ''), ['Login']);
  assert.deepEqual(pathActions(define, tree, ['screens'], 'Splash'), { call: false, descend: false });
});

test('a defined concept stays walkable while something beneath it is not', () => {
  const tree = buildTree(['`$.auth.token`', '', '#### `$.auth`', 'Defined.', '---'].join('\n'));
  assert.deepEqual(walkSuggestions(define, tree, [], ''), ['auth']);
  assert.deepEqual(pathActions(define, tree, [], 'auth'), { call: false, descend: true });
  assert.deepEqual(walkSuggestions(define, tree, ['auth'], ''), ['token']);
});

test('a fully defined branch drops out of the walk', () => {
  const tree = buildTree(['#### `$.auth`', 'A.', '---', '#### `$.auth.token`', 'T.', '---'].join('\n'));
  assert.deepEqual(walkSuggestions(define, tree, [], ''), []);
  assert.deepEqual(pathActions(define, tree, [], 'auth'), { call: false, descend: false });
});

test('an empty definition still counts as defined', () => {
  const tree = buildTree(['#### `$.a`', '---', '`$.b`'].join('\n'));
  assert.deepEqual(walkSuggestions(define, tree, [], ''), ['b']);
});

test('ordinary `$. completion still offers defined concepts', () => {
  const tree = buildTree(
    ['`$.screens.Splash` `$.screens.Login`', '', '#### `$.screens.Splash`', 'Defined.', '---'].join('\n')
  );
  assert.deepEqual(suggestionsFor(tree, ['screens'], ''), ['Splash', 'Login']);
});

// --- scale -------------------------------------------------------------------

test('analyze agrees with buildTree and finds what to colour', () => {
  const text = ['`$.screens.Splash` and `$.auth.token`', '', '#### `$.auth.token`', 'A token.'].join('\n');
  const analysis = analyze(text);
  const slice = (span: { start: number; end: number }) => text.slice(span.start, span.end);

  assert.deepEqual(analysis.tree, buildTree(text));
  assert.deepEqual(analysis.spans.map(slice), ['`$.screens.Splash`', '`$.auth.token`', '`$.auth.token`']);
  assert.deepEqual(analysis.headingSpans.map(slice), ['#### `$.auth.token`']);
});

test('typing prose changes neither key, so nothing downstream reruns', () => {
  const before = analyze('Intro `$.screens.Splash` here.\n\n#### `$.a`\nBody.');
  const after = analyze('Intro text `$.screens.Splash` here, and more.\n\n#### `$.a`\nBody.');
  assert.equal(after.treeKey, before.treeKey);
  assert.equal(after.spanKey, before.spanKey);
});

test('editing a reference changes both keys', () => {
  const before = analyze('See `$.screens.Splash`.');
  const after = analyze('See `$.screens.Splashy`.');
  assert.notEqual(after.treeKey, before.treeKey);
  assert.notEqual(after.spanKey, before.spanKey);
});

test('editing a definition body changes the tree but not what is coloured', () => {
  const before = analyze('#### `$.a`\nBody.');
  const after = analyze('#### `$.a`\nBody, edited.');
  assert.notEqual(after.treeKey, before.treeKey);
  assert.equal(after.spanKey, before.spanKey);
});

test('a small concept previews in full', () => {
  const tree = buildTree('`$.a.b`');
  assert.equal(previewJson(tree), dumpJson(tree));
});

test('a large concept previews cut short, saying how much is hidden', () => {
  const tree = buildTree(Array.from({ length: 200 }, (_, i) => '`$.big.c' + i + '`').join(' '));
  const preview = previewJson(tree, 40, 2000);
  const lines = preview.split('\n');

  assert.ok(lines.length <= 41, `at most 40 lines and the note, got ${lines.length}`);
  assert.ok(preview.length <= 2100, `stays near the character cap, got ${preview.length}`);
  assert.match(lines[lines.length - 1], /^… \d+ more lines$/);
});

test('a line too long for the preview is cut rather than dropped', () => {
  const tree = buildTree('#### `$.a`\n' + 'word '.repeat(2000));
  const preview = previewJson(tree, 40, 500);
  assert.match(preview, /"\(\$->def\)": "word word/);
  assert.ok(preview.length <= 600, `got ${preview.length}`);
});
