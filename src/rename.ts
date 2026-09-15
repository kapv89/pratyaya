import * as vscode from 'vscode';
import {
  conceptAt,
  definitionOf,
  isConceptName,
  renameRanges,
  resolveNode,
  referenceText as reference,
} from './concepts';
import { ConceptStore } from './store';
import { ConceptItem, ConceptTreeProvider } from './views';

const NAME_RULE = 'Use letters, digits, _ and - only.';

/**
 * F2 on a concept name renames the concept across the document: that name in
 * every `` `$.a.b` `` reference running through it, headings and code blocks
 * included, so everything beneath it moves with it.
 */
export class ConceptRenameProvider implements vscode.RenameProvider {
  constructor(private readonly store: ConceptStore) {}

  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position
  ): { range: vscode.Range; placeholder: string } {
    const target = occurrenceAt(document, position);
    return { range: target.range, placeholder: target.path[target.path.length - 1] };
  }

  provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string
  ): Promise<vscode.WorkspaceEdit> {
    return renameEdit(this.store, document, occurrenceAt(document, position).path, newName);
  }
}

/** The concept name under the cursor, or an error VS Code shows in place of the rename box. */
function occurrenceAt(document: vscode.TextDocument, position: vscode.Position) {
  // A reference never crosses a line, so the line is all there is to read.
  const found = conceptAt(document.lineAt(position.line).text, position.character);
  if (!found) {
    throw new Error('Put the cursor on a concept name in a `$.` reference to rename it.');
  }
  return {
    path: found.path,
    range: new vscode.Range(position.line, found.start, position.line, found.end),
  };
}

/**
 * The edit renaming the concept at `path` to `newName`. Renaming onto a concept
 * that already sits beside it merges the two, once confirmed; declining gives an
 * empty edit. A bad name, or a concept not in the document, is an error.
 */
export async function renameEdit(
  store: ConceptStore,
  document: vscode.TextDocument,
  path: string[],
  newName: string
): Promise<vscode.WorkspaceEdit> {
  const edit = new vscode.WorkspaceEdit();
  if (!isConceptName(newName)) {
    throw new Error(`"${newName}" is not a concept name. ${NAME_RULE}`);
  }
  if (newName === path[path.length - 1]) {
    return edit;
  }

  const tree = store.tree(document);
  const source = resolveNode(tree, path);
  if (!source) {
    throw new Error(`${reference(path)} is not in this document.`);
  }
  const targetPath = [...path.slice(0, -1), newName];
  const target = resolveNode(tree, targetPath);
  if (target) {
    const bothDefined = definitionOf(source) !== undefined && definitionOf(target) !== undefined;
    if (!(await confirmMerge(path, targetPath, bothDefined))) {
      return edit;
    }
  }

  for (const span of renameRanges(document.getText(), path)) {
    const range = new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
    edit.replace(document.uri, range, newName);
  }
  return edit;
}

async function confirmMerge(from: string[], to: string[], bothDefined: boolean): Promise<boolean> {
  const detail = [
    `Every reference to ${reference(from)}, and to everything beneath it, moves to ${reference(to)}, and their children combine.`,
  ];
  if (bothDefined) {
    detail.push('Both have a definition. Both headings stay, and the one later in the document wins.');
  }
  const choice = await vscode.window.showWarningMessage(
    `${reference(to)} already exists. Merge ${reference(from)} into it?`,
    { modal: true, detail: detail.join(' ') },
    'Merge'
  );
  return choice === 'Merge';
}

/**
 * Renames a concept from the Concepts view: the item it was invoked on, or the
 * selected one when run with F2. `newName` skips the input box. Resolves to
 * whether the document changed.
 */
export async function renameFromView(
  store: ConceptStore,
  view: ConceptTreeProvider,
  selection: readonly ConceptItem[],
  item?: ConceptItem,
  newName?: string
): Promise<boolean> {
  const concept = item ?? selection[0];
  const document = view.document;
  if (!concept || !document) {
    return false;
  }

  const oldName = concept.segments[concept.segments.length - 1];
  const name =
    newName ??
    (await vscode.window.showInputBox({
      title: `Rename ${reference(concept.segments)}`,
      prompt: 'Renames it in every reference, and everything beneath it moves too.',
      value: oldName,
      valueSelection: [0, oldName.length],
      validateInput: (value) => (isConceptName(value) ? undefined : NAME_RULE),
    }));
  if (name === undefined) {
    return false;
  }

  try {
    const edit = await renameEdit(store, document, concept.segments, name);
    return edit.size > 0 && (await vscode.workspace.applyEdit(edit));
  } catch (error) {
    vscode.window.showErrorMessage(`Pratyaya: ${(error as Error).message}`);
    return false;
  }
}
