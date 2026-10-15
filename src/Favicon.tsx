import { useState, type ReactNode } from 'react';

/** Chrome serves its own favicon cache; never contact a third-party icon service. */
export function Favicon({ pageUrl, fallback }: { pageUrl?: string; fallback: ReactNode }) {
  const [loadedUrl, setLoadedUrl] = useState('');
  const [failedUrl, setFailedUrl] = useState('');
  let src: string | undefined;
  if (pageUrl && /^(https?|file):/i.test(pageUrl)) {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', '32');
    src = url.href;
  }
  return <>
    {(!src || loadedUrl !== src || failedUrl === src) ? fallback : null}
    {src && failedUrl !== src ? <img className={`entry-favicon ${loadedUrl === src ? 'loaded' : ''}`} src={src} alt="" draggable={false}
      referrerPolicy="no-referrer" onLoad={() => setLoadedUrl(src)} onError={() => setFailedUrl(src)} /> : null}
  </>;
}
