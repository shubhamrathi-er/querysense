import { Transform } from 'class-transformer';

/**
 * Strip HTML/script content and control characters from a string so stored
 * (and later rendered) free-text can't smuggle markup. Removes <script>/<style>
 * blocks entirely, then any remaining tags, drops control chars, and collapses
 * whitespace.
 */
export function sanitizeText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const noMarkup = value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '') // script/style blocks + content
    .replace(/<[^>]*>/g, '') // any remaining tags
    .replace(/\s/g, ' '); // normalise tabs/newlines to spaces first
  // Drop remaining control characters (code points < 32 and 127) — no control regex.
  const noControl = Array.from(noMarkup)
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c >= 32 && c !== 127;
    })
    .join('');
  return noControl.replace(/\s+/g, ' ').trim();
}

/** Trim a string (used for emails — IsEmail handles format). */
export function trimText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** DTO decorator: sanitize free-text input (strip HTML/script/control chars). */
export const SanitizeText = () => Transform(({ value }) => sanitizeText(value));

/** DTO decorator: trim surrounding whitespace. */
export const TrimText = () => Transform(({ value }) => trimText(value));
