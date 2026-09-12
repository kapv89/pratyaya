import * as vscode from 'vscode';
import {
  childKeys,
  countDescendants,
  dumpJson,
  dumpText,
  parseContextAt,
  resolveNode,
  suggestionsFor,
  ConceptNode,
  DUMP_ACCESSOR,
  DUMP_NAME,
  MARKER,
} from './concepts';
import { ConceptHighlighter } from './highlight';
import { ConceptStore } from './store';
import { ConceptItem, ConceptTreeProvider, LiveTreeDocumentProvider, LIVE_SCHEME } from './views';

/** Shade of red used for the `invalid` suggestion's swatch. */
const INVALID_COLOR = '#e51400';

// `$` alone is never an expression, so the accessor characters do the triggering.
const TRIGGER_CHARACTERS = ['.', '-', '>'];

function enabledLanguages(): string[] {
  return vscode.workspace.getConfiguration('pratyaya').get<string[]>('enabledLanguages', ['markdown']);
}

function isEnabled(document: vscode.TextDocument): boolean {
  return enabledLanguages().includes(document.languageId);
}

function dumpAsCodeBlock(): boolean {
  return vscode.workspace.getConfiguration('pratyaya').get<boolean>('dumpAsCodeBlock', true);
}

export function activate(context: vscode.ExtensionContext) {
  const store = new ConceptStore(isEnabled);
  const highlighter = new ConceptHighlighter(isEnabled);
  const liveDocuments = new LiveTreeDocumentProvider(store);
  const conceptTree = new ConceptTreeProvider(store, isEnabled);

  const treeView = vscode.window.createTreeView('pratyaya.conceptTree', {
    treeDataProvider: conceptTree,
    showCollapseAll: true,
  });
  const describeCount = () => {
    const count = conceptTree.count();
    treeView.description = count === 1 ? '1 concept' : `${count} concepts`;
  };
  describeCount();

  let providerRegistration: vscode.Disposable | undefined;
  const registerProvider = () => {
    providerRegistration?.dispose();
    providerRegistration = vscode.languages.registerCompletionItemProvider(
      enabledLanguages().map((language) => ({ language })),
      new ConceptCompletionProvider(store),
      ...TRIGGER_CHARACTERS
    );
  };
  registerProvider();

  context.subscriptions.push(
    store,
    highlighter,
    liveDocuments,
    conceptTree,
    treeView,
    { dispose: () => providerRegistration?.dispose() },
    vscode.workspace.registerTextDocumentContentProvider(LIVE_SCHEME, liveDocuments),
    store.onDidChangeTree(describeCount),
    vscode.window.onDidChangeActiveTextEditor(describeCount),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('pratyaya.enabledLanguages')) {
        registerProvider();
      }
    }),
    vscode.commands.registerCommand('pratyaya.dump', () => dumpAtCursor(store)),
    vscode.commands.registerCommand('pratyaya.showTree', () => showLiveTree(liveDocuments)),
    vscode.commands.registerCommand('pratyaya.insertPath', (item?: ConceptItem) =>
      insertPath(item)
    ),
    vscode.commands.registerCommand('pratyaya.invalidNotice', () => {
      vscode.window.showWarningMessage(
        `Pratyaya: this ${MARKER} expression is invalid, so nothing was inserted.`
      );
    })
  );
}

export function deactivate() {
  // Disposables registered on the extension context handle teardown.
}

class ConceptCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly store: ConceptStore) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionList | undefined {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const context = parseContextAt(text, offset);

    if (context.kind === 'none') {
      return undefined;
    }

    // `isIncomplete` keeps us in charge of filtering: VS Code re-asks on every
    // keystroke instead of caching and fuzzy-matching the first response.
    if (context.kind === 'invalid') {
      return new vscode.CompletionList([invalidItem(position)], true);
    }

    const root = this.store.tree(document);
    const exprRange = new vscode.Range(document.positionAt(context.exprStart), position);

    if (context.kind === 'dump') {
      const item = dumpItem(root, exprRange);
      return new vscode.CompletionList(
        DUMP_NAME.startsWith(context.partial.toLowerCase()) ? [item] : [],
        true
      );
    }

    const { segments, partial } = context;
    if (!resolveNode(root, segments)) {
      return new vscode.CompletionList([], true);
    }

