import assert from 'node:assert/strict';
import * as vscode from 'vscode';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openMarkdown(content: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  await vscode.window.showTextDocument(document);
  await delay(300);
  return document;
}

const OLD = [
  'The $.screens.Splash checks for $.auth.token.',
  '',
  '```bash',
  'jq $.store.book',
  '```',
  '',
  '#### $.auth.token',
  '',
  'A token, as in `run $.auth.token`.',
].join('\n');

const NEW = [
  'The `$.screens.Splash` checks for `$.auth.token`.',
  '',
  '```bash',
  'jq $.store.book',
  '```',
  '',
  '#### `$.auth.token`',
  '',
  'A token, as in `run $.auth.token`.',
].join('\n');

suite('upgrading old-style expressions', () => {
  test('the command wraps them in backticks, outside code only', async () => {
    const document = await openMarkdown(OLD);
    const count = await vscode.commands.executeCommand<number>('pratyaya.upgrade');
    assert.equal(count, 3);
    assert.equal(document.getText(), NEW);
  });

  test('the upgraded document builds the tree it used to', async () => {
    const document = await openMarkdown(OLD);
    await vscode.commands.executeCommand('pratyaya.upgrade');
    await vscode.commands.executeCommand('pratyaya.dump');
    const text = document.getText();
    assert.match(text, /"Splash"/);
    assert.match(text, /"\(\$->def\)": "A token, as in `run \$\.auth\.token`\."/);
  });

  test('one undo reverts the whole upgrade', async () => {
    const document = await openMarkdown(OLD);
    await vscode.commands.executeCommand('pratyaya.upgrade');
    await vscode.commands.executeCommand('undo');
    assert.equal(document.getText(), OLD);
  });

  test('a document already in the new style is left alone', async () => {
    const document = await openMarkdown(NEW);
    assert.equal(await vscode.commands.executeCommand<number>('pratyaya.upgrade'), 0);
    assert.equal(document.getText(), NEW);
  });
});
