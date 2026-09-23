// Turns NeetCode's Markdown-with-some-HTML description into a small, safe block
// list the browser renders with textContent only. Never returns markup.
//
// Block: { type: 'p' | 'h' | 'code' | 'ul' | 'ol', runs?, text?, items? }
// Run:   { text, code?, b?, i?, sup? }

const MAX_BLOCKS = 120;
const MAX_TEXT = 24 * 1024;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', le: '≤', ge: '≥', ne: '≠', times: '×' };

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

// Inline HTML NeetCode sometimes uses, mapped to Markdown-like marks first.
function normalizeInlineHtml(text) {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<img\b[^>]*>/gi, ' (see the diagram on NeetCode) ')
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<code>([\s\S]*?)<\/code>/gi, (_, inner) => '`' + inner.replace(/`/g, "'") + '`')
    .replace(/<sup>([\s\S]*?)<\/sup>/gi, '^{$1}')
    .replace(/<\/?[a-z][^>]*>/gi, ' ');
}

function mergeRuns(runs) {
  const out = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out.at(-1);
    if (last && !!last.code === !!run.code && !!last.b === !!run.b && !!last.i === !!run.i && !!last.sup === !!run.sup) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}

function parseInline(text, marks = {}) {
  const runs = [];
  const pattern = /`([^`]+)`|\*\*([^*]+(?:\*(?!\*)[^*]*)*)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|\^\{([^}]*)\}|\[([^\]]+)\]\([^)]*\)/g;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > index) runs.push({ text: decode(text.slice(index, match.index)), ...marks });
    const [, code, bold, boldAlt, italic, sup, link] = match;
    if (code !== undefined) runs.push({ text: decode(code), ...marks, code: true });
    else if (bold !== undefined || boldAlt !== undefined) runs.push(...parseInline(bold ?? boldAlt, { ...marks, b: true }));
    else if (italic !== undefined) runs.push(...parseInline(italic, { ...marks, i: true }));
    else if (sup !== undefined) runs.push({ text: decode(sup), ...marks, sup: true });
    else runs.push(...parseInline(link, marks));
    index = match.index + match[0].length;
  }
  if (index < text.length) runs.push({ text: decode(text.slice(index)), ...marks });
  return mergeRuns(runs.map(run => ({ ...run, text: run.code ? run.text : run.text.replace(/\s+/g, ' ') })));
}

function inline(text) {
  const runs = parseInline(normalizeInlineHtml(text).trim());
  if (runs.length) { runs[0].text = runs[0].text.trimStart(); runs.at(-1).text = runs.at(-1).text.trimEnd(); }
  return runs.filter(run => run.text);
}

export function formatStatement(description) {
  const visible = String(description).split(/<details\b/i, 1)[0].replace(/\r\n?/g, '\n');
  const lines = visible.split('\n');
  const blocks = [];
  let paragraph = [], list = null;
  const flushParagraph = () => {
    const runs = inline(paragraph.join(' '));
    if (runs.length) blocks.push({ type: 'p', runs });
    paragraph = [];
  };
  const flushList = () => { if (list?.items.length) blocks.push(list); list = null; };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      flushParagraph(); flushList();
      const body = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      const text = decode(body.join('\n')).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '');
      if (text) blocks.push({ type: 'code', text });
      continue;
    }
    if (!trimmed || /^(<br\s*\/?>\s*)+$/i.test(trimmed)) { flushParagraph(); flushList(); continue; }
    const bullet = trimmed.match(/^[*-]\s+(.*)$/), numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const type = bullet ? 'ul' : 'ol';
      if (list?.type !== type) { flushList(); list = { type, items: [] }; }
      const runs = inline((bullet || numbered)[1]);
      if (runs.length) list.items.push(runs);
      continue;
    }
    flushList();
    const heading = trimmed.match(/^#{1,6}\s+(.*)$/) || trimmed.match(/^\*\*([^*]+)\*\*:?$/) || trimmed.match(/^<(?:strong|b)>(.*?)<\/(?:strong|b)>:?$/i);
    if (heading) {
      flushParagraph();
      const text = inline(heading[1]).map(run => run.text).join('').replace(/:$/, '');
      if (text) blocks.push({ type: 'h', text });
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph(); flushList();
  return clamp(blocks);
}

// Bound what we hand the browser, whatever the upstream sends.
function clamp(blocks) {
  let budget = MAX_TEXT;
  const take = text => { const piece = text.slice(0, Math.max(0, budget)); budget -= piece.length; return piece; };
  const takeRuns = runs => runs.map(run => ({ ...run, text: take(run.text) })).filter(run => run.text);
  const out = [];
  for (const block of blocks.slice(0, MAX_BLOCKS)) {
    if (budget <= 0) break;
    if (block.type === 'p') out.push({ type: 'p', runs: takeRuns(block.runs) });
    else if (block.type === 'h' || block.type === 'code') out.push({ type: block.type, text: take(block.text) });
    else out.push({ type: block.type, items: block.items.slice(0, 40).map(takeRuns).filter(items => items.length) });
  }
  return out;
}
