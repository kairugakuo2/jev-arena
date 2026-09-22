import { createCodeEditor } from './editor.js';
import { TutorScheduler, smoothPosition, MAX_CODE_BYTES, utf8Bytes } from './scheduler.js';
import { TutorLocalStore, filterCatalog, groupCatalog, surpriseProblem } from './library.js';
import { starterFor, readingLevel, isUntouchedLegacyDraft } from './reading.js';

const $ = id => document.getElementById(id);
const starter = { python:'# Write your solution here.\n', javascript:'// Write your solution here.\n' };
const customSample = `Two Sum

Given an array of integers nums and an integer target, return indices of two distinct numbers that add up to target.

Example
Input: nums = [2,7,11,15], target = 9
Output: [0,1]

Constraints
2 <= nums.length <= 10000
Exactly one valid answer exists.`;

let problem = null, loadedProblem = null, activeCatalogProblem = null, catalog = [], language = 'python';
let target = null, displayed = 50, frame = 0, lastFrame = null;
let preparing = false, preparingId = null, pollTimer = null, composing = false, restoring = false;
let loadGeneration = 0, preparationBody = null, pollFailures = 0;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const measurements = [];
const localState = new TutorLocalStore();
const safeGet = key => { try { return localStorage.getItem(key); } catch { return null; } };
const safeSet = (key,value) => { try { localStorage.setItem(key,value); } catch { /* Keep the current tab usable. */ } };
try {
  const legacy = JSON.parse(safeGet('jev-tutor-draft'));
  if (legacy && typeof legacy.code === 'string' && utf8Bytes(legacy.code) <= MAX_CODE_BYTES && ['python','javascript'].includes(legacy.language)
    && localState.draft('custom',legacy.language) === null) localState.saveDraft('custom',legacy.language,legacy.code);
  if (typeof legacy?.statement === 'string' && !safeGet('jev-tutor-custom-statement')) safeSet('jev-tutor-custom-statement',legacy.statement);
} catch { /* Ignore malformed legacy state. */ }

async function api(path, body, timeout = 4000) {
  const response = await fetch(path, { method:body === undefined ? 'GET' : 'POST',
    headers:body === undefined ? {} : { 'Content-Type':'application/json' },
    body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(timeout) });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed.');
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  return data;
}

function paint() {
  $('meter-marker').style.left = `${displayed}%`;
  $('meter-fill').style.transform = `scaleX(${displayed / 100})`;
  $('reading').textContent = target === null ? '—' : `${Math.round(displayed)}`;
}
function animate(now) {
  frame = 0;
  if (target === null || document.hidden) { lastFrame = null; return; }
  const seconds = lastFrame === null ? 0 : Math.min((now-lastFrame)/1000,.05);
  lastFrame = now;
  displayed = reduced.matches ? target : smoothPosition(displayed,target,seconds);
  if (Math.abs(target-displayed) < .05) displayed = target;
  paint();
  if (displayed !== target) frame = requestAnimationFrame(animate);
  else lastFrame = null;
}
function moveMeter() { if (!frame && !document.hidden) frame = requestAnimationFrame(animate); }
function clearMeter() {
  cancelAnimationFrame(frame); frame = 0; lastFrame = null; target = null; displayed = 50;
  $('heat-meter').classList.add('unmeasured'); $('direction').textContent = problem ? 'Waiting for your first edits' : loadedProblem ? 'Jev is preparing feedback' : 'Choose a problem to begin';
  $('measured').textContent = 'No reading yet'; $('meter').removeAttribute('aria-valuenow'); paint();
}

const statusLabels = { inactive:'Choose a problem to begin', ready:'Ready for your edits', updating:'Updating', analyzing:'Reading your edits', watching:'Following your code', delayed:'Reading delayed', unavailable:'Reading unavailable', too_large:'Code exceeds 64 KiB' };
const scheduler = new TutorScheduler({
  request: body => api('/api/tutor/evaluate',body),
  onStatus: info => {
    $('live-label').textContent = info.state === 'inactive' && loadedProblem ? 'You can code while feedback gets ready' : statusLabels[info.state]; $('live-state').dataset.state = info.state;
    $('feedback-error').textContent = info.state === 'unavailable' ? info.message || 'Reading unavailable.' : info.state === 'too_large' ? 'Shorten the file below 64 KiB to resume evaluation.' : '';
    $('revision-info').textContent = `Current ${info.revision ?? 0} · evaluated ${info.evaluatedRevision ?? 0}`;
  },
  onReading: result => {
    target = result.probabilities.hotter * 100; $('heat-meter').classList.remove('unmeasured');
    $('direction').textContent = readingLevel(target);
    $('meter').setAttribute('aria-valuenow',String(Math.round(target))); $('meter').setAttribute('aria-valuetext',`${Math.round(target)} percent hotter probability for recent edits`);
    $('announcement').textContent = `${$('direction').textContent}. ${Math.round(target)} percent hotter probability.`;
    $('measured').textContent = `Updated ${new Date().toLocaleTimeString([], { hour:'2-digit',minute:'2-digit',second:'2-digit' })}`;
    $('result-json').textContent = JSON.stringify(result,null,2); moveMeter();
  },
  onMetrics: metric => {
    measurements.push(metric); if (measurements.length > 30) measurements.shift();
    const sorted = measurements.map(value => value.latencyMs).sort((a,b) => a-b);
    $('latency-info').textContent = `${Math.round(metric.latencyMs)} ms last · ${Math.round(sorted[Math.floor(sorted.length/2)])} ms median (${sorted.length} samples)`;
  },
});

