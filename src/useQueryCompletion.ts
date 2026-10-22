import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from 'react';
import { queryCompletion } from './queryCompletion';
import type { UsageRecord } from './usage';
import type { SearchContinuation } from './types';
import { SEARCH_CONTINUATION_TTL, validContinuation } from './searchContinuation';

export function useQueryCompletion(input: RefObject<HTMLInputElement | null>, query: string, history: UsageRecord[], safeCommands: ReadonlySet<string>, enabled: boolean, onChange: (query: string) => void, continuation?: SearchContinuation) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!continuation) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, continuation.at + SEARCH_CONTINUATION_TTL - Date.now()));
    return () => clearTimeout(timer);
  }, [continuation]);
  const [atEnd, setAtEnd] = useState(true);
  const [composing, setComposing] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  const [scroll, setScroll] = useState(0);
  const previous = useRef({ query: '', value: '' });
  const candidate = useMemo(() => {
    if (validContinuation(continuation, now) && continuation.query.toLowerCase().startsWith(query.toLowerCase()) && continuation.query.length > query.length) {
      return query + continuation.query.slice(query.length);
    }
    // Keep an existing hint stable during background refreshes, but honor forgetting.
    const retained = previous.current.query === query && previous.current.value
      ? queryCompletion(history.filter(record => record.query === previous.current.value.toLowerCase()), query, safeCommands) : '';
    return retained || queryCompletion(history, query, safeCommands);
  }, [history, query, safeCommands, continuation, now]);
  useLayoutEffect(() => { previous.current = { query, value: candidate }; }, [query, candidate]);
  const value = enabled && atEnd && !composing && !suppressed ? candidate : '';
  function select() {
    const node = input.current;
    setAtEnd(!!node && node.selectionStart === node.value.length && node.selectionEnd === node.value.length);
    setScroll(node?.scrollLeft ?? 0);
  }
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    // React's select synthesis can miss selection changes inside the overlay iframe.
    const document = node.ownerDocument;
    document.addEventListener('selectionchange', select);
    return () => document.removeEventListener('selectionchange', select);
  }, [enabled]);
  function accept() {
    if (!value) return;
    onChange(value);
    setSuppressed(true);
    input.current?.focus();
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || composing) { event.stopPropagation(); return; }
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    const shortcut = (plain && ['Tab', 'ArrowRight'].includes(event.key)) ||
      (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'e');
    const node = event.currentTarget;
    if (value && shortcut && node.selectionStart === query.length && node.selectionEnd === query.length) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) accept();
    } else if (['Backspace', 'Delete'].includes(event.key)) setSuppressed(true);
  }
  return { value, scroll, accept, inputProps: {
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setSuppressed(next.length < query.length || (event.nativeEvent as InputEvent).inputType?.startsWith('delete') === true);
      onChange(next); select();
    },
    onSelect: select,
    onScroll: select,
    onKeyDown: keyDown,
    onCompositionStart: () => setComposing(true),
    onCompositionEnd: () => { setComposing(false); select(); },
  } };
}
