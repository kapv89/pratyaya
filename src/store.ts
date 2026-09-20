import * as vscode from 'vscode';
import { analyze, Analysis, ConceptNode } from './concepts';
import { ConceptRoots } from './roots';

/** How long typing has to pause before colours and views catch up. */
const PUBLISH_DELAY_MS = 120;

interface Entry {
  /** Document version the analysis was made from. */
  version: number;
  analysis: Analysis;
}

/** What listeners were last told about, so unchanged results stay quiet. */
interface Published {
  treeKey: string;
  spanKey: string;
}

/**
 * Keeps one live analysis per open document: its `root` object, and what to
 * colour.
 *
 * Nothing is computed while you type. Once typing pauses, the document is
 * analysed once, and listeners hear about it only if what they show has actually
 * changed - which, for ordinary prose, it has not. Anything that needs the tree
 * immediately, like completion, has it computed on the spot from the current
 * text, so it is never stale either way.
 */
export class ConceptStore implements vscode.Disposable {
  private readonly entries = new Map<string, Entry>();
  private readonly published = new Map<string, Published>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly treeEmitter = new vscode.EventEmitter<vscode.TextDocument>();
  private readonly spanEmitter = new vscode.EventEmitter<vscode.TextDocument>();
  private readonly publishEmitter = new vscode.EventEmitter<vscode.TextDocument>();
  private readonly disposables: vscode.Disposable[] = [];

  /** Fires, once typing pauses, when a document's `root` object has changed. */
  readonly onDidChangeTree = this.treeEmitter.event;

  /** Fires, once typing pauses, when what should be coloured has changed. */
  readonly onDidChangeSpans = this.spanEmitter.event;

  /**
   * Fires, once typing pauses, whenever a document has been analysed afresh -
   * whether or not anything about it changed. Anything positioned by offset, as
   * diagnostics are, has to follow text moving around it, which the two events
   * above deliberately stay quiet about.
   */
  readonly onDidPublish = this.publishEmitter.event;

  constructor(
    private readonly isEnabled: (document: vscode.TextDocument) => boolean,
    private readonly roots?: ConceptRoots
  ) {
    if (roots) {
      // A file read from disk, or one saved in another window, moves the whole
      // root's tree without any document here having changed.
      this.disposables.push(roots.onDidChangeRoot((pattern) => this.announce(pattern)));
    }
    this.disposables.push(
      this.treeEmitter,
      this.spanEmitter,
      this.publishEmitter,
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0 && this.isEnabled(event.document)) {
          this.schedule(event.document);
        }
      }),
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (this.isEnabled(document)) {
          this.publish(document);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => this.forget(document))
    );

    for (const document of vscode.workspace.textDocuments) {
      if (this.isEnabled(document)) {
        this.publish(document);
      }
    }
  }

  /**
   * The `root` object this document writes into: the whole root's tree when it
   * belongs to one, and otherwise the tree of its own text.
   */
  tree(document: vscode.TextDocument): ConceptNode {
    return this.roots?.treeFor(document.uri) ?? this.analysis(document).tree;
  }

  /** Every file whose references build this document's tree, itself included. */
  members(document: vscode.TextDocument): vscode.Uri[] {
    const members = this.roots?.membersOf(document.uri) ?? [];
    return members.length > 0 ? members : [document.uri];
  }

  /** The document's analysis, as of its current text. */
  analysis(document: vscode.TextDocument): Analysis {
    const key = document.uri.toString();
    const entry = this.entries.get(key);
    if (entry && entry.version === document.version) {
      return entry.analysis;
    }
    const analysis = analyze(document.getText());
    this.entries.set(key, { version: document.version, analysis });
    return analysis;
  }

  /** Brings listeners up to date with the document, if anything changed for them. */
  private publish(document: vscode.TextDocument) {
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    if (document.isClosed) {
      return;
    }

    const analysis = this.analysis(document);
    const previous = this.published.get(key);
    this.published.set(key, { treeKey: analysis.treeKey, spanKey: analysis.spanKey });

    if (previous?.treeKey !== analysis.treeKey) {
      this.treeEmitter.fire(document);
    }
    if (previous?.spanKey !== analysis.spanKey) {
      this.spanEmitter.fire(document);
    }
    this.publishEmitter.fire(document);

    // One member's edit is a change to every member's tree.
    const pattern = this.roots?.patternFor(document.uri);
    if (pattern !== undefined) {
      this.announce(pattern, document);
    }
  }

  /** Tells the open files of a root that their shared tree has moved. */
  private announce(pattern: string, except?: vscode.TextDocument) {
    for (const document of vscode.workspace.textDocuments) {
      if (
        document !== except &&
        this.isEnabled(document) &&
        this.roots?.patternFor(document.uri) === pattern
      ) {
        this.treeEmitter.fire(document);
        this.publishEmitter.fire(document);
      }
    }
  }

  private schedule(document: vscode.TextDocument) {
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => this.publish(document), PUBLISH_DELAY_MS)
    );
  }

  private forget(document: vscode.TextDocument) {
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.entries.delete(key);
    this.published.delete(key);
  }

  dispose() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.timers.clear();
    this.entries.clear();
    this.published.clear();
  }
}
