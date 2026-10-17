/** Close extension surfaces before their runtime context becomes invalid. */
export async function reloadExtension(onPrepared?: () => void): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const panels = new Set(['popup.html', 'switcher.html'].map(path => chrome.runtime.getURL(path)));
  // Acknowledge before removing extension pages. Explicit cleanup below also
  // handles overlays whose caller disappears before receiving this reply.
  onPrepared?.();
  await Promise.all(tabs.map(async tab => {
    if (tab.id === undefined) return;
    const url = (tab.url || '').split(/[?#]/)[0];
    if (panels.has(url)) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    } else {
      // Most pages have no injected palette; a missing receiver is expected.
      await chrome.tabs.sendMessage(tab.id, { source: 'zing', type: 'close-for-reload' }, { frameId: 0 }).catch(() => {});
    }
  }));
  chrome.runtime.reload();
}
