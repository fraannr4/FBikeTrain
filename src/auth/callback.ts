/** Los callbacks vuelven al documento, fuera del fragmento reservado a HashRouter. */
export function callbackUrl(href: string, recovery = false): string {
  const url = new URL(href);
  url.search = recovery ? '?auth=recovery' : '';
  url.hash = '';
  return url.href;
}

export async function consumeAuthCallback(
  href: string,
  exchange: (code: string) => Promise<{ error: Error | null }>,
  replace: (path: string) => void,
): Promise<void> {
  const url = new URL(href);
  const code = url.searchParams.get('code');
  const denied = url.searchParams.has('error');
  if (!code && !denied) return;
  for (const key of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(key);
  replace(`${url.pathname}${url.search}${url.hash}`);
  if (denied) throw new Error('No se pudo completar el acceso. Inténtalo de nuevo.');
  const { error } = await exchange(code!);
  if (error) throw error;
}
