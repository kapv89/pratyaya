import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { liveUriFor } from '../../src/views';

/**
 * These run inside a real VS Code instance against a document that is never
 * saved, so anything they observe is coming from the in-memory buffer.
 */

async function openDirtyMarkdown(initial: string): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: initial,
  });
  return vscode.window.showTextDocument(document);
}

/** Types text at the end of the document, one edit per call, and never saves. */
async function type(editor: vscode.TextEditor, text: string): Promise<vscode.Position> {
  const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
  await editor.edit((builder) => builder.insert(end, text));
  const position = editor.document.lineAt(editor.document.lineCount - 1).range.end;
  editor.selection = new vscode.Selection(position, position);
  return position;
}

async function completionsAt(
  document: vscode.TextDocument,
  position: vscode.Position,
  triggerCharacter?: string
): Promise<vscode.CompletionItem[]> {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    document.uri,
    position,
    triggerCharacter
  );
  return list?.items ?? [];
}

/** Only the items Pratyaya contributed, ignoring word-based suggestions. */
function conceptLabels(items: vscode.CompletionItem[]): string[] {
  return items
    .filter((item) => typeof item.detail === 'string' && item.detail.startsWith('$'))
    .map((item) => (typeof item.label === 'string' ? item.label : item.label.label));
}

suite('live updates in an unsaved document', () => {
  test('a concept typed moments ago is suggested without saving', async () => {
    const editor = await openDirtyMarkdown('# Spec\n\n');

    // Nothing exists yet.
    let position = await type(editor, 'The $.');
    assert.deepEqual(conceptLabels(await completionsAt(editor.document, position, '.')), []);

    // Write a concept, then ask again on a fresh line. No save in between.
    await type(editor, 'screens.Splash needs a break\n\n');
    position = await type(editor, 'Also $.');
    assert.ok(editor.document.isDirty, 'document must still be unsaved');
    assert.deepEqual(conceptLabels(await completionsAt(editor.document, position, '.')), ['screens']);

    position = await type(editor, 'screens.');
    assert.deepEqual(conceptLabels(await completionsAt(editor.document, position, '.')), ['Splash']);

    // A sibling typed one keystroke ago shows up on the next request.
    await type(editor, 'NewUsername and\n\n');
    position = await type(editor, 'then $.screens.');
    assert.deepEqual(conceptLabels(await completionsAt(editor.document, position, '.')), [
      'Splash',
      'NewUsername',
    ]);

    // Prefix filtering, still unsaved.
    position = await type(editor, 'S');
    assert.deepEqual(conceptLabels(await completionsAt(editor.document, position)), ['Splash']);
  });

  test('a malformed expression offers only the invalid entry', async () => {
    const editor = await openDirtyMarkdown('$.screens.Splash\n\n');
    const position = await type(editor, '$.\\.*$');
    const labels = (await completionsAt(editor.document, position)).map((item) =>
      typeof item.label === 'string' ? item.label : item.label.label
    );
    assert.ok(labels.includes('invalid'), `expected an invalid entry, got ${labels.join(', ')}`);
    assert.ok(!labels.includes('screens'), 'no concept may be offered from the invalid state');
  });

  test('the live tree view re-renders as the document changes', async () => {
    const editor = await openDirtyMarkdown('$.screens.Splash\n\n');
    await vscode.commands.executeCommand('pratyaya.showTree');

    const liveUri = liveUriFor(editor.document.uri);
    const before = await vscode.workspace.openTextDocument(liveUri);
    assert.match(before.getText(), /"Splash"/);
    assert.ok(!/PrivateKey/.test(before.getText()));

    // A change with no save at all must reach the view.
    const changed = new Promise<void>((resolve) => {
      const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === liveUri.toString()) {
          subscription.dispose();
          resolve();
        }
      });
    });
    await type(editor, '$.components.PrivateKey\n');
    await Promise.race([changed, new Promise((resolve) => setTimeout(resolve, 3000))]);

    const after = await vscode.workspace.openTextDocument(liveUri);
    assert.match(after.getText(), /"PrivateKey"/, 'live view did not pick up the new concept');
    assert.ok(editor.document.isDirty, 'document must still be unsaved');
  });

  test('the dump command writes the tree as it stands right now', async () => {
    const editor = await openDirtyMarkdown('$.screens.Splash\n\n');
    await type(editor, '$.components.PrivateKey\n\n');
    await vscode.commands.executeCommand('pratyaya.dump');

    const text = editor.document.getText();
    assert.match(text, /```json/);
    assert.match(text, /"PrivateKey"/);
    assert.match(text, /"Splash"/);
  });
});
