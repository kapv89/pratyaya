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

async function openMarkdown(content: string): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  const editor = await vscode.window.showTextDocument(document);
  const end = document.lineAt(document.lineCount - 1).range.end;
  editor.selection = new vscode.Selection(end, end);
  return editor;
}

async function acceptSuggestion(): Promise<void> {
  await vscode.commands.executeCommand('editor.action.triggerSuggest');
  await delay(700);
  await vscode.commands.executeCommand('acceptSelectedSuggestion');
  await delay(300);
}

suite('the suggest widget', () => {
  test('$->dump is offered and inserts the tree', async () => {
    const editor = await openMarkdown('$.screens.Splash\n\n$->dump');

    await acceptSuggestion();

    const text = editor.document.getText();
    assert.ok(!text.includes('$->dump'), `expression not replaced, document is:\n${text}`);
    assert.match(text, /```json/);
    assert.match(text, /"Splash"/);
  });

  test('$->du is enough to insert the tree', async () => {
    const editor = await openMarkdown('$.screens.Splash\n\n$->du');

    await acceptSuggestion();

    const text = editor.document.getText();
    assert.ok(!text.includes('$->du'), `expression not replaced, document is:\n${text}`);
    assert.match(text, /"Splash"/);
  });

  test('accepting from the invalid state leaves the document untouched', async () => {
    const editor = await openMarkdown('$.screens.Splash\n\n$.\\.*$');
    const before = editor.document.getText();

    await acceptSuggestion();

    assert.equal(editor.document.getText(), before, 'the invalid entry must never change the file');
  });

  test('a concept suggestion inserts just the concept name', async () => {
    const editor = await openMarkdown('$.screens.Splash\n\n$.screens.Spl');

    await acceptSuggestion();

    assert.match(editor.document.getText(), /\$\.screens\.Splash$/);
  });
});
