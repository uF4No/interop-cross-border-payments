import type { Application, ApplicationUpsertBody, ApiClient } from './api-client';
import { extractRes, getApplications, postApplications, putApplication } from './api-client';

export const WEB_APP_ORIGIN = 'http://localhost:5000';
export const WEB_APP_REDIRECT_URIS = ['http://localhost:5000/auth-callback.html'];

function normalizeUris(uris: string[]): string[] {
  return [...new Set(uris.map((uri) => uri.trim()).filter(Boolean))].sort();
}

function applicationMatches(application: Application, desired: ApplicationUpsertBody): boolean {
  return (
    application.name === desired.name &&
    (application.origin ?? '') === desired.origin &&
    normalizeUris(application.oauthRedirectUris).join('\n') ===
      normalizeUris(desired.oauthRedirectUris).join('\n')
  );
}

async function listAllApplications(client: ApiClient): Promise<Application[]> {
  const applications: Application[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const page = extractRes(await getApplications(client, { limit: pageSize, offset }));
    applications.push(...page.items);

    if (applications.length >= page.pagination.totalItems) {
      break;
    }

    if (page.items.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return applications;
}

export async function ensureApplication(
  client: ApiClient,
  desired: ApplicationUpsertBody
): Promise<Application> {
  const applications = await listAllApplications(client);
  const existing =
    applications.find((application) => applicationMatches(application, desired)) ??
    applications.find((application) => application.name === desired.name);

  if (!existing) {
    return extractRes(await postApplications(client, desired));
  }

  if (applicationMatches(existing, desired)) {
    return existing;
  }

  return extractRes(await putApplication(client, existing.id, desired));
}
