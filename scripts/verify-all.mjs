import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = new URL('.', import.meta.url);
const scripts = readdirSync(directory).filter(name => /^verify-.*\.tsx?$/.test(name)).sort();
for (const script of scripts) {
  console.log(`\nChecking ${script}`);
  const result = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL(script, directory))], {
    stdio: 'inherit', cwd: new URL('..', directory),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`\nAll ${scripts.length} regression suites passed.`);
