import * as fs from 'node:fs';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

/**
 * A folder of real files for the tests that need them.
 *
 * Most tests work on an untitled, never-saved buffer, which is the sharpest way
 * to prove nothing is read from disk. Multi-file roots cannot: they match files
 * by glob against a workspace folder, and an untitled buffer belongs to none. So
 * the suite opens one, rebuilt from scratch each run, and the tests that write
 * into it keep to a subfolder of their own.
 */
function workspaceFolder(): string {
  const folder = path.resolve(__dirname, '../workspace');
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'README.md'), '# Pratyaya integration fixtures\n');
  return folder;
}

async function main() {
  // Claude Code / the extension host set this, which would make the downloaded
  // VS Code binary start as plain Node and reject every launch flag.
  delete process.env.ELECTRON_RUN_AS_NODE;

  const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
  const extensionTestsPath = path.resolve(__dirname, './index');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspaceFolder(), '--disable-extensions', '--disable-gpu'],
  });
}

main().catch((error) => {
  console.error('Integration tests failed:', error);
  process.exit(1);
});
