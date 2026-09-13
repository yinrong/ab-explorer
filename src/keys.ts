/** 相对 workspace root 的目录/文件"键"：统一用 posix 风格 `/` 分隔，根目录用空串 `''`。 */

export function toKey(relDirPosix: string): string {
  if (relDirPosix === '.' || relDirPosix === '') return '';
  return relDirPosix.split('\\').join('/');
}

export function parentKeyOf(key: string): string {
  if (!key) return '';
  const idx = key.lastIndexOf('/');
  return idx === -1 ? '' : key.slice(0, idx);
}

export function baseNameOf(key: string): string {
  const idx = key.lastIndexOf('/');
  return idx === -1 ? key : key.slice(idx + 1);
}

export function keyToSegments(key: string): string[] {
  return key ? key.split('/') : [];
}

export function childKey(parentKey: string, name: string): string {
  return parentKey ? `${parentKey}/${name}` : name;
}
