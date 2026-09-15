import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { ConceptItem } from '../../src/views';

/**
 * These go through VS Code's own rename commands, so they also cover which
 * provider answers: markdown ships a rename provider of its own for headings and
 * links, and F2 on a concept has to reach Pratyaya's.
 */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openMarkdown(content: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  await vscode.window.showTextDocument(document);
  await delay(300);
  return document;
}

function prepareRename(document: vscode.TextDocument, line: number, character: number) {
  return vscode.commands.executeCommand<{ range: vscode.Range; placeholder: string }>(
    'vscode.prepareRename',
    document.uri,
    new vscode.Position(line, character)
  );
}

async function renameAt(document: vscode.TextDocument, line: number, character: number, newName: string) {
  const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
    'vscode.executeDocumentRenameProvider',
    document.uri,
    new vscode.Position(line, character),
    newName
  );
  assert.ok(await vscode.workspace.applyEdit(edit), 'the rename edit did not apply');
}

const SPEC = [
  'The `$.screens.Splash` has a `$.screens.Splash.logo`.',
  '',
  '#### `$.screens.Splash`',
  'The first screen, before `$.screens.Login` and unlike `$.other.Splash`.',
].join('\n');

const RENAMED = [
  'The `$.screens.Launch` has a `$.screens.Launch.logo`.',
  '',
  '#### `$.screens.Launch`',
  'The first screen, before `$.screens.Login` and unlike `$.other.Splash`.',
].join('\n');

suite('renaming a concept', () => {
  test('F2 offers the concept name under the cursor', async () => {
    const document = await openMarkdown(SPEC);
    const location = await prepareRename(document, 0, 17);
    assert.equal(location.placeholder, 'Splash');
    assert.deepEqual([location.range.start.character, location.range.end.character], [15, 21]);
  });

  test('F2 renames the concept in every reference, children and headings included', async () => {
    const document = await openMarkdown(SPEC);
    await renameAt(document, 0, 17, 'Launch');
    assert.equal(document.getText(), RENAMED);
  });

  test('F2 on a definition heading renames the concept, not the heading', async () => {
    const document = await openMarkdown(SPEC);
    const location = await prepareRename(document, 2, 18);
    assert.equal(location.placeholder, 'Splash');
    await renameAt(document, 2, 18, 'Launch');
    assert.equal(document.getText(), RENAMED);
  });

  test('a name that is not a concept name is refused and nothing changes', async () => {
    const document = await openMarkdown(SPEC);
    await assert.rejects(
      Promise.resolve(
        vscode.commands.executeCommand(
          'vscode.executeDocumentRenameProvider',
          document.uri,
          new vscode.Position(0, 17),
          'two words'
        )
      )
    );
    assert.equal(document.getText(), SPEC);
  });

  test('the Concepts view renames the concept it was invoked on', async () => {
    const document = await openMarkdown(SPEC);
    const item = new ConceptItem(['screens', 'Splash'], { '($)': 'Splash' }, true);
    const changed = await vscode.commands.executeCommand<boolean>('pratyaya.renameConcept', item, 'Launch');
    assert.equal(changed, true);
    assert.equal(document.getText(), RENAMED);
  });
});
