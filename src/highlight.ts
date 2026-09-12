import * as vscode from 'vscode';
import { conceptSpans } from './concepts';

/** Bright blue on dark themes. */
export const DEFAULT_DARK_COLOR = '#05c3f9';

/** Deep red on light themes. */
export const DEFAULT_LIGHT_COLOR = '#800c0c';

/**
 * Colours every `($)` concept expression in the open editors.
 *
 * This runs as an editor decoration rather than a TextMate grammar so the colours
 * can come from settings and change without a reload, and so the highlight tracks
 * the text as it is typed.
 */
export class ConceptHighlighter implements vscode.Disposable {
  private decoration: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly isEnabled: (document: vscode.TextDocument) => boolean) {
    this.decoration = createDecoration();
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.applyAll()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0) {
          this.apply(event.document);
        }
      }),
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
    if (!this.isEnabled(editor.document) || !highlightingEnabled()) {
      editor.setDecorations(this.decoration, []);
      return;
    }
    const text = editor.document.getText();
    editor.setDecorations(
      this.decoration,
      conceptSpans(text).map(
        (span) =>
          new vscode.Range(editor.document.positionAt(span.start), editor.document.positionAt(span.end))
      )
    );
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
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
}
