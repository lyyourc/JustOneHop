import { t } from './i18n';
import type { ScriptRun, ScriptResult } from './types';

const running = new Set<number>();

async function targetTab(request: ScriptRun, sender: chrome.runtime.MessageSender) {
  if (!request || typeof request.scriptId !== 'string' || request.scriptId === 'builtin-ctrl-tab' ||
    !Number.isInteger(request.tabId) || !Number.isInteger(request.windowId) || typeof request.expectedUrl !== 'string') {
    throw new Error(t('errorScriptTarget'));
  }
  const popup = sender.url === chrome.runtime.getURL('popup.html');
  if (!popup && (!sender.tab || sender.tab.id !== request.tabId || sender.frameId !== 0)) throw new Error(t('errorScriptTarget'));
  const tab = await chrome.tabs.get(request.tabId);
  if (tab.windowId !== request.windowId || tab.url !== request.expectedUrl || tab.pendingUrl || !tab.active) throw new Error(t('errorScriptChanged'));
  if (!/^https?:\/\//.test(tab.url)) throw new Error(t('errorScriptUnsupported'));
  return tab;
}

/** This function is serialized and runs ONLY in Chrome's USER_SCRIPT world.
 * eval is deliberately confined to that world, never the extension or page MAIN world.
 * An invocation-local scope preserves Console-style completion values without leaking declarations between runs.
 */
export async function evaluateUserScript(source: string, expectedUrl: string): Promise<ScriptResult> {
  if (location.href !== expectedUrl) return { success: false, text: 'The page changed before execution.' };
  try {
    const evaluate = new Function('source', 'return eval(source);');
    const value: unknown = await evaluate(source);
    let text: string;
    if (typeof value === 'string') text = value;
    else if (value === undefined) text = 'undefined';
    else if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol' || (typeof value === 'number' && !Number.isFinite(value))) text = String(value);
    else text = JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? String(item) : item, 2);
    if (typeof text !== 'string') text = String(value);
    if (text.length > 1_000_000) return { success: false, text: 'Result exceeds 1,000,000 characters. Return a smaller value.' };
    return { success: true, text };
  } catch (error) {
    return { success: false, text: String(error).slice(0, 10000) };
  }
}

export async function runSavedScript(request: ScriptRun, sender: chrome.runtime.MessageSender): Promise<ScriptResult> {
  await targetTab(request, sender);
  if (running.has(request.tabId)) throw new Error(t('errorScriptBusy'));
  running.add(request.tabId);
  try {
    const key = `saved-script:${request.scriptId}`;
    const script = (await chrome.storage.local.get(key))[key] as { code?: unknown } | undefined;
    if (!script || typeof script.code !== 'string' || !script.code.trim()) throw new Error(t('errorScriptMissing'));
    const version = Number(globalThis.navigator?.userAgent.match(/(?:Chrome|Chromium)\/(\d+)/)?.[1]);
    if (version && version < 135) throw new Error(t('errorScriptVersion'));
    if (!chrome.userScripts) throw new Error(t('errorScriptDisabled'));
    if (!chrome.userScripts.execute) throw new Error(t('errorScriptVersion'));
    try {
      await chrome.userScripts.configureWorld({ worldId: 'zing-run', csp: "script-src 'self' 'unsafe-eval'", messaging: false });
    } catch { throw new Error(t('errorScriptDisabled')); }
    // Capture the document, not just its reusable tab/frame ID. A navigation
    // between this check and injection must never run the script in the new page.
    let documentId: string;
    try {
      const [frame] = await chrome.scripting.executeScript({ target: { tabId: request.tabId, frameIds: [0] }, func: () => location.href });
      if (!frame?.documentId || frame.result !== request.expectedUrl) throw new Error(t('errorScriptChanged'));
      if (!sender.url?.startsWith(chrome.runtime.getURL('')) && sender.documentId && sender.documentId !== frame.documentId) throw new Error(t('errorScriptChanged'));
      documentId = frame.documentId;
    } catch (error) {
      if (error instanceof Error && error.message === t('errorScriptChanged')) throw error;
      throw new Error(t('errorScriptAccess'));
    }
    await targetTab(request, sender);
    const code = `(${evaluateUserScript.toString()})(${JSON.stringify(script.code)}, ${JSON.stringify(request.expectedUrl)})`;
    let result: chrome.userScripts.InjectionResult<ScriptResult>[];
    try {
      result = await chrome.userScripts.execute<ScriptResult>({
        target: { tabId: request.tabId, documentIds: [documentId] }, world: 'USER_SCRIPT', worldId: 'zing-run', js: [{ code }],
      });
    } catch { throw new Error(t('errorScriptInterrupted')); }
    await targetTab(request, sender);
    const frame = result.find(frame => frame.documentId === documentId && frame.frameId === 0);
    if (!frame?.result || typeof frame.result.success !== 'boolean' || typeof frame.result.text !== 'string') throw new Error(t('errorScriptInterrupted'));
    return frame.result;
  } finally { running.delete(request.tabId); }
}
