import { exec } from 'node:child_process';

export async function execCmd(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd }, (err, stdout, stderr) => {
      if (err !== null) {
        const details = [stdout, stderr].filter(Boolean).join('\n');
        const message = details ? `${err.message}\n${details}` : err.message;
        const wrapped = new Error(message);
        (wrapped as Error & { cause?: unknown }).cause = err;
        reject(wrapped);
        return;
      }

      resolve(stdout);
    });
  });
}
