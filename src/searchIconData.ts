const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function isSingleEmoji(value: string): boolean {
  return value.length <= 64 && [...segments.segment(value)].length === 1
    && (/\p{Extended_Pictographic}/u.test(value) || /^\p{Regional_Indicator}{2}$/u.test(value) || /^[#*0-9]️?⃣$/u.test(value));
}

export function normalizeSearchIcon(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (isSingleEmoji(value)) return value;
  // Only small, embedded PNGs produced by the image picker are persisted.
  if (value.length <= 32_768 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value)) return value;
  return undefined;
}

export async function prepareSearchIcon(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('image');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, at) => bytes[at] === byte);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!(file.type === 'image/png' ? png : file.type === 'image/jpeg' ? jpeg : webp)) throw new Error('image');
  const image = await createImageBitmap(file);
  try {
    if (!image.width || !image.height || image.width * image.height > 16_777_216) throw new Error('image');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('image');
    const scale = Math.min(64 / image.width, 64 / image.height);
    const width = image.width * scale, height = image.height * scale;
    context.drawImage(image, (64 - width) / 2, (64 - height) / 2, width, height);
    const result = normalizeSearchIcon(canvas.toDataURL('image/png'));
    if (!result) throw new Error('image');
    return result;
  } finally { image.close(); }
}