function draftScope() { return activeCatalogProblem ? `neetcode:${activeCatalogProblem.slug}` : 'custom'; }
function saveDraft() { if (!loadedProblem) return; localState.saveDraft(draftScope(),language,editor.code()); $('save-state').textContent = 'Draft saved locally'; }
function setEditorCode(code) {
  restoring = true; editor.view.dispatch({ changes:{ from:0,to:editor.view.state.doc.length,insert:code }, selection:{ anchor:code.length } }); restoring = false;
}
function setEditorReady(ready, message = 'Choose a problem to load its starter code.') {
  editor.setEditable(ready);
  $('editor').setAttribute('aria-busy',String(!ready));
  $('editor-gate').hidden = ready;
  $('editor-gate').textContent = message;
  $('language').disabled = !ready;
}
function restoreDraft() {
  const code = localState.draft(draftScope(),language);
  const initial = initialCode();
  const usableDraft = typeof code === 'string' && utf8Bytes(code) <= MAX_CODE_BYTES && !(activeCatalogProblem && isUntouchedLegacyDraft(code,language));
  setEditorCode(usableDraft ? code : initial || starter[language]);
}
function initialCode() { return starterFor(loadedProblem?.source?.starterCode,language) || starter[language]; }

const editor = createCodeEditor({ parent:$('editor'), nonce:document.querySelector('meta[name="style-nonce"]').content, doc:starter.python,
  onChange:(code,changes) => {
    if (restoring) return;
    scheduler.setPaused(document.hidden || composing); scheduler.edit(code,changes); saveDraft();
  },
  onSelection:({line,column}) => { $('cursor-position').textContent = `Ln ${line}, Col ${column}`; },
});

function newSession(baseline = editor.code()) {
  clearMeter();
  scheduler.reset(problem ? { problemId:problem.problemId, graphVersion:problem.graphVersion, language, sessionId:crypto.randomUUID() } : null,baseline);
  if (problem && editor.code() !== baseline) scheduler.edit(editor.code(),[{ from:0,to:baseline.length,insert:editor.code() }]);
  $('graph-info').textContent = problem ? `${problem.model || 'Jev map'} · ${problem.graphVersion}` : 'No graph active';
}
function setProblemStatus(message, role = 'status') { $('problem-status').textContent = message; $('problem-status').setAttribute('role',role); }
function showEntry(mode) {
  const library = mode === 'library';
  $('library-tab').classList.toggle('active',library); $('library-tab').setAttribute('aria-selected',String(library));
  $('custom-tab').classList.toggle('active',!library); $('custom-tab').setAttribute('aria-selected',String(!library));
  $('library-pane').hidden = !library; $('custom-pane').hidden = library;
  $('problem-title').textContent = library ? 'NeetCode 150 library' : 'Custom problem';
}
function filters() { return { query:$('catalog-search').value, pattern:$('pattern-filter').value, difficulty:$('difficulty-filter').value }; }

function renderCatalog() {
  if (!catalog.length) return;
  const filtered = filterCatalog(catalog,filters());
  $('catalog-count').textContent = `${filtered.length} of ${catalog.length} problems`; $('catalog-results').replaceChildren();
  for (const group of groupCatalog(filtered)) {
    const section = document.createElement('section'); section.className = 'catalog-group';
    const heading = document.createElement('h3'); heading.textContent = group.pattern; section.append(heading);
    for (const entry of group.problems) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'problem-choice';
      const title = document.createElement('span'); title.className = 'problem-choice-title'; title.textContent = `${entry.order}. ${entry.title}`;
      const meta = document.createElement('span'); meta.className = 'problem-meta';
      const difficulty = document.createElement('span'); difficulty.className = `difficulty difficulty-${entry.difficulty.toLowerCase()}`; difficulty.textContent = entry.difficulty;
      meta.append(difficulty); button.append(title,meta); button.setAttribute('aria-label',`${entry.title}, ${entry.difficulty}`);
      button.addEventListener('click',() => selectCatalogProblem(entry)); section.append(button);
    }
    $('catalog-results').append(section);
  }
  if (!filtered.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'No problems match these filters.'; $('catalog-results').append(empty); }
  $('surprise-problem').disabled = !filtered.length;
}

