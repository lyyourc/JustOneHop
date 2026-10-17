import { expect, type CDPSession, type Page } from '@playwright/test';

export async function focusClosedButton(cdp: CDPSession, name: string, index = 0, count = 1) {
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
  expect(frameId, 'The production overlay iframe must exist').toBeDefined();
  const buttons = async () => (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes
    .filter(node => node.role?.value === 'button' && node.name?.value === name);
  await expect.poll(async () => (await buttons()).length).toBe(count);
  const node = (await buttons())[index];
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendDOMNodeId });
  // AX resolves the actual button without opening either production shadow root.
  try {
    await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function() { this.focus(); }' });
  } finally {
    if (object.objectId) await cdp.send('Runtime.releaseObject', { objectId: object.objectId });
  }
  return frameId;
}

export async function pressNativeEnter(cdp: CDPSession, page: Page) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  if (!page.isClosed()) {
    try {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    } catch (error) {
      if (!page.isClosed()) throw error;
    }
  }
}
