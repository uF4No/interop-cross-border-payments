import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const setupDir = path.resolve(scriptDir, '..');

const esbuildPackageJsonPath = path.join(setupDir, 'node_modules', 'esbuild', 'package.json');
const esbuildInstallPath = path.join(setupDir, 'node_modules', 'esbuild', 'install.js');
const esbuildBinPath = path.join(setupDir, 'node_modules', 'esbuild', 'bin', 'esbuild');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    ...options
  });
}

function verifyEsbuild() {
  try {
    const { version } = JSON.parse(readFileSync(esbuildPackageJsonPath, 'utf8'));
    const result = run(esbuildBinPath, ['--version'], { stdio: 'pipe' });

    return !result.error && result.status === 0 && result.stdout.trim() === version;
  } catch {
    return false;
  }
}

function ensureEsbuild() {
  if (verifyEsbuild()) {
    return;
  }

  const repair = run(process.execPath, [esbuildInstallPath], {
    cwd: setupDir,
    stdio: 'inherit'
  });

  if (repair.error) {
    throw repair.error;
  }

  if (repair.status !== 0 || !verifyEsbuild()) {
    process.exit(repair.status ?? 1);
  }
}

function main() {
  ensureEsbuild();

  const tsxPackageJsonPath = require.resolve('tsx/package.json', { paths: [setupDir] });
  const tsxPackageJson = JSON.parse(readFileSync(tsxPackageJsonPath, 'utf8'));
  const tsxCliPath = path.resolve(path.dirname(tsxPackageJsonPath), tsxPackageJson.bin);
  const result = run(process.execPath, [tsxCliPath, ...process.argv.slice(2)], {
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
}

main();
