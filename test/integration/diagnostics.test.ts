import assert from 'node:assert/strict';
import * as vscode from 'vscode';

/**
 * Diagnostics are published once typing pauses, so these wait for the editor to
 * settle rather than reading straight after an edit. They run against a document
 * that is never saved, like the rest of the integration suite.
 */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SETTING = 'undefinedConcepts';

const SPEC = [
  'The `$.screens.Splash` checks for an `$.auth.token`.',
  'Without one it stays on `$.screens.Splash`.',
  '',
  '#### `$.auth.token`',
  'The key a signed-in device holds.',
].join('\n');

async function openMarkdown(content: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  await vscode.window.showTextDocument(document);
  return document;
}

/** Pratyaya's own diagnostics, ignoring anything markdown itself reports. */
function reported(document: vscode.TextDocument): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(document.uri).filter((one) => one.source === 'Pratyaya');
}

/** Waits until the diagnostics look like `expected`, then returns them either way. */
async function settled(
  document: vscode.TextDocument,
  expected: (found: vscode.Diagnostic[]) => boolean
): Promise<vscode.Diagnostic[]> {
  for (let attempt = 0; attempt < 30 && !expected(reported(document)); attempt++) {
    await delay(100);
  }
  return reported(document);
}

/** The concept each diagnostic is about, read back out of its message. */
function concepts(found: vscode.Diagnostic[]): string[] {
  return found.map((one) => one.message.split('`')[1]);
}

async function setLevel(value: string | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration('pratyaya')
    .update(SETTING, value, vscode.ConfigurationTarget.Global);
}

suite('concepts referenced but never defined', () => {
  teardown(() => setLevel(undefined));

  test('every undefined concept is reported once, on its first reference', async () => {
    const document = await openMarkdown(SPEC);
    const found = await settled(document, (one) => one.length === 3);

    // `auth.token` has a definition; the other three concepts do not.
    assert.deepEqual(concepts(found), ['$.screens', '$.screens.Splash', '$.auth']);

    // All three sit in the first line: the second mention of Splash is left clean.
    assert.deepEqual(found.map((one) => one.range.start.line), [0, 0, 0]);
    assert.deepEqual(
      found.map((one) => document.getText(one.range)),
      ['screens', 'Splash', 'auth']
    );
  });

  test('they are informations, sourced to Pratyaya, by default', async () => {
    const document = await openMarkdown(SPEC);
    const found = await settled(document, (one) => one.length === 3);

    assert.ok(found.length > 0, 'nothing was reported');
    for (const one of found) {
      assert.equal(one.severity, vscode.DiagnosticSeverity.Information);
      assert.equal(one.code, 'undefined-concept');
    }
  });

  test('defining a concept clears its diagnostic, with no save', async () => {
    const document = await openMarkdown(SPEC);
    await settled(document, (one) => one.length === 3);

    const editor = await vscode.window.showTextDocument(document);
    const end = document.lineAt(document.lineCount - 1).range.end;
    await editor.edit((builder) =>
      builder.insert(end, '\n\n#### `$.screens.Splash`\nThe first screen.')
    );

    const found = await settled(document, (one) => one.length === 2);
    assert.deepEqual(concepts(found), ['$.screens', '$.auth']);
    assert.ok(document.isDirty, 'the document must still be unsaved');
  });

  test('the quick fix writes the definition and clears the report', async () => {
    const document = await openMarkdown(SPEC);
    const found = await settled(document, (one) => one.length === 3);
    const splash = found.find((one) => one.message.startsWith('`$.screens.Splash`'));
    assert.ok(splash, 'nothing was reported for `$.screens.Splash`');

    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      document.uri,
      splash.range,
      vscode.CodeActionKind.QuickFix.value
    );
    const fix = actions.find((one) => one.title === 'Define `$.screens.Splash`');
    assert.ok(fix, 'the quick fix was not offered');
    assert.ok(fix.edit, 'the quick fix carries no edit');
    assert.ok(await vscode.workspace.applyEdit(fix.edit));

    // It joins the definition already at the foot of the spec, and SPEC does not
    // close that one with a rule, so neither does this.
    assert.equal(document.getText(), SPEC + '\n\n#### `$.screens.Splash`\n\n\n');

    // The cursor is handed the empty line under the heading, and lands there.
    const body = (SPEC + '\n\n#### `$.screens.Splash`\n\n').length;
    assert.equal(fix.command?.command, 'pratyaya.revealDefinition');
    assert.deepEqual(fix.command?.arguments?.[1], body);

    await vscode.commands.executeCommand('pratyaya.revealDefinition', document.uri, body);
    const editor = vscode.window.visibleTextEditors.find(
      (one) => one.document.uri.toString() === document.uri.toString()
    );
    assert.ok(editor, 'the document is not in a visible editor');
    assert.equal(document.offsetAt(editor.selection.active), body);
    assert.equal(document.lineAt(editor.selection.active.line).text, '');
    assert.deepEqual(concepts(await settled(document, (one) => one.length === 2)), [
      '$.screens',
      '$.auth',
    ]);
    assert.ok(document.isDirty, 'the document must still be unsaved');
  });

  test('the setting silences them, and brings them back louder', async () => {
    const document = await openMarkdown(SPEC);
    await settled(document, (one) => one.length === 3);

    await setLevel('off');
    assert.deepEqual(await settled(document, (one) => one.length === 0), []);

    await setLevel('warning');
    const found = await settled(document, (one) => one.length === 3);
    assert.equal(found.length, 3);
    assert.equal(found[0].severity, vscode.DiagnosticSeverity.Warning);
  });
});
