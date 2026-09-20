import * as path from 'node:path';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 20000 });
  for (const file of [
    'live.test.js',
    'suggest.test.js',
    'rename.test.js',
    'upgrade.test.js',
    'diagnostics.test.js',
  ]) {
    mocha.addFile(path.resolve(__dirname, file));
  }

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} integration test(s) failed`));
      } else {
        resolve();
      }
    });
  });
}
