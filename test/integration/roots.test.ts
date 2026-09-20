import assert from 'node:assert/strict';
import * as vscode from 'vscode';

/**
 * These need real files: a root gathers its members by glob against a workspace
 * folder, which an untitled buffer can never belong to. Each test writes into a
 * subfolder of its own and points `pratyaya.roots` at just that subfolder, so one
 * test's files are never another's concepts.
 */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The fixture workspace `runTest.ts` prepared. */
function workspace(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'these tests need the fixture workspace folder');
  return folder.uri;
}

function fileIn(dir: string, name: string): vscode.Uri {
  return vscode.Uri.joinPath(workspace(), dir, name);
}

async function write(dir: string, name: string, content: string): Promise<vscode.Uri> {
  const uri = fileIn(dir, name);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
  return uri;
}

/** Makes every markdown file under `dir` one root. */
async function useRoot(dir: string): Promise<void> {
  await vscode.workspace
    .getConfiguration('pratyaya')
    .update('roots', [`${dir}/**/*.md`], vscode.ConfigurationTarget.Global);
}

async function show(uri: vscode.Uri): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  return document;
}

/** Re-reads until it looks right, because the scan and the watcher are both async. */
async function eventually<T>(
  read: () => Promise<T> | T,
  ok: (value: T) => boolean,
  tries = 40
): Promise<T> {
  let value = await read();
  for (let attempt = 0; attempt < tries && !ok(value); attempt++) {
    await delay(100);
    value = await read();
  }
  return value;
}

async function completionsAt(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<string[]> {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    document.uri,
    position,
    '.'
  );
  return (list?.items ?? [])
    .filter((item) => typeof item.detail === 'string' && item.detail.startsWith('`$'))
    .map((item) => (typeof item.label === 'string' ? item.label : item.label.label));
}

/** Pratyaya's own diagnostics, by the concept each one names. */
function reported(document: vscode.TextDocument): string[] {
  return vscode.languages
    .getDiagnostics(document.uri)
    .filter((one) => one.source === 'Pratyaya')
    .map((one) => one.message.split('`')[1]);
}

suite('several files, one tree', () => {
  teardown(async () => {
    await vscode.workspace
      .getConfiguration('pratyaya')
      .update('roots', undefined, vscode.ConfigurationTarget.Global);
  });

  test('a concept written in one file completes in another', async () => {
    const dir = 'root-completion';
    await write(dir, 'auth.md', 'The `$.auth.token` is checked.\n');
    const spec = await write(dir, 'spec.md', 'See `$.\n');
    await useRoot(dir);

    const document = await show(spec);
    const position = new vscode.Position(0, 7); // just after "See `$."

    const labels = await eventually(
      () => completionsAt(document, position),
      (found) => found.includes('auth')
    );
    assert.ok(
      labels.includes('auth'),
      `expected a concept from the other file, got: ${labels.join(', ') || '(none)'}`
    );
  });

  test('a definition in another file settles the undefined report', async () => {
    const dir = 'root-define';
    const spec = await write(dir, 'spec.md', 'The `$.auth.token` is checked.\n');
    await useRoot(dir);

    const document = await show(spec);
    assert.deepEqual(
      await eventually(() => reported(document), (found) => found.length === 2),
      ['$.auth', '$.auth.token']
    );

    // Written into a different file of the same root, and never opened here.
    await write(dir, 'glossary.md', '#### `$.auth.token`\n\nThe key a device holds.\n');

    assert.deepEqual(
      await eventually(() => reported(document), (found) => found.length === 1),
      ['$.auth'],
      'a definition in another file of the root should have settled the report'
    );
  });

  test('renaming a concept reaches every file of the root', async () => {
    const dir = 'root-rename';
    const a = await write(dir, 'a.md', 'The `$.screens.Splash` screen.\n\nSee `$.\n');
    const b = await write(dir, 'b.md', 'Back to `$.screens.Splash`, and `$.ui.OrgCard`.\n');
    await useRoot(dir);

    const document = await show(a);
    // `ui` only exists in b.md, so seeing it offered means the root is assembled.
    await eventually(
      () => completionsAt(document, new vscode.Position(2, 7)),
      (found) => found.includes('ui')
    );

    const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
      'vscode.executeDocumentRenameProvider',
      document.uri,
      new vscode.Position(0, 17), // on Splash
      'Launch'
    );
    assert.ok(await vscode.workspace.applyEdit(edit), 'the rename edit did not apply');

    assert.match(document.getText(), /`\$\.screens\.Launch`/);
    const other = await vscode.workspace.openTextDocument(b);
    assert.match(
      other.getText(),
      /`\$\.screens\.Launch`/,
      'the other file of the root was not renamed'
    );
    assert.match(other.getText(), /`\$\.ui\.OrgCard`/, 'an unrelated concept was touched');
  });

  test('with no patterns set, a document keeps the tree of its own text', async () => {
    const dir = 'root-off';
    await write(dir, 'auth.md', 'The `$.auth.token` is checked.\n');
    const spec = await write(dir, 'spec.md', 'See `$.\n');

    const document = await show(spec);
    await delay(400);

    assert.deepEqual(
      await completionsAt(document, new vscode.Position(0, 7)),
      [],
      'nothing should be shared until pratyaya.roots says so'
    );
  });
});