    const replaceRange = new vscode.Range(position.translate(0, -partial.length), position);
    const items = suggestionsFor(root, segments, partial).map((key, index) =>
      conceptItem(root, segments, key, index, replaceRange)
    );

    return new vscode.CompletionList(items, true);
  }
}

function conceptItem(
  root: ConceptNode,
  segments: string[],
  key: string,
  index: number,
  replaceRange: vscode.Range
): vscode.CompletionItem {
  const node = resolveNode(root, [...segments, key])!;
  const children = childKeys(node);
  const item = new vscode.CompletionItem(
    key,
    children.length > 0 ? vscode.CompletionItemKind.Module : vscode.CompletionItemKind.Field
  );

  item.detail = [MARKER, ...segments, key].join('.');
  item.insertText = key;
  item.range = replaceRange;
  item.filterText = key;
  // Preserve document order rather than letting the widget sort alphabetically.
  item.sortText = index.toString().padStart(4, '0');

  const documentation = new vscode.MarkdownString();
  documentation.appendMarkdown(
    children.length > 0
      ? `**${key}** - ${children.length} child concept${children.length === 1 ? '' : 's'}\n\n`
      : `**${key}** - leaf concept\n\n`
  );
  documentation.appendCodeblock(dumpJson(node), 'json');
  item.documentation = documentation;

  return item;
}

function dumpItem(root: ConceptNode, exprRange: vscode.Range): vscode.CompletionItem {
  const item = new vscode.CompletionItem(DUMP_NAME, vscode.CompletionItemKind.Function);

  const expression = `${MARKER}${DUMP_ACCESSOR}${DUMP_NAME}`;
  item.detail = `${expression} - insert the whole concept tree`;
  // The replace range starts at the marker, so VS Code filters against the whole
  // expression as typed. Filtering on `dump` alone would never match `$->dump`
  // and the widget would silently drop this item.
  item.filterText = expression;
  item.sortText = 'zzzz';

  // Accepting removes the expression and lets `pratyaya.dump` write the JSON, so
  // the dump is built when it is inserted rather than when the list was offered.
  item.insertText = '';
  item.range = exprRange;
  item.command = { command: 'pratyaya.dump', title: 'Dump concept tree' };

  const documentation = new vscode.MarkdownString();
  documentation.appendMarkdown(
    `Replaces the expression with the full \`root\` object (${countDescendants(root)} concepts).\n\n`
  );
  documentation.appendCodeblock(dumpJson(root), 'json');
  item.documentation = documentation;

  return item;
}

function invalidItem(position: vscode.Position): vscode.CompletionItem {
  const item = new vscode.CompletionItem('invalid', vscode.CompletionItemKind.Color);

  // Kind `Color` renders a swatch from `documentation`/`detail`, so the entry
  // shows up in red; the `Deprecated` tag strikes the label through.
  item.detail = INVALID_COLOR;
  item.documentation = INVALID_COLOR;
  item.tags = [vscode.CompletionItemTag.Deprecated];
  item.label = { label: 'invalid', description: `malformed ${MARKER} expression` };

  // An empty insert into an empty range: accepting this can never change the file.
  item.insertText = '';
  item.range = new vscode.Range(position, position);
  item.sortText = ' ';
  item.preselect = false;
  item.command = { command: 'pratyaya.invalidNotice', title: 'Invalid expression' };

  return item;
}

async function dumpAtCursor(store: ConceptStore) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const text = dumpText(store.tree(editor.document), dumpAsCodeBlock());
  await editor.edit((builder) => {
    for (const selection of editor.selections) {
      builder.replace(selection, text);
    }
  });
}

async function showLiveTree(liveDocuments: LiveTreeDocumentProvider) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const uri = liveDocuments.register(editor.document.uri);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(document, 'json');
  await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
    preserveFocus: true,
  });
}

async function insertPath(item: ConceptItem | undefined) {
  const editor = vscode.window.visibleTextEditors.find((candidate) => isEnabled(candidate.document));
  if (!item || !editor) {
    return;
  }
  const reference = [MARKER, ...item.segments].join('.');
  await editor.edit((builder) => {
    for (const selection of editor.selections) {
      builder.replace(selection, reference);
    }
  });
}
