import { performance } from 'node:perf_hooks';
import * as vscode from 'vscode';
import { generateSpec } from '../generate';

/**
 * What a person feels, measured inside a real VS Code: the extension host's work
 * per keystroke and how long completion takes to answer, on a generated spec.
 *
 * The baseline is the same markdown document with Pratyaya switched off, so
 * VS Code's own markdown support is in both measurements and only Pratyaya's
 * share differs.
 */

const WORDS = Number(process.env.PRATYAYA_BENCH_WORDS ?? 50_000);
const KEYSTROKES = 60;
const COMPLETIONS = 25;

const settle = () => new Promise((resolve) => setImmediate(resolve));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function report(name: string, times: number[]): void {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  console.log(
    `    ${name.padEnd(50)} median ${at(0.5).toFixed(1).padStart(7)} ms   p95 ${at(0.95).toFixed(1).padStart(7)} ms   max ${sorted[sorted.length - 1].toFixed(1).padStart(7)} ms`
  );
}

async function setPratyaya(enabled: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration('pratyaya')
    .update('enabledLanguages', enabled ? ['markdown'] : [], vscode.ConfigurationTarget.Global);
  await delay(300);
}

async function openMarkdown(content: string): Promise<{ document: vscode.TextDocument; ms: number }> {
  const start = performance.now();
  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One });
  await settle();
  return { document, ms: performance.now() - start };
}

/** Editor handles go stale once their tab is hidden, so always fetch a fresh one. */
async function editorFor(document: vscode.TextDocument): Promise<vscode.TextEditor> {
  const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One });
  await delay(300);
  return editor;
}

/** A line of plain prose near the middle of the document. */
function proseLine(document: vscode.TextDocument): number {
  for (let line = Math.floor(document.lineCount / 2); line < document.lineCount; line++) {
    const text = document.lineAt(line).text;
    if (text.length > 20 && !text.startsWith('#') && text !== '---') {
      return line;
    }
  }
  throw new Error('no prose line found');
}

/** Times single-character insertions, each including the listeners it triggers. */
async function typeInto(document: vscode.TextDocument): Promise<number[]> {
  const editor = await editorFor(document);
  let position = document.lineAt(proseLine(document)).range.end;
  const times: number[] = [];
  for (let i = 0; i < KEYSTROKES; i++) {
    const start = performance.now();
    await editor.edit((builder) => builder.insert(position, 'x'), {
      undoStopBefore: false,
      undoStopAfter: false,
    });
    await settle();
    times.push(performance.now() - start);
    position = position.translate(0, 1);
  }
  return times;
}

/** Puts `probe` on a fresh line mid-document and times completion there. */
async function completeAt(document: vscode.TextDocument, probe: string, trigger?: string): Promise<number[]> {
  const editor = await editorFor(document);
  const line = proseLine(document);
  const lineEnd = document.lineAt(line).range.end;
  await editor.edit((builder) => builder.insert(lineEnd, `\n${probe}`));
  await settle();
  const position = document.lineAt(line + 1).range.end;

  const times: number[] = [];
  for (let i = 0; i < COMPLETIONS; i++) {
    const start = performance.now();
    await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      document.uri,
      position,
      trigger
    );
    times.push(performance.now() - start);
  }

  await editor.edit((builder) => builder.delete(new vscode.Range(lineEnd, position)));
  await settle();
  return times;
}

suite(`editor performance at ${WORDS} words`, () => {
  const spec = generateSpec(WORDS);

  test('keystrokes and completion', async () => {
    console.log(
      `\n    document: ${spec.words} words, ${(spec.text.length / 1024).toFixed(0)} KB, ` +
        `${spec.references} references, ${spec.definitions} definitions\n`
    );

    await setPratyaya(false);
    const baseline = await openMarkdown(spec.text);
    console.log(`    open, markdown without Pratyaya ..... ${baseline.ms.toFixed(0)} ms`);
    report('keystroke, markdown without Pratyaya', await typeInto(baseline.document));

    await setPratyaya(true);
    const doc = await openMarkdown(spec.text);
    console.log(`    open, markdown with Pratyaya ........ ${doc.ms.toFixed(0)} ms`);
    report('keystroke, with Pratyaya, views closed', await typeInto(doc.document));

    await vscode.commands.executeCommand('pratyaya.conceptTree.focus');
    await editorFor(doc.document);
    await vscode.commands.executeCommand('pratyaya.showTree');
    await delay(1000);
    report('keystroke, with sidebar + live view open', await typeInto(doc.document));
    console.log();

    report('completion at $.', await completeAt(doc.document, '$.', '.'));
    report('completion at $.screens.', await completeAt(doc.document, '$.screens.', '.'));
    report('completion at $->', await completeAt(doc.document, '$->', '>'));
    report('completion at $->define.', await completeAt(doc.document, '$->define.', '.'));
    console.log();
  });
});
