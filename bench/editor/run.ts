import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main() {
  // Set by the extension host this is often launched from; it would make the
  // downloaded VS Code start as plain Node.
  delete process.env.ELECTRON_RUN_AS_NODE;

  const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath: path.resolve(__dirname, './index'),
    launchArgs: ['--disable-extensions', '--disable-gpu'],
  });
}

main().catch((error) => {
  console.error('Editor benchmark failed:', error);
  process.exit(1);
});
