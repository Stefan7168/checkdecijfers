// A small, strict XML reader for Eurostat's SDMX 2.1 structure messages (#357 study step 1, ADR 048
// addendum "structure reader").
//
// Why our own reader: Eurostat serves the structure messages we need (a dataflow with its code lists, and
// the content constraint) ONLY as SDMX-ML. Checked live 2026-09-30 (the study's Assumption A3): the SDMX-JSON
// Accept header gets 406 on both the 2.1 and 3.0 structure endpoints, and `format=JSON` is refused with
// "Only option supported in returnDetails for json-stat format is references=none" — which returns the
// dataset's annotations but no dimensions or codes. The repo has no XML dependency, and these messages use a
// tiny, regular subset of XML, so a strict ~200-line reader is cheaper to trust than a general library.
//
// Strict, fail-closed (principle c): anything outside that subset throws `XmlParseError` rather than being
// read by guesswork — a DOCTYPE/DTD (never expanded: no entity tricks), a processing instruction other than
// the leading XML declaration, an unknown entity, an unbound namespace prefix, a duplicate attribute, a
// mismatched end tag, text outside the root element, or input over the size/depth limits.

export class XmlParseError extends Error {
  constructor(message: string, offset: number) {
    super(`XML parse error at offset ${offset}: ${message}`);
    this.name = 'XmlParseError';
  }
}

export interface XmlElement {
  /** The element's namespace URI, or null for an unqualified element (SDMX's `Ref`). */
  ns: string | null;
  /** The local name (prefix removed). */
  name: string;
  /** Attributes by their name AS WRITTEN (`id`, `xml:lang`); namespace declarations are not included. */
  attributes: Record<string, string>;
  children: XmlElement[];
  /** The element's own character data (its direct text and CDATA, concatenated; not its children's). */
  text: string;
}

/** Larger than any structure message we request (the biggest measured: ~0.5 MB, prc_hicp_minr). */
const MAX_INPUT_CHARS = 64 * 1024 * 1024;
const MAX_DEPTH = 64;

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const NAME_RE = /[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?/y;
const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(raw: string, offset: number): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&([^;&\s]*);?/g, (match, body: string) => {
    if (!match.endsWith(';')) throw new XmlParseError(`unterminated entity reference '${match}'`, offset);
    if (body in PREDEFINED) return PREDEFINED[body]!;
    const numeric = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(body);
    if (numeric) {
      const cp = numeric[1] !== undefined ? parseInt(numeric[1], 16) : parseInt(numeric[2]!, 10);
      if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        throw new XmlParseError(`invalid character reference '${match}'`, offset);
      }
      return String.fromCodePoint(cp);
    }
    throw new XmlParseError(`unknown entity '${match}' (only the five predefined entities and character references are read)`, offset);
  });
}

interface OpenElement {
  qname: string;
  element: XmlElement;
  scope: Map<string, string | null>;
}

function resolve(qname: string, scope: Map<string, string | null>, isAttribute: boolean, offset: number): { ns: string | null; local: string } {
  const colon = qname.indexOf(':');
  if (colon < 0) return { ns: isAttribute ? null : (scope.get('') ?? null), local: qname };
  const prefix = qname.slice(0, colon);
  if (prefix === 'xml') return { ns: XML_NS, local: qname.slice(colon + 1) };
  const ns = scope.get(prefix);
  if (ns === undefined || ns === null) throw new XmlParseError(`unbound namespace prefix '${prefix}'`, offset);
  return { ns, local: qname.slice(colon + 1) };
}

