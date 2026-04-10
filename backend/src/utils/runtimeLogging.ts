import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync
} from 'node:fs';
import path from 'node:path';

const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_MAX_ARCHIVES = 4;
const INSTALL_KEY = '__crossBorderBackendRuntimeLogging__';

type WritableChunk = string | Uint8Array;

class RotatingLogFile {
  private readonly currentPath: string;
  private fd: number;
  private size: number;

  constructor(
    private readonly directoryPath: string,
    private readonly fileName: string,
    private readonly maxBytes = LOG_MAX_BYTES,
    private readonly maxArchives = LOG_MAX_ARCHIVES
  ) {
    mkdirSync(this.directoryPath, { recursive: true });
    this.currentPath = path.join(this.directoryPath, this.fileName);
    this.fd = openSync(this.currentPath, 'a');
    this.size = existsSync(this.currentPath) ? statSync(this.currentPath).size : 0;
  }

  write(chunk: WritableChunk) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);

    if (this.size > 0 && this.size + buffer.length > this.maxBytes) {
      this.rotate();
    }

    writeSync(this.fd, buffer);
    this.size += buffer.length;
  }

  close() {
    closeSync(this.fd);
  }

  private rotate() {
    closeSync(this.fd);

    const oldestArchivePath = this.archivePath(this.maxArchives);
    if (existsSync(oldestArchivePath)) {
      unlinkSync(oldestArchivePath);
    }

    for (let index = this.maxArchives - 1; index >= 1; index -= 1) {
      const sourcePath = this.archivePath(index);
      if (!existsSync(sourcePath)) {
        continue;
      }

      renameSync(sourcePath, this.archivePath(index + 1));
    }

    if (existsSync(this.currentPath)) {
      renameSync(this.currentPath, this.archivePath(1));
    }

    this.fd = openSync(this.currentPath, 'w');
    this.size = 0;
  }

  private archivePath(index: number) {
    const parsed = path.parse(this.fileName);
    return path.join(this.directoryPath, `${parsed.name}.${index}${parsed.ext}`);
  }
}

function appendSessionBanner(logFile: RotatingLogFile, label: string) {
  const timestamp = new Date().toISOString();
  logFile.write(`\n===== ${label} log session started ${timestamp} pid=${process.pid} =====\n`);
}

function patchStream(
  stream: NodeJS.WriteStream,
  logFile: RotatingLogFile
): NodeJS.WriteStream['write'] {
  const originalWrite = stream.write.bind(stream);

  stream.write = ((chunk: WritableChunk, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void) => {
    try {
      logFile.write(chunk);
    } catch (error) {
      originalWrite(
        `[runtime-logging] failed to write log chunk: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }

    return originalWrite(chunk as never, encoding as never, cb as never);
  }) as NodeJS.WriteStream['write'];

  return originalWrite;
}

export function initRuntimeLogging(label = 'backend') {
  const state = globalThis as typeof globalThis & {
    __crossBorderBackendRuntimeLogging__?: { restore: () => void };
  };

  if (state[INSTALL_KEY]) {
    return;
  }

  const packageRoot = path.resolve(process.argv[1] ? path.dirname(process.argv[1]) : process.cwd(), '..');
  const logDirectory = path.join(packageRoot, '.runtime');
  const logFile = new RotatingLogFile(logDirectory, `${label}.log`);

  appendSessionBanner(logFile, label);

  const stdoutWrite = patchStream(process.stdout, logFile);
  const stderrWrite = patchStream(process.stderr, logFile);

  const closeLog = () => {
    try {
      logFile.close();
    } catch {}
  };

  process.once('exit', closeLog);

  state[INSTALL_KEY] = {
    restore: () => {
      process.stdout.write = stdoutWrite;
      process.stderr.write = stderrWrite;
      closeLog();
      delete state[INSTALL_KEY];
    }
  };
}
