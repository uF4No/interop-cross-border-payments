import fs from 'node:fs';
import type { Address, Hex } from 'viem';

type PermissionApiServiceName = 'permissions-api-l2a' | 'permissions-api-l2b';
type BundlerServiceName = 'bundler-l2a' | 'bundler-l2b';

type PermissionApiComposeServiceConfig = {
  serviceName: PermissionApiServiceName;
  ssoImplementation: Address;
  ssoBytecodeHash: Hex;
  bundlerRpcUrl?: string;
};

type BundlerComposeServiceConfig = {
  serviceName: BundlerServiceName;
  entryPoint: Address;
};

type UpdatePermissionApisComposeArgs = {
  composePath: string;
  services: PermissionApiComposeServiceConfig[];
  bundlers?: BundlerComposeServiceConfig[];
};

type ComposeUpdateServiceResult = {
  serviceName: PermissionApiServiceName;
  bundlerRpcUrl: string;
};

export type PermissionApiComposeUpdateResult = {
  composePath: string;
  services: ComposeUpdateServiceResult[];
  restartCommand: string;
};

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function toYamlString(value: string, forceQuoted = false): string {
  const trimmed = value.trim();
  if (!forceQuoted) {
    return trimmed;
  }

  const unquoted = stripWrappingQuotes(trimmed).replace(/"/g, '\\"');
  return `"${unquoted}"`;
}

function findServiceRange(lines: string[], serviceName: string): { start: number; end: number } {
  const start = lines.findIndex((line) => line.trim() === `${serviceName}:` && line.startsWith('  '));
  if (start < 0) {
    throw new Error(`Could not find service "${serviceName}" in docker-compose file`);
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line && /^  [a-zA-Z0-9_-]+:\s*$/.test(line)) {
      end = i;
      break;
    }
  }

  return { start, end };
}

function findEnvironmentRange(
  lines: string[],
  serviceStart: number,
  serviceEnd: number
): { start: number; end: number } {
  let environmentLine = -1;
  for (let i = serviceStart + 1; i < serviceEnd; i += 1) {
    const line = lines[i];
    if (line?.trim() === 'environment:') {
      environmentLine = i;
      break;
    }
  }

  if (environmentLine < 0) {
    throw new Error('Could not find environment block for permissions-api service');
  }

  let end = serviceEnd;
  for (let i = environmentLine + 1; i < serviceEnd; i += 1) {
    const line = lines[i];
    if (line && /^    [^ ].*:\s*$/.test(line)) {
      end = i;
      break;
    }
  }

  return { start: environmentLine + 1, end };
}

