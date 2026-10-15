import { getDomain } from 'tldts';

/** Cookie access is checked against each cookie's own domain and Secure flag.
 * Include exact ancestor hosts up to the registrable domain, with both HTTP(S)
 * schemes. Never request sibling subdomains, public suffixes or other tenants.
 */
export function cookiePatterns(raw: string): string[] {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported cookie origin');
  let host = url.hostname;
  const domain = getDomain(host, { allowPrivateDomains: true }) || host;
  const hosts = [host];
  while (host !== domain && host.endsWith(`.${domain}`)) {
    host = host.slice(host.indexOf('.') + 1); hosts.push(host);
  }
  return hosts.map(host => `*://${host}/*`);
}
