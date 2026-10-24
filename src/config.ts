/**
 * Deployment-dependent links. Nothing is hard-coded to a placeholder: if a link cannot be
 * determined it is omitted from the interface rather than pointing somewhere wrong.
 */
function inferRepositoryUrl(): string | null {
  const configured = import.meta.env.VITE_REPOSITORY_URL as string | undefined;
  if (configured) return configured;
  if (typeof window === 'undefined') return null;
  const { hostname, pathname } = window.location;
  const match = /^([a-z0-9-]+)\.github\.io$/i.exec(hostname);
  if (!match) return null;
  const repo = pathname.split('/').filter(Boolean)[0];
  return repo
    ? `https://github.com/${match[1]}/${repo}`
    : `https://github.com/${match[1]}/${match[1]}.github.io`;
}

export const REPOSITORY_URL: string | null = inferRepositoryUrl();
export const PORTFOLIO_URL: string | null =
  (import.meta.env.VITE_PORTFOLIO_URL as string | undefined) || null;

export function docsUrl(file: string): string | null {
  return REPOSITORY_URL ? `${REPOSITORY_URL}/blob/main/docs/${file}` : null;
}
