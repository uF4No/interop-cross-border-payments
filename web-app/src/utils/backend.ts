export function getBackendUrl(path = ''): string {
  const baseUrl = import.meta.env.VITE_BACKEND_URL?.trim();

  if (!baseUrl) {
    throw new Error('VITE_BACKEND_URL is not configured.');
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.replace(/^\/+/, '');

  return normalizedPath ? `${normalizedBaseUrl}/${normalizedPath}` : normalizedBaseUrl;
}
