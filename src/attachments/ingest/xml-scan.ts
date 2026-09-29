// "Eigen data" import — a deliberately tiny, LINEAR-time XML scanner for the
// two spreadsheet formats we read (Excel .xlsx, OpenDocument .ods). Untrusted
// input, so no regex with lazy `[\s\S]*?` over a whole document (quadratic when
// a closing tag is missing) and no general XML library: we only ever need
// "the elements called X, their attributes, and their inner text". Built on
// indexOf, one forward pass, no entity expansion beyond the five predefined
// ones (so a "billion laughs" DTD has nothing to expand).

export interface XmlElement {
  attrs: Record<string, string>;
  /** Raw inner XML (empty for a self-closing element). */
  inner: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  if (text.indexOf('&') === -1) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, body: string) => {
    if (body.startsWith('#x')) return safeCodePoint(parseInt(body.slice(2), 16), match);
    if (body.startsWith('#')) return safeCodePoint(parseInt(body.slice(1), 10), match);
    return ENTITIES[body] ?? match;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

/** Attributes of one start tag's text (`name="v" other='w'`). */
function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]!] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

/**
 * Every element named exactly `tag` (e.g. `c`, `table:table-row`) in document
 * order. Does not descend into a match — the caller re-scans `inner` for
 * children — so same-name nesting is not supported (none exists in the
 * formats we read at the levels we scan).
 */
export function* scanElements(xml: string, tag: string): Generator<XmlElement> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let pos = 0;
  while (pos < xml.length) {
    const start = xml.indexOf(open, pos);
    if (start === -1) return;
    const after = xml.charCodeAt(start + open.length);
    // Must be exactly this tag, not a longer name sharing the prefix.
    const isBoundary = after === 32 || after === 62 || after === 47 || after === 9 || after === 10 || after === 13;
    if (!isBoundary) {
      pos = start + open.length;
      continue;
    }
    const tagEnd = xml.indexOf('>', start);
    if (tagEnd === -1) return;
    const head = xml.slice(start + open.length, tagEnd);
    const selfClosing = head.endsWith('/');
    const attrs = parseAttrs(selfClosing ? head.slice(0, -1) : head);
    if (selfClosing) {
      yield { attrs, inner: '' };
      pos = tagEnd + 1;
      continue;
    }
    const end = xml.indexOf(close, tagEnd + 1);
    if (end === -1) return;
    yield { attrs, inner: xml.slice(tagEnd + 1, end) };
    pos = end + close.length;
  }
}

/** Concatenated, entity-decoded text of every `<tag>…</tag>` inside `xml`. */
export function textOf(xml: string, tag: string): string {
  let out = '';
  for (const el of scanElements(xml, tag)) out += decodeEntities(el.inner);
  return out;
}
