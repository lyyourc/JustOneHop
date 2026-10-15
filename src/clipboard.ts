/** Use the focused UI document, including the overlay's isolated iframe. */
export async function copyText(value: string, anchor: HTMLElement) {
  const doc = anchor.ownerDocument;
  const field = doc.createElement('textarea');
  field.value = value;
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  anchor.closest('.palette')!.append(field);
  field.focus(); field.select();
  let copied = false;
  try { copied = doc.execCommand('copy'); } catch { /* Async clipboard is the fallback. */ }
  finally { field.remove(); anchor.focus({ preventScroll: true }); }
  if (!copied) await navigator.clipboard.writeText(value);
}
