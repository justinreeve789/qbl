/**
 * The address an Open URL action opens, made absolute against `base` (the page the game is on):
 * only http and https, so an author's address can never run script (`javascript:`) or open
 * something other than a web page. Null when it is empty or not one of those.
 */
export function openableUrl(raw: string, base: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text, base);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}
