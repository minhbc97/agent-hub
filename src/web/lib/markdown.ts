/**
 * The Markdown agents write in messages, parsed to plain data so it renders without any raw HTML.
 * shortcut: no reference links, setext headings, footnotes or HTML; take a library if agents start using those.
 */
export type Inline =
  | { type: 'text' | 'code'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'list'; start: number | null; items: Block[][] }
  | { type: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { type: 'rule' };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const RULE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^ {0,3}>\s?/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(?=\S)/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
/** Nesting past this is shown as text: nobody reads it, and it bounds the recursion on hostile input. */
const MAX_DEPTH = 6;
/** Bounds how far an unclosed marker looks for its end, so a long message cannot freeze the page. */
const INLINE =
  /(?<tick>`{1,3})(?<code>[^\n]{1,1000}?)(?<!`)\k<tick>(?!`)|\[(?<label>[^\]\n]{1,300})\]\((?<href>[^()\s]{1,1000}(?:\([^()\s]{0,200}\)[^()\s]{0,200})?)\)|(?<url>https?:\/\/[^\s<>`*|]{1,1000})|\*\*(?=\S)(?<strong>[^\n]{1,1000}?)(?<=\S)\*\*|~~(?=\S)(?<del>[^\n]{1,1000}?)(?<=\S)~~|(?<![\w*])\*(?=[^\s*])(?<em>[^*\n]{1,500}?)(?<=\S)\*(?![\w*])|(?<!\w)_(?=[^\s_])(?<em2>[^_\n]{1,500}?)(?<=\S)_(?!\w)/g;

export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.split(/\r?\n/), 0);
}

function parseBlocks(lines: string[], depth: number): Block[] {
  const blocks: Block[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at]!;
    if (!line.trim()) {
      at++;
      continue;
    }
    const fence = FENCE.exec(line)?.[1];
    if (fence) {
      const isEnd = (l: string) =>
        l.trim().startsWith(fence) && !l.trim().slice(fence.length).replaceAll(fence[0]!, '');
      const end = lines.findIndex((l, i) => i > at && isEnd(l));
      const close = end < 0 ? lines.length : end; // an unclosed fence runs to the end
      blocks.push({ type: 'code', text: lines.slice(at + 1, close).join('\n') });
      at = close + 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length, children: parseInline(heading[2]!) });
      at++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      at++;
      continue;
    }
    if (depth < MAX_DEPTH && QUOTE.test(line)) {
      const end = endOf(lines, at, (l) => QUOTE.test(l));
      const inner = lines.slice(at, end).map((l) => l.replace(QUOTE, ''));
      blocks.push({ type: 'quote', blocks: parseBlocks(inner, depth + 1) });
      at = end;
      continue;
    }
    if (isTableAt(lines, at)) {
      const end = endOf(lines, at + 2, (l) => l.includes('|') && !!l.trim());
      blocks.push({ type: 'table', head: cells(line), rows: lines.slice(at + 2, end).map(cells) });
      at = end;
      continue;
    }
    if (depth < MAX_DEPTH && ITEM.test(line)) {
      const list = parseList(lines, at, depth);
      blocks.push(list.block);
      at = list.end;
      continue;
    }
    const end = endOf(lines, at + 1, (l, i) => !!l.trim() && !startsBlock(lines, i, depth));
    // A chat message means its line breaks, so they are kept rather than joined.
    blocks.push({ type: 'paragraph', children: parseInline(lines.slice(at, end).join('\n').trim()) });
    at = end;
  }
  return blocks;
}

function startsBlock(lines: string[], at: number, depth: number): boolean {
  const line = lines[at]!;
  if (FENCE.test(line) || HEADING.test(line) || RULE.test(line) || isTableAt(lines, at)) return true;
  return depth < MAX_DEPTH && (QUOTE.test(line) || ITEM.test(line));
}

function endOf(lines: string[], from: number, belongs: (line: string, index: number) => boolean): number {
  let end = from;
  while (end < lines.length && belongs(lines[end]!, end)) end++;
  return end;
}

function parseList(lines: string[], from: number, depth: number): { block: Block; end: number } {
  const first = ITEM.exec(lines[from]!)!;
  const indent = first[1]!.length;
  const isOrdered = /\d/.test(first[2]!);
  const items: Block[][] = [];
  let at = from;
  while (at < lines.length) {
    const marker = ITEM.exec(lines[at]!);
    if (!marker || marker[1]!.length > indent + 1 || /\d/.test(marker[2]!) !== isOrdered) break;
    if (marker[1]!.length < indent) break;
    const width = marker[0].length;
    const body = [lines[at]!.slice(width)];
    at++;
    while (at < lines.length) {
      const line = lines[at]!;
      const isBlank = !line.trim();
      // A blank line stays in the item only when what follows is indented under it.
      const next = isBlank ? lines.slice(at + 1, at + 3).find((l) => l.trim()) : line;
      if (next === undefined || indentOf(next) <= indent) break;
      body.push(line.slice(Math.min(width, indentOf(line))));
      at++;
    }
    items.push(parseBlocks(body, depth + 1));
    // Blank lines between items do not end the list.
    const next = endOf(lines, at, (l) => !l.trim());
    if (next > at && next < lines.length && ITEM.test(lines[next]!) && indentOf(lines[next]!) >= indent) at = next;
  }
  return { block: { type: 'list', start: isOrdered ? parseInt(first[2]!, 10) : null, items }, end: at };
}

const indentOf = (line: string) => line.length - line.trimStart().length;

function isTableAt(lines: string[], at: number): boolean {
  const rule = lines[at + 1];
  return !!rule && lines[at]!.includes('|') && rule.includes('-') && rule.includes('|') && TABLE_RULE.test(rule);
}

function cells(line: string): Inline[][] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => parseInline(cell.trim().replaceAll('\\|', '|')));
}

export function parseInline(text: string, depth = 0): Inline[] {
  if (depth >= MAX_DEPTH) return [{ type: 'text', text }];
  const out: Inline[] = [];
  const nested = (inner: string) => parseInline(inner, depth + 1);
  let from = 0;
  for (const match of text.matchAll(INLINE)) {
    const { code, label, href, url, strong, del, em, em2 } = match.groups!;
    let node: Inline;
    let length = match[0].length;
    if (code !== undefined) node = { type: 'code', text: code };
    else if (label !== undefined) {
      // Only web links can be followed from the browser; a local path shows as its label.
      if (isWebLink(href!)) node = { type: 'link', href: href!, children: nested(label) };
      else node = { type: 'code', text: label };
    } else if (url !== undefined) {
      const link = url.replace(/[.,;:!?)\]}'"]+$/, '');
      length = link.length;
      node = { type: 'link', href: link, children: [{ type: 'text', text: link }] };
    } else if (strong !== undefined) node = { type: 'strong', children: nested(strong) };
    else if (del !== undefined) node = { type: 'del', children: nested(del) };
    else node = { type: 'em', children: nested((em ?? em2)!) };
    if (match.index > from) out.push({ type: 'text', text: text.slice(from, match.index) });
    out.push(node);
    from = match.index + length;
  }
  if (from < text.length) out.push({ type: 'text', text: text.slice(from) });
  return out;
}

const isWebLink = (href: string) => /^https?:\/\//i.test(href);
