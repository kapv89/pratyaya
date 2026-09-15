import assert from 'node:assert/strict';
import * as vscode from 'vscode';

/**
 * These drive the real suggest widget - trigger, then accept - rather than
 * calling the provider directly.
 *
 * `vscode.executeCompletionItemProvider` returns what the provider handed back,
 * before VS Code filters it against the typed word and before it works out what
 * an accepted item actually inserts. Both of those steps can drop or rewrite a
 * suggestion, so an item that looks right in the provider's output can still be
 * missing from the widget or insert the wrong thing. That is what is tested here,
 * by looking at the document after an acceptance.
 */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Opens a document with the cursor at the end, or `back` characters before it. */
async function openMarkdown(content: string, back = 0): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  const editor = await vscode.window.showTextDocument(document);
  const end = document.lineAt(document.lineCount - 1).range.end.translate(0, -back);
  editor.selection = new vscode.Selection(end, end);
  return editor;
}

async function acceptSuggestion(nth = 0): Promise<void> {
  await vscode.commands.executeCommand('editor.action.triggerSuggest');
  await delay(700);
  for (let i = 0; i < nth; i++) {
    await vscode.commands.executeCommand('selectNextSuggestion');
    await delay(120);
  }
  await vscode.commands.executeCommand('acceptSelectedSuggestion');
  await delay(300);
}

suite('the suggest widget', () => {
  test('`$->dump is offered and inserts the tree', async () => {
    const editor = await openMarkdown('`$.screens.Splash`\n\n`$->dump');

    await acceptSuggestion();

    const text = editor.document.getText();
    assert.ok(!text.includes('$->dump'), `expression not replaced, document is:\n${text}`);
    assert.match(text, /```json/);
    assert.match(text, /"Splash"/);
  });

  test('`$->du is enough to insert the tree', async () => {
    const editor = await openMarkdown('`$.screens.Splash`\n\n`$->du');

    await acceptSuggestion();

    const text = editor.document.getText();
    assert.ok(!text.includes('$->du'), `expression not replaced, document is:\n${text}`);
    assert.match(text, /"Splash"/);
  });

  test('a closing backtick after the cursor goes with the dump', async () => {
    const editor = await openMarkdown('`$.screens.Splash`\n\n`$->dump`', 1);

    await acceptSuggestion();

    const text = editor.document.getText();
    assert.ok(!text.includes('$->dump'), `expression not replaced, document is:\n${text}`);
    assert.ok(text.endsWith('```'), `a stray backtick was left behind:\n${text}`);
  });

  test('accepting from the invalid state leaves the document untouched', async () => {
    const editor = await openMarkdown('`$.screens.Splash`\n\n`$.\\.*$');
    const before = editor.document.getText();

    await acceptSuggestion();

    assert.equal(editor.document.getText(), before, 'the invalid entry must never change the file');
  });

  test('a concept suggestion inserts just the concept name', async () => {
    const editor = await openMarkdown('`$.screens.Splash`\n\n`$.screens.Spl');

    await acceptSuggestion();

    assert.match(editor.document.getText(), /\n`\$\.screens\.Splash$/);
  });

  test('`$->define walks to a concept, and () rewrites the line', async () => {
    const editor = await openMarkdown('`$.screens.Splash`\n\n`$->define.screens');

    await acceptSuggestion();

    assert.match(editor.document.getText(), /\n#### `\$\.screens`$/);
  });

  test('the second choice is the . that walks a level deeper', async () => {
    const editor = await openMarkdown('`$.screens.Splash`\n\n`$->define.screens');

    await acceptSuggestion(1);

    const text = editor.document.getText();
    assert.ok(text.endsWith('`$->define.screens.'), `walk did not descend, got:\n${text}`);
    assert.ok(!text.includes('####'), 'the line should not have been rewritten');
  });

  test('define is not offered part way through a line', async () => {
    const editor = await openMarkdown('`$.screens.Splash`\n\nsee `$->define.screens');

    await acceptSuggestion();

    assert.ok(!editor.document.getText().includes('####'), 'define must need the line start');
  });

  test('a definition under a heading reaches the tree', async () => {
    const editor = await openMarkdown(
      [
        '`$.screens.Splash`',
        '',
        '#### `$.screens.Splash`',
        'The first screen.',
        '',
        '---',
        '',
        '`$->dump',
      ].join('\n')
    );

    await acceptSuggestion();

    const text = editor.document.getText();
    assert.match(text, /"\(\$->def\)": "The first screen\.\\n\\n"/);
  });

  test('the walk leaves out concepts that are already defined', async () => {
    const editor = await openMarkdown(
      [
        '`$.screens.Splash` `$.screens.Login`',
        '',
        '#### `$.screens.Splash`',
        'Already defined.',
        '',
        '---',
        '',
        '`$->define.screens.',
      ].join('\n')
    );

    await acceptSuggestion();

    const text = editor.document.getText();
    assert.ok(text.endsWith('`$->define.screens.Login'), `expected Login, got:\n${text}`);
  });
});
