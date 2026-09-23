// Renders a problem statement as structured blocks. Everything goes through
// textContent: statements come from third parties and are never parsed as HTML.

const RUN_TAGS = [['code', 'code'], ['sup', 'sup'], ['b', 'strong'], ['i', 'em']];

function renderRuns(parent, runs) {
  for (const run of Array.isArray(runs) ? runs : []) {
    if (typeof run?.text !== 'string') continue;
    let node = document.createTextNode(run.text), outer = node;
    for (const [flag, tag] of RUN_TAGS) {
      if (!run[flag]) continue;
      const wrapper = document.createElement(tag);
      wrapper.append(outer); outer = wrapper;
    }
    parent.append(outer);
  }
}

// Highlight the "Input:" / "Output:" / "Explanation:" labels inside example blocks.
function renderCode(text) {
  const pre = document.createElement('pre'), code = document.createElement('code');
  for (const [index, line] of text.split('\n').entries()) {
    if (index) code.append('\n');
    const label = line.match(/^(\s*)(Input|Output|Explanation):/);
    if (label) {
      code.append(label[1]);
      const span = document.createElement('span'); span.className = 'io-label'; span.textContent = `${label[2]}:`;
      code.append(span, line.slice(label[0].length));
    } else code.append(line);
  }
  pre.append(code);
  return pre;
}

export function renderBlocks(container, blocks) {
  container.replaceChildren();
  for (const block of blocks) {
    let element;
    if (block?.type === 'p') { element = document.createElement('p'); renderRuns(element, block.runs); }
    else if (block?.type === 'h' && typeof block.text === 'string') { element = document.createElement('h3'); element.textContent = block.text; }
    else if (block?.type === 'code' && typeof block.text === 'string') element = renderCode(block.text);
    else if ((block?.type === 'ul' || block?.type === 'ol') && Array.isArray(block.items)) {
      element = document.createElement(block.type);
      for (const item of block.items) { const li = document.createElement('li'); renderRuns(li, item); element.append(li); }
    }
    if (element) container.append(element);
  }
}

// Best-effort structure for plain text (custom problems, older caches).
export function blocksFromPlainText(statement) {
  const blocks = [];
  let paragraph = [], example = null, sawOutput = false, list = null, inConstraints = false;
  const flushParagraph = () => { if (paragraph.length) blocks.push({ type: 'p', runs: [{ text: paragraph.join(' ') }] }); paragraph = []; };
  const flushExample = () => { if (example?.length) blocks.push({ type: 'code', text: example.join('\n') }); example = null; sawOutput = false; };
  const flushList = () => { if (list?.length) blocks.push({ type: 'ul', items: list.map(text => [{ text, code: /[<>=≤≥]/.test(text) }]) }); list = null; };
  const flushAll = () => { flushParagraph(); flushExample(); flushList(); };

  for (const raw of String(statement).split('\n')) {
    const line = raw.trim();
    if (!line) {
      if (example && !sawOutput) continue; // Input and Output are often separated by a blank line.
      flushAll(); continue;
    }
    const heading = line.match(/^(Example\s*\d*|Constraints|Follow[- ]?up|Notes?)\s*:\s*(.*)$/i) || line.match(/^(Example\s*\d+|Constraints)$/i);
    if (heading) {
      flushAll();
      inConstraints = /^constraints/i.test(heading[1]);
      blocks.push({ type: 'h', text: heading[1].replace(/\s+/g, ' ') });
      if (heading[2]) paragraph.push(heading[2]);
      continue;
    }
    if (/^(Input|Output)\s*:/i.test(line)) {
      flushParagraph(); flushList();
      (example ??= []).push(line);
      if (/^Output/i.test(line)) sawOutput = true;
      continue;
    }
    if (example && !sawOutput) { example.push(line); continue; } // Input continued on the next line.
    if (example) flushExample();
    if (inConstraints) { flushParagraph(); (list ??= []).push(line.replace(/^[*•-]\s*/, '')); continue; }
    paragraph.push(line);
  }
  flushAll();
  return blocks;
}
