import * as vscode from 'vscode';
import {
  conceptAt,
  definitionInsertion,
  undefinedConcepts,
  referenceText,
  FUNCTION_ACCESSOR,
  OPENER,
} from './concepts';
import { ConceptStore } from './store';

/** What the Problems panel shows beside the message. */
const SOURCE = 'Pratyaya';

/** Identifies this diagnostic, so it can be filtered or disabled by rule. */
const CODE = 'undefined-concept';

/**
 * How loudly an undefined concept is reported. `off` is any other value, so a
 * setting written by hand that Pratyaya does not recognise stays quiet rather
 * than falling back to something noisy.
 */
const SEVERITIES: Record<string, vscode.DiagnosticSeverity> = {
  hint: vscode.DiagnosticSeverity.Hint,
  information: vscode.DiagnosticSeverity.Information,
  warning: vscode.DiagnosticSeverity.Warning,
};

function severity(): vscode.DiagnosticSeverity | undefined {
  const setting = vscode.workspace
    .getConfiguration('pratyaya')
    .get<string>('undefinedConcepts', 'information');
  return SEVERITIES[setting];
}

/** What to tell the writer about a concept they have named but not explained. */
function message(path: string[]): string {
  const walk = `${OPENER}${FUNCTION_ACCESSOR}define.${path.join('.')}`;
  return `${referenceText(path)} is referenced but never defined. Type ${walk} at the start of a line to define it.`;
}

/**
 * Reports every concept the document references but never defines.
 *
 * Each one is reported once, on its own name in the first reference that reaches
 * it, so the Problems panel reads as the list of concepts still to pin down
 * rather than one entry per mention.
 *
 * Unlike colours, which VS Code carries along with the text, a diagnostic is
 * placed by offset and has to be rewritten whenever text moves around it. So this
 * follows `onDidPublish` - every analysis - rather than the narrower tree and span
 * events. That is still only once per pause in typing, and nothing at all is
 * computed while the setting is `off`.
 */
export class UndefinedConceptDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('pratyaya');
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: ConceptStore,
    private readonly isEnabled: (document: vscode.TextDocument) => boolean
  ) {
    this.disposables.push(
      this.collection,
      store.onDidPublish((document) => this.refresh(document)),
      vscode.workspace.onDidCloseTextDocument((document) => this.collection.delete(document.uri)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('pratyaya.undefinedConcepts') ||
          event.affectsConfiguration('pratyaya.enabledLanguages')
        ) {
          this.refreshAll();
        }
      })
    );
    // The store publishes the already-open documents from its own constructor,
    // before this one exists, so the first pass is made here.
    this.refreshAll();
  }

  private refreshAll() {
    this.collection.clear();
    for (const document of vscode.workspace.textDocuments) {
      this.refresh(document);
    }
  }

  private refresh(document: vscode.TextDocument) {
    const level = severity();
    if (level === undefined || !this.isEnabled(document)) {
      this.collection.delete(document.uri);
      return;
    }

    const found = undefinedConcepts(document.getText(), this.store.tree(document));
    this.collection.set(
      document.uri,
      found.map((concept) => {
        const range = new vscode.Range(
          document.positionAt(concept.start),
          document.positionAt(concept.end)
        );
        const diagnostic = new vscode.Diagnostic(range, message(concept.path), level);
        diagnostic.source = SOURCE;
        diagnostic.code = CODE;
        return diagnostic;
      })
    );
  }

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

/**
 * The quick fix on an undefined concept: write its definition heading, in the run
 * of definitions the spec already keeps, and put the cursor where the body goes.
 */
export class DefineConceptActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== SOURCE || diagnostic.code !== CODE) {
        continue;
      }
      const action = defineAction(document, diagnostic);
      if (action) {
        actions.push(action);
      }
    }
    return actions;
  }
}

function defineAction(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic
): vscode.CodeAction | undefined {
  const start = diagnostic.range.start;
  // The diagnostic sits on the concept's own name, which is what names the path.
  const found = conceptAt(document.lineAt(start.line).text, start.character);
  if (!found) {
    return undefined;
  }

  const insertion = definitionInsertion(
    document.getText(),
    found.path,
    document.offsetAt(start)
  );

  const action = new vscode.CodeAction(
    `Define ${referenceText(found.path)}`,
    vscode.CodeActionKind.QuickFix
  );
  action.diagnostics = [diagnostic];
  action.isPreferred = true;
  action.edit = new vscode.WorkspaceEdit();
  action.edit.insert(document.uri, document.positionAt(insertion.offset), insertion.text);
  // VS Code applies the edit before running this, so the offset is the one the
  // block will occupy once it is written.
  action.command = {
    command: 'pratyaya.revealDefinition',
    title: 'Write the definition',
    arguments: [document.uri, insertion.offset + insertion.cursor],
  };

  return action;
}

/** Puts the cursor on the empty body line, once the quick fix has written the heading. */
export function revealDefinition(uri: vscode.Uri, offset: number) {
  const editor = vscode.window.visibleTextEditors.find(
    (candidate) => candidate.document.uri.toString() === uri.toString()
  );
  if (!editor) {
    return;
  }
  const position = editor.document.positionAt(offset);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport
  );
}
