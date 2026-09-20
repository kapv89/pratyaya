import * as vscode from 'vscode';
import { buildTree, mergeTrees, ConceptNode } from './concepts';

/** Never scanned, whatever a pattern says. */
const EXCLUDE = '**/node_modules/**';

/**
 * The patterns, in order. Each one is a root of its own: a file caught by two
 * joins the first, and several globs are gathered into one root by writing them
 * as one pattern - `{spec/**\/*.md,shared/glossary.md}`.
 */
function patterns(): string[] {
  return vscode.workspace.getConfiguration('pratyaya').get<string[]>('roots', []);
}

function sortByPath(uris: vscode.Uri[]): vscode.Uri[] {
  return [...uris].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function openDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  const key = uri.toString();
  return vscode.workspace.textDocuments.find((document) => document.uri.toString() === key);
}

/**
 * The files that share one concept tree.
 *
 * A spec outgrows one file long before it outgrows one set of concepts. Each
 * pattern in `pratyaya.roots` gathers its files into a single `root`, so a
 * reference written in one of them completes, resolves and renames against every
 * concept in all of them. With no patterns configured nothing is shared and every
 * document keeps the tree of its own text, which is what Pratyaya has always done.
 *
 * Members are read from disk once, in the background, and kept current by a
 * watcher. An open editor always wins over the copy on disk, so a concept typed
 * into one file a moment ago is offered in another without saving anything. The
 * tree of each file, and the merged tree of each root, are cached against a stamp
 * - the document version while a file is open, a counter while it is not - so
 * assembling a root costs nothing until something in it actually changes.
 */
export class ConceptRoots implements vscode.Disposable {
  /** Pattern to its member files, in merge order. */
  private readonly members = new Map<string, vscode.Uri[]>();
  /** File to the pattern that claimed it. */
  private readonly owner = new Map<string, string>();
  /** What each member holds on disk, for the ones no editor has open. */
  private readonly texts = new Map<string, string>();
  /** Bumped whenever a member changes on disk. */
  private readonly disk = new Map<string, number>();
  private readonly trees = new Map<string, { stamp: string; tree: ConceptNode }>();
  private readonly merged = new Map<string, { key: string; tree: ConceptNode }>();
  private readonly changeEmitter = new vscode.EventEmitter<string>();
  private readonly disposables: vscode.Disposable[] = [];
  private watchers: vscode.Disposable[] = [];
  private scan: Promise<void> = Promise.resolve();

  /** Fires with a pattern when the files of that root have changed. */
  readonly onDidChangeRoot = this.changeEmitter.event;

