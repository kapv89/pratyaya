import * as vscode from 'vscode';
import { QUOTE } from './concepts';
import { legacyExpressions } from './legacy';

const UPGRADE = 'Upgrade';
const NEVER = 'Never ask again';

function offerEnabled(): boolean {
  return vscode.workspace.getConfiguration('pratyaya').get<boolean>('offerUpgrade', true);
}

function fileName(document: vscode.TextDocument): string {
  return document.uri.path.split('/').pop() || 'This document';
}

/**
 * Wraps every old-style expression in the document in backticks, as one edit so a
 * single undo reverts it. Resolves to how many were wrapped.
 */
export async function upgradeDocument(document: vscode.TextDocument): Promise<number> {
  const text = document.getText();
  const expressions = legacyExpressions(text);
  if (expressions.length === 0) {
    return 0;
  }
  const edit = new vscode.WorkspaceEdit();
  for (const { start, end } of expressions) {
    const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
    edit.replace(document.uri, range, QUOTE + text.slice(start, end) + QUOTE);
  }
  return (await vscode.workspace.applyEdit(edit)) ? expressions.length : 0;
}

/** The command: upgrades the active document and says what it did. */
export async function upgradeActiveDocument(): Promise<number> {
  const document = vscode.window.activeTextEditor?.document;
  if (!document) {
    return 0;
  }
  const count = await upgradeDocument(document);
  if (count === 0) {
    vscode.window.showInformationMessage(
      `Pratyaya: nothing to upgrade in ${fileName(document)}. Every concept expression outside code is already in backticks.`
    );
  } else {
    vscode.window.showInformationMessage(
      `Pratyaya: wrapped ${count} concept expression${count === 1 ? '' : 's'} in backticks in ${fileName(document)}. Undo reverts it.`
    );
  }
  return count;
}

/**
 * Offers to upgrade a document written in the old style when it comes up in an
 * editor. Each document is asked about at most once a session, and not at all
 * once "Never ask again" has turned `pratyaya.offerUpgrade` off.
 */
export class UpgradeOffer implements vscode.Disposable {
  private readonly asked = new Set<string>();
  /** Document versions already found clean, so switching tabs does not rescan them. */
  private readonly clean = new Map<string, number>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly isEnabled: (document: vscode.TextDocument) => boolean) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => this.check(editor?.document)),
      vscode.workspace.onDidCloseTextDocument((document) => this.clean.delete(document.uri.toString()))
    );
    this.check(vscode.window.activeTextEditor?.document);
  }

  private async check(document: vscode.TextDocument | undefined) {
    if (!document || !this.isEnabled(document) || !offerEnabled()) {
      return;
    }
    const key = document.uri.toString();
    // Diffs, git history and the like show documents that cannot be edited.
    if (
      this.asked.has(key) ||
      this.clean.get(key) === document.version ||
      vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) === false
    ) {
      return;
    }

    const text = document.getText();
    const expressions = legacyExpressions(text);
    if (expressions.length === 0) {
      this.clean.set(key, document.version);
      return;
    }
    this.asked.add(key);

    const count = expressions.length;
    const example = text.slice(expressions[0].start, expressions[0].end);
    const choice = await vscode.window.showInformationMessage(
      `Pratyaya: ${fileName(document)} has ${count} concept expression${count === 1 ? '' : 's'} in the old style, ` +
        `like ${example}. Pratyaya now reads them only inside backticks, like ${QUOTE}${example}${QUOTE}, ` +
        `which also stops the markdown preview rendering them as maths. ` +
        `Upgrade wraps each one in backticks, in one edit you can undo; code blocks and inline code are left as they are. ` +
        `You can also run "Pratyaya: Upgrade old-style concept expressions" later.`,
      UPGRADE,
      NEVER
    );

    if (choice === UPGRADE) {
      await upgradeDocument(document);
    } else if (choice === NEVER) {
      await vscode.workspace
        .getConfiguration('pratyaya')
        .update('offerUpgrade', false, vscode.ConfigurationTarget.Global);
    }
  }

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
