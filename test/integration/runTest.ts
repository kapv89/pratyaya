import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main() {
  // Claude Code / the extension host set this, which would make the downloaded
  // VS Code binary start as plain Node and reject every launch flag.
  delete process.env.ELECTRON_RUN_AS_NODE;

  const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
  const extensionTestsPath = path.resolve(__dirname, './index');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    // No workspace folder: every test works on an untitled, never-saved buffer.
    launchArgs: ['--disable-extensions', '--disable-gpu'],
  });
}

main().catch((error) => {
  console.error('Integration tests failed:', error);
  process.exit(1);
});