function showPreview(metadata) {
  if (loadedProblem) return;
  loadedProblem = metadata;
  $('problem-title').textContent = metadata.title || activeCatalogProblem?.title || metadata.statement.split('\n')[0]; $('problem-text').textContent = metadata.statement;
  document.querySelector('.entry-tabs').hidden = true; $('library-pane').hidden = true; $('custom-pane').hidden = true; $('problem-ready').hidden = false;
  const imported = metadata.source?.kind === 'neetcode';
  $('problem-source').textContent = imported ? `NeetCode · ${activeCatalogProblem?.pattern || '150'}` : 'Custom';
  $('source-link').hidden = !imported; if (imported) $('source-link').href = metadata.source.url;
  for (const option of $('language').options) option.disabled = imported && !metadata.source.starterCode?.[option.value];
  if (imported && !metadata.source.starterCode?.[language]) {
    language = metadata.source.starterCode?.python ? 'python' : 'javascript';
    $('language').value = language; editor.setLanguage(language); $('filename').textContent = language === 'python' ? 'solution.py' : 'solution.js';
  }
  restoreDraft();
  setEditorReady(true);
  $('cancel-preparation').hidden = true;
  newSession();
}
function activate(metadata) {
  showPreview(metadata);
  problem = metadata; preparing = false; preparingId = null;
  $('prepare').disabled = false; $('prepare').textContent = 'Prepare custom problem'; $('retry-feedback').hidden = true;
  setProblemStatus(metadata.source?.stale ? 'Ready from saved source; a refresh was unavailable.' : 'Jev is ready. Your edits now receive live feedback.');
  // Include code written during preparation instead of resetting it away.
  newSession(initialCode());
}
function preparationFailed(error, source) {
  preparing = false; preparingId = null; $('prepare').disabled = false; $('prepare').textContent = 'Try preparing again'; setProblemStatus(error.message || 'Preparation failed.','alert');
  $('retry-feedback').hidden = false; $('retry-feedback').textContent = loadedProblem ? 'Retry Jev feedback' : 'Retry loading problem';
  if (!loadedProblem) setEditorReady(false,'The problem could not load. Retry or choose another question.');
  $('direction').textContent = loadedProblem ? 'Feedback unavailable' : 'Problem unavailable';
  $('live-label').textContent = loadedProblem ? 'Your code is saved. Retry when ready.' : 'Retry loading the problem';
  if (source?.url) {
    const link = document.createElement('a'); link.href = source.url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = 'Open the attributed problem on NeetCode';
    $('problem-status').append(document.createElement('br'),link);
  }
}
function cancelPreparation() {
  clearTimeout(pollTimer); loadGeneration++; preparing = false; preparingId = null; pollFailures = 0;
}
function preparationStatus(result) {
  if (result.preview) showPreview(result.preview);
  if (result.status === 'ready') { activate(result); return true; }
  if (result.status === 'failed') { preparationFailed(Error(result.error),result.source); return true; }
  const labels = { importing:loadedProblem ? 'Problem loaded. Preparing Jev feedback…' : 'Loading question and starter code…', queued:'You can start coding. Jev feedback is queued…', mapping_approaches:'You can start coding. Preparing Jev feedback…', reviewing_reference:'You can start coding. Checking Jev feedback…', repairing:'You can start coding. Refining Jev feedback…' };
  setProblemStatus(labels[result.status] || 'Preparing Jev feedback…');
  return false;
}
async function pollProblem(generation = loadGeneration) {
  if (!preparingId || generation !== loadGeneration) return;
  try {
    const result = await api(`/api/tutor/problems/${preparingId}`);
    if (generation !== loadGeneration) return;
    pollFailures = 0;
    if (preparationStatus(result)) return;
    pollTimer = setTimeout(() => pollProblem(generation),1000);
  } catch (error) {
    if (generation !== loadGeneration) return;
    if (error.retryable !== false && ++pollFailures <= 3) {
      setProblemStatus('Connection interrupted. Reconnecting to Jev…');
      pollTimer = setTimeout(() => pollProblem(generation),1000 * pollFailures);
    } else preparationFailed(error);
  }
}
async function beginPreparation(body) {
  cancelPreparation(); const generation = loadGeneration; preparationBody = body;
  preparing = true; problem = null; newSession(); $('prepare').disabled = true; $('retry-feedback').hidden = true;
  $('cancel-preparation').hidden = Boolean(loadedProblem);
  setProblemStatus(body.source === 'neetcode' ? 'Loading question and starter code…' : 'Preparing Jev feedback…');
  try {
    const result = await api('/api/tutor/problems',body);
    if (generation !== loadGeneration) return;
    if (!preparationStatus(result)) { preparingId = result.problemId; pollProblem(generation); }
  } catch (error) { if (generation === loadGeneration) preparationFailed(error); }
}
function selectCatalogProblem(entry) {
  saveDraft(); cancelPreparation(); activeCatalogProblem = entry; problem = null; loadedProblem = null;
  setEditorCode(starter[language]); setEditorReady(false,'Loading this problem and its starter code…'); newSession(); renderCatalog(); $('problem-title').textContent = entry.title;
  beginPreparation({ source:'neetcode', slug:entry.slug });
}

