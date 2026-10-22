import { useState, useSyncExternalStore } from 'react';
import { Logo } from './Logo';
import { getPreferences, subscribePreferences } from './preferences';

function ImageIcon({ value, size }: { value: string; size: number }) {
  const [failed, setFailed] = useState(false);
  return failed ? <Logo size={size} /> : <img src={value} width={size} height={size} alt="" draggable={false} onError={() => setFailed(true)} />;
}

export function SearchIconPreview({ value, size = 20 }: { value?: string; size?: number }) {
  if (!value) return <Logo size={size} />;
  return <span className="custom-search-icon" aria-hidden="true" style={{ width: size, height: size, fontSize: size }}>
    {value.startsWith('data:') ? <ImageIcon key={value} value={value} size={size} /> : value}
  </span>;
}

export function SearchIcon({ size = 20 }: { size?: number }) {
  const { searchIcon } = useSyncExternalStore(subscribePreferences, getPreferences);
  return <SearchIconPreview value={searchIcon} size={size} />;
}
