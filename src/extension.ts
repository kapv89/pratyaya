import * as vscode from 'vscode';
import {
  childKeys,
  countDescendants,
  parseContextAt,
  previewJson,
  resolveNode,
  suggestionsFor,
  pathActions,
  walkSuggestions,
  scopeFunction,
  scopeFunctionsMatching,
  startsLine,
  ConceptNode,
  ScopeFunction,
  FUNCTION_ACCESSOR,
  MARKER,
  OPENER,
  QUOTE,
  referenceText,
} from './concepts';
import {
  DefineConceptActions,
  UndefinedConceptDiagnostics,
  revealDefinition,
} from './diagnostics';
import { ConceptHighlighter } from './highlight';
import { ConceptRenameProvider, renameFromView } from './rename';
import { ConceptRoots } from './roots';
import { ConceptStore } from './store';
import { upgradeActiveDocument, UpgradeOffer } from './upgrade';
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
  const roots = new ConceptRoots();
  const store = new ConceptStore(isEnabled, roots);
  const highlighter = new ConceptHighlighter(store, isEnabled);
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
    const selector = enabledLanguages().map((language) => ({ language }));
    providerRegistration = vscode.Disposable.from(
      vscode.languages.registerCompletionItemProvider(
        selector,
        new ConceptCompletionProvider(store),
        ...TRIGGER_CHARACTERS
      ),
      vscode.languages.registerRenameProvider(selector, new ConceptRenameProvider(store)),
      vscode.languages.registerCodeActionsProvider(selector, new DefineConceptActions(), {
        providedCodeActionKinds: DefineConceptActions.kinds,
      })
    );
  };
  registerProvider();

  context.subscriptions.push(
    roots,
    store,
    highlighter,
    new UndefinedConceptDiagnostics(store, isEnabled),
    new UpgradeOffer(isEnabled),
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
    vscode.commands.registerCommand('pratyaya.dump', () => runFunction(store, 'dump')),
    vscode.commands.registerCommand('pratyaya.runFunction', (name: string) =>
      runFunction(store, name)
    ),
    vscode.commands.registerCommand('pratyaya.showTree', () => showLiveTree(liveDocuments)),
    vscode.commands.registerCommand('pratyaya.upgrade', upgradeActiveDocument),
    vscode.commands.registerCommand('pratyaya.insertPath', (item?: ConceptItem) =>
      insertPath(item)
    ),
    vscode.commands.registerCommand('pratyaya.renameConcept', (item?: ConceptItem, newName?: string) =>
      renameFromView(store, conceptTree, treeView.selection, item, newName)
    ),
    vscode.commands.registerCommand('pratyaya.revealDefinition', (uri: vscode.Uri, offset: number) =>
      revealDefinition(uri, offset)
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

/** A suggestion whose details pane is only built if the suggestion gets focus. */
class ConceptCompletionItem extends vscode.CompletionItem {
  preview?: () => vscode.MarkdownString;
}

class ConceptCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly store: ConceptStore) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionList | undefined {
    // An expression never crosses a line, so the line is all there is to read -
    // no copy of the whole document on every keystroke.
    const text = document.lineAt(position.line).text;
    const context = parseContextAt(text, position.character);

    if (context.kind === 'none') {
      return undefined;
    }

    // `isIncomplete` keeps us in charge of filtering: VS Code re-asks on every
    // keystroke instead of caching and fuzzy-matching the first response.
    if (context.kind === 'invalid') {
      return new vscode.CompletionList([invalidItem(position)], true);
    }

    const root = this.store.tree(document);
    // A closing backtick already typed after the cursor goes with the expression.
    const exprEnd = position.character + (text[position.character] === QUOTE ? 1 : 0);
    const exprRange = new vscode.Range(position.line, context.exprStart, position.line, exprEnd);

    const atLineStart = startsLine(text, context.exprStart);

    if (context.kind === 'function') {
      const items = scopeFunctionsMatching(context.partial)
        .filter((fn) => !fn.lineStart || atLineStart)
        .map((fn) => functionItem(fn, root, exprRange));
      return new vscode.CompletionList(items, true);
    }

    if (context.kind === 'functionPath') {
      const fn = scopeFunction(context.name);
      if (!fn?.path || (fn.lineStart && !atLineStart)) {
        return new vscode.CompletionList([], true);
      }
      return new vscode.CompletionList(
        walkItems(fn, root, context.segments, context.partial, document, position),
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

  resolveCompletionItem(item: vscode.CompletionItem): vscode.CompletionItem {
    if (item instanceof ConceptCompletionItem && item.preview && !item.documentation) {
      item.documentation = item.preview();
    }
    return item;
  }
}

function conceptItem(
  root: ConceptNode,
  segments: string[],
  key: string,
  index: number,
  replaceRange: vscode.Range,
  retrigger = false
): vscode.CompletionItem {
  const node = resolveNode(root, [...segments, key])!;
  const children = childKeys(node);
  const item = new ConceptCompletionItem(
    key,
    children.length > 0 ? vscode.CompletionItemKind.Module : vscode.CompletionItemKind.Field
  );

  item.detail = referenceText([...segments, key]);
  item.insertText = key;
  item.range = replaceRange;
  item.filterText = key;
  // Preserve document order rather than letting the widget sort alphabetically.
  item.sortText = `2${index.toString().padStart(4, '0')}`;
  if (retrigger) {
    // Mid-walk, so open the next set of choices straight away.
    item.command = { command: 'editor.action.triggerSuggest', title: 'Keep walking' };
  }

  item.preview = () => {
    const documentation = new vscode.MarkdownString();
    documentation.appendMarkdown(
      children.length > 0
        ? `**${key}** - ${children.length} child concept${children.length === 1 ? '' : 's'}\n\n`
        : `**${key}** - leaf concept\n\n`
    );
    documentation.appendCodeblock(previewJson(node), 'json');
    return documentation;
  };

  return item;
}

/** Suggestions while walking a path function: concepts, then `()` and `.`. */
function walkItems(
  fn: ScopeFunction,
  root: ConceptNode,
  segments: string[],
  partial: string,
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.CompletionItem[] {
  const replaceRange = new vscode.Range(position.translate(0, -partial.length), position);
  const items = walkSuggestions(fn.path!, root, segments, partial).map((key, index) =>
    conceptItem(root, segments, key, index, replaceRange, true)
  );

  const actions = pathActions(fn.path!, root, segments, partial);
  if (actions.call) {
    items.push(callItem(fn, [...segments, partial], document, position));
  }
  if (actions.descend) {
    items.push(descendItem(position));
  }

  return items;
}

/** The `()` that ends the walk and rewrites the line. */
function callItem(
  fn: ScopeFunction,
  segments: string[],
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.CompletionItem {
  const line = document.lineAt(position.line);
  const item = new vscode.CompletionItem('()', vscode.CompletionItemKind.Method);

  item.detail = `${fn.path!.call(segments)} - ${fn.path!.callSummary}`;
  item.insertText = fn.path!.call(segments);
  // The whole line goes, so VS Code filters against everything typed on it.
  item.range = new vscode.Range(position.line, 0, position.line, line.text.length);
  item.filterText = line.text.slice(0, position.character);
  item.sortText = '0';
  item.preselect = true;

  return item;
}

/** The `.` that walks one level deeper. */
function descendItem(position: vscode.Position): vscode.CompletionItem {
  const item = new vscode.CompletionItem('.', vscode.CompletionItemKind.Operator);

  item.detail = 'go a level deeper';
  item.insertText = '.';
  item.range = new vscode.Range(position, position);
  item.sortText = '1';
  item.command = { command: 'editor.action.triggerSuggest', title: 'Show the children' };

  return item;
}

function functionItem(
  fn: ScopeFunction,
  root: ConceptNode,
  exprRange: vscode.Range
): vscode.CompletionItem {
  const item = new ConceptCompletionItem(fn.name, vscode.CompletionItemKind.Function);

  const expression = `${OPENER}${FUNCTION_ACCESSOR}${fn.name}`;
  item.detail = `${expression}${QUOTE} - ${fn.summary}`;
  // The replace range starts at the backtick, so VS Code filters against the whole
  // expression as typed. Filtering on `dump` alone would never match `` `$->dump ``
  // and the widget would silently drop this item.
  item.filterText = expression;
  item.sortText = fn.name;

  item.range = exprRange;

  if (fn.path) {
    // Accepting opens the walk: `` `$->define. ``, then the concepts appear.
    item.insertText = `${expression}.`;
    item.command = { command: 'editor.action.triggerSuggest', title: 'Choose a concept' };
  } else {
    // Accepting clears the expression and lets the command render the replacement,
    // so the text is built when it is inserted rather than when the list was made.
    item.insertText = '';
    item.command = {
      command: 'pratyaya.runFunction',
      title: fn.summary,
      arguments: [fn.name],
    };
  }

  item.preview = () => {
    const documentation = new vscode.MarkdownString();
    documentation.appendMarkdown(
      `\`\`${expression}${QUOTE}\`\` - ${fn.summary} (${countDescendants(root)} concepts).\n\n`
    );
    documentation.appendCodeblock(previewJson(root), 'json');
    return documentation;
  };

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

/** Writes a scope function's output at the cursor, rendered from the live tree. */
async function runFunction(store: ConceptStore, name: string) {
  const editor = vscode.window.activeTextEditor;
  const fn = scopeFunction(name);
  if (!editor || !fn?.render) {
    return;
  }
  const text = fn.render(store.tree(editor.document), { asCodeBlock: dumpAsCodeBlock() });
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
  const reference = referenceText(item.segments);
  await editor.edit((builder) => {
    for (const selection of editor.selections) {
      builder.replace(selection, reference);
    }
  });
}