$('problem-input').value = safeGet('jev-tutor-custom-statement') || customSample;
$('problem-form').addEventListener('submit',event => {
  event.preventDefault(); saveDraft(); cancelPreparation(); activeCatalogProblem = null; loadedProblem = null; problem = null; setEditorReady(false,'Preparing your custom problem…');
  safeSet('jev-tutor-custom-statement',$('problem-input').value); beginPreparation({ statement:$('problem-input').value });
});
$('library-tab').addEventListener('click',() => showEntry('library')); $('custom-tab').addEventListener('click',() => showEntry('custom'));
function chooseAnotherProblem() {
  saveDraft(); cancelPreparation(); problem = null; loadedProblem = null; preparationBody = null;
  $('retry-feedback').hidden = true; $('cancel-preparation').hidden = true; $('prepare').disabled = false;
  setEditorReady(false); newSession(); document.querySelector('.entry-tabs').hidden = false; $('problem-ready').hidden = true;
  showEntry(activeCatalogProblem ? 'library' : 'custom'); setProblemStatus(activeCatalogProblem ? 'Choose a NeetCode 150 problem.' : 'Paste the full statement and constraints.');
}
$('change-problem').addEventListener('click',chooseAnotherProblem);
$('cancel-preparation').addEventListener('click',chooseAnotherProblem);
$('retry-feedback').addEventListener('click',() => { if (preparationBody) beginPreparation(preparationBody); });
$('language').addEventListener('change',() => {
  saveDraft(); language = $('language').value; editor.setLanguage(language); $('filename').textContent = language === 'python' ? 'solution.py' : 'solution.js'; restoreDraft(); newSession(initialCode());
});
for (const id of ['catalog-search','pattern-filter','difficulty-filter']) $(id).addEventListener(id === 'catalog-search' ? 'input' : 'change',renderCatalog);
$('surprise-problem').addEventListener('click',() => { const choice = surpriseProblem(catalog,filters()); if (choice) selectCatalogProblem(choice); else $('surprise-empty').hidden = false; });
$('reset-signal').addEventListener('click',() => newSession());
editor.view.contentDOM.addEventListener('compositionstart',() => { composing = true; scheduler.setPaused(true); });
editor.view.contentDOM.addEventListener('compositionend',() => { composing = false; scheduler.setPaused(document.hidden); });
document.addEventListener('visibilitychange',() => { scheduler.setPaused(document.hidden || composing); if (document.hidden) { cancelAnimationFrame(frame); frame = 0; lastFrame = null; } else moveMeter(); });
reduced.addEventListener('change',moveMeter);
window.addEventListener('pagehide',() => { scheduler.setPaused(true); clearTimeout(pollTimer); pollTimer = null; cancelAnimationFrame(frame); frame = 0; lastFrame = null; });
window.addEventListener('pageshow',event => {
  if (!event.persisted) return;
  scheduler.setPaused(document.hidden || composing);
  if (preparingId) pollProblem();
  else if (problem) moveMeter();
});

setEditorReady(false); newSession();
api('/api/tutor/catalog').then(result => {
  catalog = result.problems;
  for (const pattern of [...new Set(catalog.map(entry => entry.pattern))]) { const option = document.createElement('option'); option.value = option.textContent = pattern; $('pattern-filter').append(option); }
  renderCatalog(); if (!preparing && !loadedProblem) setProblemStatus('Choose a problem. Source content is imported only after selection.');
}).catch(() => { setProblemStatus('The NeetCode catalog is unavailable. Use the Custom tab.','alert'); });
fetch('/api/status').then(response => response.json()).then(status => { $('connection').textContent = status.configured ? 'Gateway connected' : 'Gateway key missing'; }).catch(() => { $('connection').textContent = 'Server unavailable'; });
