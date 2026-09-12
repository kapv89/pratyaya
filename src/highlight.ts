import * as vscode from 'vscode';
import { ConceptStore } from './store';

/** Bright blue on dark themes. */
export const DEFAULT_DARK_COLOR = '#05c3f9';

/** Deep red on light themes. */
export const DEFAULT_LIGHT_COLOR = '#800c0c';

/**
 * Colours every `$` concept expression, and every definition heading, in the open
 * editors.
 *
 * This runs as an editor decoration rather than a TextMate grammar so the colours
 * can come from settings and change without a reload.
 *
 * It does no work while you type. VS Code carries existing decorations along
 * with the text, so colours stay in place as prose around them is edited; they
 * only need recomputing when an expression or heading itself changes, which the
 * store reports once typing pauses. Decorations do not stretch at their edges,
 * so text typed straight after a reference is never coloured in the meantime.
 */
export class ConceptHighlighter implements vscode.Disposable {
  private decoration: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: ConceptStore,
    private readonly isEnabled: (document: vscode.TextDocument) => boolean
  ) {
    this.decoration = createDecoration();
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.applyAll()),
      store.onDidChangeSpans((document) => this.apply(document)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('pratyaya.conceptColor') ||
          event.affectsConfiguration('pratyaya.highlightConcepts') ||
          event.affectsConfiguration('pratyaya.enabledLanguages')
        ) {
          // Disposing the type clears what it drew, so stale colours cannot linger.
          this.decoration.dispose();
          this.decoration = createDecoration();
          this.applyAll();
        }
      })
    );
    this.applyAll();
  }

  private applyAll() {
    for (const editor of vscode.window.visibleTextEditors) {
      this.decorate(editor);
    }
  }

  /** Re-colours every editor showing this document. */
  private apply(document: vscode.TextDocument) {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document === document) {
        this.decorate(editor);
      }
    }
  }

  private decorate(editor: vscode.TextEditor) {
    const document = editor.document;
    if (!this.isEnabled(document) || !highlightingEnabled()) {
      editor.setDecorations(this.decoration, []);
      return;
    }

    const { spans, headingSpans } = this.store.analysis(document);
    const toRange = (span: { start: number; end: number }) =>
      new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));

    // A `#### $.a.b` line is coloured whole, but only once its concept is real.
    editor.setDecorations(this.decoration, [...spans, ...headingSpans].map(toRange));
  }

  dispose() {
    this.decoration.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

function highlightingEnabled(): boolean {
  return vscode.workspace.getConfiguration('pratyaya').get<boolean>('highlightConcepts', true);
}

function createDecoration(): vscode.TextEditorDecorationType {
  const configuration = vscode.workspace.getConfiguration('pratyaya');
  return vscode.window.createTextEditorDecorationType({
    // VS Code picks the branch matching the active theme kind.
    light: { color: configuration.get<string>('conceptColor.light', DEFAULT_LIGHT_COLOR) },
    dark: { color: configuration.get<string>('conceptColor.dark', DEFAULT_DARK_COLOR) },
    // Edges do not stretch over typed text; see the class comment for why.
    rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
  });
}
