import mark from '../docs/brand/logo-small-light.svg';

// Inline our bundled SVG so it inherits the palette's explicit or system theme.
const themedMark = mark.replaceAll('#5f6368', 'var(--muted)').replaceAll('#0b57d0', 'var(--accent)');
export function Logo({ size = 20 }: { size?: number }) {
  return <span className="brand-logo" aria-hidden="true" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: themedMark }} />;
}
