// Typed addresses are deliberately narrower than Chrome's general URL parser.
export function addressUrl(input: string): string | undefined {
  const text = input.trim();
  if (!text || /[\s\\\u0000-\u001f\u007f]/u.test(text)) return;
  const explicit = /^https?:\/\//i.test(text);
  const authority = text.split(/[/?#]/, 1)[0];
  const local = /^(?:localhost(?:\.|:|$)|127(?:\.\d+){3}(?::\d+)?$|\[::1\](?::\d+)?$)/i.test(authority);
  if (!explicit && !local && !/^(?:\[[\da-f:]+\]|[^:@]+\.[^:@]+)(?::\d+)?$/i.test(authority)) return;
  try {
    const url = new URL(explicit ? text : `${local ? 'http' : 'https'}://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return;
    if (!url.hostname.startsWith('[') && !url.hostname.split('.').every(label => /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label))) return;
    return url.href;
  } catch { return; }
}

export const addressNewTabShortcut = (isMac: boolean) => isMac ? 'Mod+Enter' : 'Alt+Enter';