  constructor() {
    this.disposables.push(
      this.changeEmitter,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('pratyaya.roots')) {
          this.rescan();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.rescan())
    );
    this.rescan();
  }

  /** Resolves once the current scan has finished. */
  whenScanned(): Promise<void> {
    return this.scan;
  }

  /** The pattern whose root this file belongs to, if any. */
  patternFor(uri: vscode.Uri): string | undefined {
    return this.owner.get(uri.toString());
  }

  /** Every file sharing this one's tree, in merge order. Empty when it is in no root. */
  membersOf(uri: vscode.Uri): vscode.Uri[] {
    const pattern = this.patternFor(uri);
    return pattern === undefined ? [] : this.members.get(pattern) ?? [];
  }

  /** The whole root's tree, or undefined when this file is in no root. */
  treeFor(uri: vscode.Uri): ConceptNode | undefined {
    const pattern = this.patternFor(uri);
    if (pattern === undefined) {
      return undefined;
    }

    const members = this.members.get(pattern) ?? [];
    const key = members.map((member) => `${member.toString()}@${this.stampOf(member)}`).join('|');
    const cached = this.merged.get(pattern);
    if (cached && cached.key === key) {
      return cached.tree;
    }

    const trees: ConceptNode[] = [];
    for (const member of members) {
      const tree = this.treeOf(member);
      if (tree) {
        trees.push(tree);
      }
    }

    const tree = mergeTrees(trees);
    this.merged.set(pattern, { key, tree });
    return tree;
  }

  private rescan(): void {
    this.scan = this.discover().catch(() => {
      // A scan that cannot finish leaves every document on its own tree.
    });
  }

  private async discover(): Promise<void> {
    // Watchers are per pattern, so a rescan has to drop the old ones or a single
    // saved file would be announced once per scan that has ever run.
    this.clearWatchers();
    this.forgetAll();

    for (const pattern of patterns()) {
      this.watch(pattern);
      let found: vscode.Uri[];
      try {
        found = await vscode.workspace.findFiles(pattern, EXCLUDE);
      } catch {
        continue; // a malformed glob is the user's to fix, not a reason to fall over
      }

      // `join` leaves anything an earlier pattern claimed where it is, and keeps
      // what the watcher claimed for this one while the scan was still running:
      // a file event arriving mid-scan must not be dropped by the scan's result.
      for (const uri of found) {
        this.join(uri, pattern);
      }

      const members = this.members.get(pattern) ?? [];
      await Promise.all(members.map((uri) => this.read(uri)));
      this.changeEmitter.fire(pattern);
    }
  }

  /**
   * Watches one pattern across every workspace folder.
   *
   * The pattern has to be tied to a folder with `RelativePattern`. `findFiles`
   * reads a bare string as relative to the workspace, but a watcher matches one
   * against each file's absolute path, so the same glob that found the members
   * would quietly never fire again and nothing changed on disk would reach the
   * tree.
   */
  private watch(pattern: string): void {
    const touched = async (uri: vscode.Uri) => {
      if (!this.join(uri, pattern)) {
        return;
      }
      await this.read(uri);
      this.changeEmitter.fire(pattern);
    };

    const dropped = (uri: vscode.Uri) => {
      if (this.owner.get(uri.toString()) !== pattern) {
        return;
      }
      this.forget(uri);
      this.members.set(
        pattern,
        (this.members.get(pattern) ?? []).filter((member) => member.toString() !== uri.toString())
      );
      this.changeEmitter.fire(pattern);
    };

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, pattern)
      );
      this.watchers.push(
        watcher,
        watcher.onDidCreate(touched),
        watcher.onDidChange(touched),
        watcher.onDidDelete(dropped)
      );
    }
  }

  /** Takes a file into this pattern's root if no earlier pattern owns it. */
  private join(uri: vscode.Uri, pattern: string): boolean {
    const key = uri.toString();
    const owner = this.owner.get(key);
    if (owner === pattern) {
      return true;
    }
    if (owner !== undefined) {
      return false;
    }
    this.owner.set(key, pattern);
    this.members.set(pattern, sortByPath([...(this.members.get(pattern) ?? []), uri]));
    return true;
  }

  private async read(uri: vscode.Uri): Promise<void> {
    const key = uri.toString();
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      this.texts.set(key, new TextDecoder().decode(bytes));
    } catch {
      this.texts.delete(key); // deleted or unreadable: it simply contributes nothing
    }
    this.disk.set(key, (this.disk.get(key) ?? 0) + 1);
  }

  /** What identifies a member's current text, without reading it. */
  private stampOf(uri: vscode.Uri): string {
    const key = uri.toString();
    const open = openDocument(uri);
    return open ? `v${open.version}` : `d${this.disk.get(key) ?? 0}`;
  }

  private treeOf(uri: vscode.Uri): ConceptNode | undefined {
    const key = uri.toString();
    const stamp = this.stampOf(uri);
    const cached = this.trees.get(key);
    if (cached && cached.stamp === stamp) {
      return cached.tree;
    }

    const open = openDocument(uri);
    const text = open ? open.getText() : this.texts.get(key);
    if (text === undefined) {
      return undefined;
    }

    const tree = buildTree(text);
    this.trees.set(key, { stamp, tree });
    return tree;
  }

  private forget(uri: vscode.Uri): void {
    const key = uri.toString();
    this.owner.delete(key);
    this.texts.delete(key);
    this.disk.delete(key);
    this.trees.delete(key);
  }

  private forgetAll(): void {
    this.members.clear();
    this.owner.clear();
    this.texts.clear();
    this.disk.clear();
    this.trees.clear();
    this.merged.clear();
  }

  private clearWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }

  dispose() {
    this.clearWatchers();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
