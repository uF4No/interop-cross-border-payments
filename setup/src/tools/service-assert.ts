import { z } from 'zod';

function normalizeBaseUrl(rawBaseUrl: string): string {
  return rawBaseUrl.replace(/\/+$/, '');
}

async function checkHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function assertPrividiumApiUp(baseUrl: string): Promise<string> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const base = new URL(normalizedBaseUrl);
  const origin = base.origin;
  const candidates = [
    normalizedBaseUrl,
    new URL('/api', normalizedBaseUrl).toString(),
    origin,
    new URL('/api', origin).toString()
  ];

  for (const candidate of candidates) {
    const healthPaths = [
      new URL('/health', candidate).toString(),
      new URL('/api/health', candidate).toString()
    ];
    for (const path of healthPaths) {
      if (await checkHealth(path)) {
        if (path.endsWith('/api/health')) {
          return normalizeBaseUrl(new URL('/api', candidate).toString());
        }
        return normalizeBaseUrl(candidate);
      }
    }
  }

  console.error(
    'Invalid response from prividium api. Please start local prividium api and try again'
  );
  process.exit(1);
}

const chainIdSchema = z.object({
  result: z.coerce.bigint()
});

export async function assertZksyncOsIsUp(url: string, expectedChainId?: bigint) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'check-if-alive',
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: []
      })
    });

    if (res.status !== 200) {
      console.error('Invalid response from zksyncos. Cannot continue with setup.');
      process.exit(1);
    }

    const json = await res.json();
    const parsed = chainIdSchema.safeParse(json);

    if (!parsed.success) {
      console.error(`Unexpected response interacting with rpc: ${JSON.stringify(json)}`);
      process.exit(1);
    }
    if (expectedChainId !== undefined && parsed.data.result !== expectedChainId) {
      console.error(
        `Unexpected network id from zksyncos. expected: ${expectedChainId} , received: ${parsed.data.result}`
      );
      process.exit(1);
    }
  } catch {
    console.error('zksyncos down. Please start deps and try again');
    process.exit(1);
  }
}
