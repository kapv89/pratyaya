import * as vscode from 'vscode';
import { buildTree, ConceptNode } from './concepts';

interface Entry {
  /** Document version the tree was built from. */
  version: number;
  tree: ConceptNode;
}

/**
 * Keeps one live `root` object per open document.
 *
 * The tree is rebuilt from the document's in-memory text on every content
 * change, so it tracks typing keystroke by keystroke and never waits for a save.
 * Readers get the cached object, and a version check means a missed change event
 * can never hand out a stale tree.
 */
export class ConceptStore implements vscode.Disposable {
  private readonly entries = new Map<string, Entry>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.TextDocument>();
  private readonly disposables: vscode.Disposable[] = [];

  /** Fires with the document whose `root` object just changed. */
  readonly onDidChangeTree = this.changeEmitter.event;

  constructor(private readonly isEnabled: (document: vscode.TextDocument) => boolean) {
    this.disposables.push(
      this.changeEmitter,
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0 && this.isEnabled(event.document)) {
          this.rebuild(event.document);
        }
      }),
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (this.isEnabled(document)) {
          this.rebuild(document);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.entries.delete(document.uri.toString());
      })
    );

    for (const document of vscode.workspace.textDocuments) {
      if (this.isEnabled(document)) {
        this.rebuild(document);
      }
    }
  }

  /** The document's live `root` object. */
  tree(document: vscode.TextDocument): ConceptNode {
    const entry = this.entries.get(document.uri.toString());
    if (entry && entry.version === document.version) {
      return entry.tree;
    }
    return this.rebuild(document);
  }

  private rebuild(document: vscode.TextDocument): ConceptNode {
    const tree = buildTree(document.getText());
    this.entries.set(document.uri.toString(), { version: document.version, tree });
    this.changeEmitter.fire(document);
    return tree;
  }

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.entries.clear();
  }
}
