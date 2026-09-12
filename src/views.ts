import * as vscode from 'vscode';
import { ConceptStore } from './store';
import { childKeys, countDescendants, dumpJson, resolveNode, ConceptNode, MARKER } from './concepts';

/** Scheme of the read-only, live-updating JSON view of a document's `root`. */
export const LIVE_SCHEME = 'pratyaya';

/** The live view URI for a source document, keeping the source in the query. */
export function liveUriFor(source: vscode.Uri): vscode.Uri {
  const name = source.path.split('/').pop() || 'document';
  return vscode.Uri.from({
    scheme: LIVE_SCHEME,
    path: `/${name} - root.json`,
    query: source.toString(),
  });
}

/**
 * Renders a document's `root` object as JSON, and re-renders on every keystroke
 * in the source document.
 */
export class LiveTreeDocumentProvider
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly sources = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly store: ConceptStore) {
    this.disposables.push(
      this.changeEmitter,
      store.onDidChangeTree((document) => {
        this.changeEmitter.fire(liveUriFor(document.uri));
      })
    );
  }

  /** Remembers which source a live view belongs to, before it is opened. */
  register(source: vscode.Uri): vscode.Uri {
    const uri = liveUriFor(source);
    this.sources.set(uri.toString(), source.toString());
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const document = this.sourceOf(uri);
    if (!document) {
      return [
        '// Pratyaya could not find the source document for this view.',
        '// Run "Pratyaya: Show live concept tree" from the markdown file again.',
      ].join('\n');
    }
    return dumpJson(this.store.tree(document));
  }

  private sourceOf(uri: vscode.Uri): vscode.TextDocument | undefined {
    const target = this.sources.get(uri.toString()) ?? uri.query;
    return vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === target
    );
  }

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

export class ConceptItem extends vscode.TreeItem {
  constructor(
    readonly segments: string[],
    node: ConceptNode,
    hasChildren: boolean
  ) {
    super(
      segments[segments.length - 1],
      hasChildren
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );

    const children = childKeys(node);
    this.description = children.length > 0 ? `${children.length}` : undefined;
    this.iconPath = new vscode.ThemeIcon(children.length > 0 ? 'symbol-namespace' : 'symbol-field');
    this.contextValue = 'pratyayaConcept';

    const tooltip = new vscode.MarkdownString();
    tooltip.appendCodeblock([MARKER, ...segments].join('.'), 'text');
    tooltip.appendCodeblock(dumpJson(node), 'json');
    this.tooltip = tooltip;
  }
}

/** The sidebar tree of concepts for the markdown document being edited. */
export class ConceptTreeProvider
  implements vscode.TreeDataProvider<ConceptItem>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private target: vscode.TextDocument | undefined;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly store: ConceptStore,
    private readonly isEnabled: (document: vscode.TextDocument) => boolean
  ) {
    this.follow(vscode.window.activeTextEditor?.document);
    this.disposables.push(
      this.changeEmitter,
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (this.follow(editor?.document)) {
          this.changeEmitter.fire();
        }
      }),
      store.onDidChangeTree((document) => {
        if (document.uri.toString() === this.target?.uri.toString()) {
          this.changeEmitter.fire();
        }
      })
    );
  }

  /** The document the view is showing, if any. */
  get document(): vscode.TextDocument | undefined {
    return this.target;
  }

  getTreeItem(element: ConceptItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ConceptItem): ConceptItem[] {
    if (!this.target) {
      return [];
    }
    const root = this.store.tree(this.target);
    const segments = element?.segments ?? [];
    const node = resolveNode(root, segments);
    if (!node) {
      return [];
    }
    return childKeys(node).map((key) => {
      const path = [...segments, key];
      const child = resolveNode(root, path)!;
      return new ConceptItem(path, child, childKeys(child).length > 0);
    });
  }

  /** Concept count for the view's title, so it too moves as you type. */
  count(): number {
    return this.target ? countDescendants(this.store.tree(this.target)) : 0;
  }

  /** Keeps showing the last markdown document when focus moves elsewhere. */
  private follow(document: vscode.TextDocument | undefined): boolean {
    if (!document || !this.isEnabled(document) || document === this.target) {
      return false;
    }
    this.target = document;
    return true;
  }

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