function readEnvValue(envLines: string[], key: string): string | undefined {
  const regex = new RegExp(`^      ${key}:\\s*(.+)\\s*$`);
  for (const line of envLines) {
    const match = line.match(regex);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function upsertEnvLine(
  envLines: string[],
  key: string,
  value: string,
  insertionIndex: number
): { nextEnvLines: string[]; nextInsertionIndex: number } {
  const prefix = `      ${key}:`;
  const lineIndex = envLines.findIndex((line) => line.startsWith(prefix));
  const rendered = `${prefix} ${value}`;

  if (lineIndex >= 0) {
    const nextEnvLines = [...envLines];
    nextEnvLines[lineIndex] = rendered;
    return { nextEnvLines, nextInsertionIndex: insertionIndex };
  }

  const nextEnvLines = [...envLines];
  nextEnvLines.splice(insertionIndex, 0, rendered);
  return { nextEnvLines, nextInsertionIndex: insertionIndex + 1 };
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

function renderCommandValueLine(line: string, value: string): string {
  const indentMatch = line.match(/^(\s*)/);
  const indent = indentMatch?.[1] ?? '        ';
  const hasComma = /,\s*$/.test(line);
  return `${indent}"${value}"${hasComma ? ',' : ''}`;
}

function replaceInlineEntrypointValue(line: string, entryPoint: string): string | null {
  const patterns = [
    /(--entrypoints\s+\")([^"]+)(\")/,
    /(--entrypoints\s+\')([^']+)(\')/
  ];

  for (const pattern of patterns) {
    if (pattern.test(line)) {
      return line.replace(pattern, `$1${entryPoint}$3`);
    }
  }

  return null;
}

function setBundlerEntrypoint(
  lines: string[],
  serviceName: BundlerServiceName,
  entryPoint: Address
): void {
  const normalizedEntryPoint = entryPoint.toLowerCase();
  const { start: serviceStart, end: serviceEnd } = findServiceRange(lines, serviceName);
  const { start: envStart, end: envEnd } = findEnvironmentRange(lines, serviceStart, serviceEnd);

  const envLines = lines.slice(envStart, envEnd);
  const envUpdate = upsertEnvLine(
    envLines,
    'BUNDLER_ENTRYPOINTS',
    toYamlString(normalizedEntryPoint, true),
    envLines.length
  );
  lines.splice(envStart, envEnd - envStart, ...envUpdate.nextEnvLines);

  for (let i = serviceStart + 1; i < serviceEnd - 1; i += 1) {
    if (lines[i]?.includes('"--entrypoints"')) {
      lines[i + 1] = renderCommandValueLine(lines[i + 1] ?? '        "",', normalizedEntryPoint);
      return;
    }
  }

  for (let i = serviceStart + 1; i < serviceEnd; i += 1) {
    const line = lines[i];
    if (!line?.includes('--entrypoints')) {
      continue;
    }

    if (
      line.includes('$$ENTRYPOINT') ||
      line.includes('$ENTRYPOINT') ||
      line.includes('${ENTRYPOINT}') ||
      line.includes('$${ENTRYPOINT}')
    ) {
      return;
    }

    const replaced = replaceInlineEntrypointValue(line, normalizedEntryPoint);
    if (replaced) {
      lines[i] = replaced;
      return;
    }
  }

  throw new Error(`Could not find a supported entrypoint configuration for ${serviceName}`);
}

function defaultBundlerRpcUrlForService(serviceName: PermissionApiServiceName): string {
  return serviceName === 'permissions-api-l2a'
    ? 'http://bundler-l2a:4337'
    : 'http://bundler-l2b:4337';
}

export function updatePermissionApisCompose(
  args: UpdatePermissionApisComposeArgs
): PermissionApiComposeUpdateResult {
  if (!fs.existsSync(args.composePath)) {
    throw new Error(`Docker compose file not found: ${args.composePath}`);
  }

  const currentContent = normalizeLineEndings(fs.readFileSync(args.composePath, 'utf8'));
  const lines = currentContent.split('\n');
  const servicesSummary: ComposeUpdateServiceResult[] = [];

  for (const serviceConfig of args.services) {
    const { start: serviceStart, end: serviceEnd } = findServiceRange(lines, serviceConfig.serviceName);
    const { start: envStart, end: envEnd } = findEnvironmentRange(lines, serviceStart, serviceEnd);

    let envLines = lines.slice(envStart, envEnd);
    const sequencerRpcUrl = readEnvValue(envLines, 'SEQUENCER_RPC_URL');
    const bundlerRpcRaw =
      serviceConfig.bundlerRpcUrl ??
      defaultBundlerRpcUrlForService(serviceConfig.serviceName) ??
      sequencerRpcUrl;
    if (!bundlerRpcRaw) {
      throw new Error(
        `Missing SEQUENCER_RPC_URL in ${serviceConfig.serviceName} and no explicit bundlerRpcUrl provided`
      );
    }

    const insertionAnchor = envLines.findIndex((line) => line.startsWith('      SEQUENCER_RPC_URL:'));
    let insertionIndex =
      insertionAnchor >= 0
        ? insertionAnchor + 1
        : envLines.findIndex((line) => line.startsWith('      <<:')) + 1;
    if (insertionIndex <= 0) {
      insertionIndex = envLines.length;
    }

    const entries: Array<{ key: string; value: string }> = [
      { key: 'BUNDLER_ENABLED', value: toYamlString('true', true) },
      { key: 'BUNDLER_RPC_URL', value: toYamlString(bundlerRpcRaw) },
      {
        key: 'DISPATCHER_SSO_IMPLEMENTATIONS',
        value: toYamlString(serviceConfig.ssoImplementation)
      },
      {
        key: 'DISPATCHER_SSO_BYTECODE_HASHES',
        value: toYamlString(serviceConfig.ssoBytecodeHash)
      }
    ];

    for (const entry of entries) {
      const result = upsertEnvLine(envLines, entry.key, entry.value, insertionIndex);
      envLines = result.nextEnvLines;
      insertionIndex = result.nextInsertionIndex;
    }

    lines.splice(envStart, envEnd - envStart, ...envLines);
    servicesSummary.push({
      serviceName: serviceConfig.serviceName,
      bundlerRpcUrl: stripWrappingQuotes(bundlerRpcRaw)
    });
  }

  for (const bundlerConfig of args.bundlers ?? []) {
    setBundlerEntrypoint(lines, bundlerConfig.serviceName, bundlerConfig.entryPoint);
  }

  const nextContent = `${lines.join('\n').replace(/\n*$/, '\n')}`;
  if (nextContent !== currentContent) {
    fs.writeFileSync(args.composePath, nextContent, 'utf8');
  }

  return {
    composePath: args.composePath,
    services: servicesSummary,
    restartCommand:
      'docker compose -f prividium-3chain-local/docker-compose.yml up -d --no-deps --force-recreate bundler-l2a bundler-l2b permissions-api-l2a permissions-api-l2b'
  };
}