/** Parses one XML document into its root element. Throws `XmlParseError` on anything outside the subset. */
export function parseXml(input: string): XmlElement {
  if (typeof input !== 'string') throw new XmlParseError('input is not a string', 0);
  if (input.length > MAX_INPUT_CHARS) throw new XmlParseError(`input is larger than ${MAX_INPUT_CHARS} characters`, 0);
  let pos = input.charCodeAt(0) === 0xfeff ? 1 : 0;

  // The optional XML declaration, only at the very start.
  if (input.startsWith('<?xml', pos) && /\s/.test(input[pos + 5] ?? '')) {
    const end = input.indexOf('?>', pos);
    if (end < 0) throw new XmlParseError('unterminated XML declaration', pos);
    const decl = input.slice(pos, end);
    const enc = /encoding\s*=\s*["']([^"']+)["']/.exec(decl);
    if (enc && enc[1]!.toUpperCase() !== 'UTF-8') {
      throw new XmlParseError(`unsupported encoding '${enc[1]}' (only UTF-8 is read)`, pos);
    }
    pos = end + 2;
  }

  const stack: OpenElement[] = [];
  let root: XmlElement | null = null;
  const rootScope = new Map<string, string | null>();

  const readName = (): string => {
    NAME_RE.lastIndex = pos;
    const m = NAME_RE.exec(input);
    if (!m) throw new XmlParseError('expected a name', pos);
    pos += m[0].length;
    return m[0];
  };
  const skipSpace = (): void => {
    while (pos < input.length && /\s/.test(input[pos]!)) pos++;
  };
  const appendText = (text: string, at: number): void => {
    const top = stack[stack.length - 1];
    if (top === undefined) {
      if (text.trim().length > 0) throw new XmlParseError('text outside the root element', at);
      return;
    }
    top.element.text += text;
  };

  while (pos < input.length) {
    const lt = input.indexOf('<', pos);
    if (lt < 0) {
      appendText(decodeEntities(input.slice(pos), pos), pos);
      pos = input.length;
      break;
    }
    if (lt > pos) appendText(decodeEntities(input.slice(pos, lt), pos), pos);
    pos = lt;

    if (input.startsWith('<!--', pos)) {
      const end = input.indexOf('-->', pos + 4);
      if (end < 0) throw new XmlParseError('unterminated comment', pos);
      pos = end + 3;
      continue;
    }
    if (input.startsWith('<![CDATA[', pos)) {
      const end = input.indexOf(']]>', pos + 9);
      if (end < 0) throw new XmlParseError('unterminated CDATA section', pos);
      if (stack.length === 0) throw new XmlParseError('CDATA outside the root element', pos);
      appendText(input.slice(pos + 9, end), pos);
      pos = end + 3;
      continue;
    }
    if (input.startsWith('<!', pos)) throw new XmlParseError('DOCTYPE/DTD and other declarations are refused', pos);
    if (input.startsWith('<?', pos)) throw new XmlParseError('processing instructions are refused', pos);

    if (input.startsWith('</', pos)) {
      pos += 2;
      const qname = readName();
      skipSpace();
      if (input[pos] !== '>') throw new XmlParseError(`malformed end tag '</${qname}'`, pos);
      pos++;
      const open = stack.pop();
      if (!open || open.qname !== qname) {
        throw new XmlParseError(`end tag '</${qname}>' does not match '${open ? `<${open.qname}>` : 'nothing'}'`, pos);
      }
      continue;
    }

    // A start tag.
    const tagAt = pos;
    pos++;
    const qname = readName();
    const rawAttributes: [string, string][] = [];
    const seen = new Set<string>();
    let selfClosing = false;
    for (;;) {
      const before = pos;
      skipSpace();
      if (input.startsWith('/>', pos)) {
        pos += 2;
        selfClosing = true;
        break;
      }
      if (input[pos] === '>') {
        pos++;
        break;
      }
      if (pos === before) throw new XmlParseError(`expected whitespace, '>' or '/>' in <${qname}>`, pos);
      const attrName = readName();
      skipSpace();
      if (input[pos] !== '=') throw new XmlParseError(`attribute '${attrName}' has no value`, pos);
      pos++;
      skipSpace();
      const quote = input[pos];
      if (quote !== '"' && quote !== "'") throw new XmlParseError(`attribute '${attrName}' value is not quoted`, pos);
      const end = input.indexOf(quote, pos + 1);
      if (end < 0) throw new XmlParseError(`unterminated value of attribute '${attrName}'`, pos);
      const rawValue = input.slice(pos + 1, end);
      if (rawValue.includes('<')) throw new XmlParseError(`'<' in the value of attribute '${attrName}'`, pos);
      if (seen.has(attrName)) throw new XmlParseError(`duplicate attribute '${attrName}' on <${qname}>`, pos);
      seen.add(attrName);
      rawAttributes.push([attrName, decodeEntities(rawValue, pos).replace(/[\t\n\r]/g, ' ')]);
      pos = end + 1;
    }

    const parentScope = stack[stack.length - 1]?.scope ?? rootScope;
    let scope = parentScope;
    const attributes: Record<string, string> = {};
    for (const [name, value] of rawAttributes) {
      if (name === 'xmlns' || name.startsWith('xmlns:')) {
        if (scope === parentScope) scope = new Map(parentScope);
        scope.set(name === 'xmlns' ? '' : name.slice(6), value.length > 0 ? value : null);
      }
    }
    for (const [name, value] of rawAttributes) {
      if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
      resolve(name, scope, true, tagAt); // an unbound attribute prefix fails closed too
      attributes[name] = value;
    }
    const { ns, local } = resolve(qname, scope, false, tagAt);
    const element: XmlElement = { ns, name: local, attributes, children: [], text: '' };

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.element.children.push(element);
    } else {
      if (root !== null) throw new XmlParseError('more than one root element', tagAt);
      root = element;
    }
    if (!selfClosing) {
      if (stack.length >= MAX_DEPTH) throw new XmlParseError(`nesting deeper than ${MAX_DEPTH}`, tagAt);
      stack.push({ qname, element, scope });
    }
  }

  if (stack.length > 0) throw new XmlParseError(`unclosed element <${stack[stack.length - 1]!.qname}>`, pos);
  if (root === null) throw new XmlParseError('no root element', pos);
  return root;
}

// ---------------------------------------------------------------------------
// Navigation helpers — strict: a caller that needs exactly one child gets an error, never the first of many.
// ---------------------------------------------------------------------------

export function childrenOf(el: XmlElement, ns: string | null, name: string): XmlElement[] {
  return el.children.filter((c) => c.ns === ns && c.name === name);
}

/** The one child with this name, or null when there is none; more than one throws. */
export function optionalChild(el: XmlElement, ns: string | null, name: string, context: string): XmlElement | null {
  const found = childrenOf(el, ns, name);
  if (found.length > 1) throw new Error(`${context}: expected at most one <${name}> in <${el.name}>, found ${found.length}`);
  return found[0] ?? null;
}

/** The one child with this name; none or more than one throws. */
export function onlyChild(el: XmlElement, ns: string | null, name: string, context: string): XmlElement {
  const found = optionalChild(el, ns, name, context);
  if (found === null) throw new Error(`${context}: expected one <${name}> in <${el.name}>, found none`);
  return found;
}

/** A required, non-empty attribute. */
export function requiredAttribute(el: XmlElement, name: string, context: string): string {
  const value = el.attributes[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${context}: <${el.name}> has no '${name}' attribute`);
  }
  return value;
}
