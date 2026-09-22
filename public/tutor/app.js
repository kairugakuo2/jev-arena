import { createCodeEditor } from './editor.js';
import { TutorScheduler, smoothPosition } from './scheduler.js';

const $ = id => document.getElementById(id);
const sample = `Two Sum

Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.

You may assume that each input has exactly one solution, and you may not use the same element twice. You can return the answer in any order.

Example 1
Input: nums = [2,7,11,15], target = 9
Output: [0,1]

Example 2
Input: nums = [3,2,4], target = 6
Output: [1,2]

Example 3
Input: nums = [3,3], target = 6
Output: [0,1]

Constraints
2 <= nums.length <= 10000
-10^9 <= nums[i] <= 10^9
-10^9 <= target <= 10^9
Exactly one valid answer exists.

Follow-up: Can you come up with an algorithm that is less than O(n^2) time complexity?`;

let problem = null, language = 'python', target = null, displayed = 50, frame = 0, lastFrame = null;
let preparing = false, preparingId = null, pollTimer = null, composing = false;
let baselineCode = '', latestResult = null;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const measurements = [];

async function api(path, body, timeout = 4000) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type':'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
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
  const seconds = lastFrame === null ? 0 : Math.min((now-lastFrame)/1000, .05);
  lastFrame = now;
  displayed = reduced.matches ? target : smoothPosition(displayed,target,seconds);
  if (Math.abs(target-displayed) < .05) displayed = target;
  paint();
  if (displayed !== target) frame = requestAnimationFrame(animate);
  else lastFrame = null;
}
function moveMeter() {
  if (!frame && !document.hidden) frame = requestAnimationFrame(animate);
}
function clearMeter() {
  cancelAnimationFrame(frame); frame = 0; lastFrame = null;
  target = null; displayed = 50; latestResult = null;
  $('heat-meter').classList.add('unmeasured');
  $('direction').textContent = 'Waiting for your first edits';
  $('measured').textContent = 'No reading yet';
  $('meter').removeAttribute('aria-valuenow');
  paint();
}

const statusLabels = { inactive:'Prepare a problem to begin', ready:'Ready for your edits', updating:'Updating', analyzing:'Reading your edits', watching:'Following your code', delayed:'Reading delayed', unavailable:'Reading unavailable' };
const scheduler = new TutorScheduler({
  request: body => api('/api/tutor/evaluate', body),
  onStatus: info => {
    $('live-label').textContent = statusLabels[info.state];
    $('live-state').dataset.state = info.state;
    $('feedback-error').textContent = info.state === 'unavailable' ? info.message || 'Retrying shortly.' : '';
    $('revision-info').textContent = `Current ${info.revision ?? 0} · evaluated ${info.evaluatedRevision ?? 0}`;
  },
  onReading: result => {
    target = result.probabilities.hotter * 100;
    latestResult = result;
    $('heat-meter').classList.remove('unmeasured');
    $('direction').textContent = target > 60 ? 'Getting hotter' : target < 40 ? 'Getting colder' : 'Neutral or uncertain';
    $('meter').setAttribute('aria-valuenow',String(Math.round(target)));
    $('meter').setAttribute('aria-valuetext',`${Math.round(target)} percent hotter probability for recent edits`);
    $('announcement').textContent = `${$('direction').textContent}. ${Math.round(target)} percent hotter probability.`;
    $('measured').textContent = `Updated ${new Date().toLocaleTimeString([], { hour:'2-digit',minute:'2-digit',second:'2-digit' })}`;
    $('result-json').textContent = JSON.stringify(result,null,2);
    moveMeter();
  },
  onMetrics: metric => {
    measurements.push(metric); if (measurements.length > 30) measurements.shift();
    const sorted = measurements.map(m=>m.latencyMs).sort((a,b)=>a-b);
    $('latency-info').textContent = `${Math.round(metric.latencyMs)} ms last · ${Math.round(sorted[Math.floor(sorted.length/2)])} ms median (${sorted.length} samples)`;
  },
});

const editor = createCodeEditor({ parent:$('editor'), nonce:document.querySelector('meta[name="style-nonce"]').content,
  doc:'# Write your solution here.\n',
  onChange: (code,changes) => {
    $('save-state').textContent = 'Draft saved locally';
    if (code.length > 65536) {
      scheduler.setPaused(true); $('feedback-error').textContent = 'Code exceeds the 64 KB evaluation limit. Shorten it to resume.';
    } else {
      scheduler.setPaused(document.hidden || composing);
      scheduler.edit(code,changes);
    }
    saveDraft();
  },
  onSelection: ({line,column}) => { $('cursor-position').textContent = `Ln ${line}, Col ${column}`; },
});
baselineCode = editor.code();

function saveDraft() {
  try { localStorage.setItem('jev-tutor-draft',JSON.stringify({ code:editor.code(), language, statement:$('problem-input').value, problemId:problem?.problemId ?? preparingId })); }
  catch { $('save-state').textContent = 'Draft in this tab only'; }
}
function newSession() {
  clearMeter();
  baselineCode = editor.code();
  scheduler.reset(problem ? { problemId:problem.problemId, graphVersion:problem.graphVersion, language, sessionId:crypto.randomUUID() } : null,baselineCode);
  $('graph-info').textContent = problem ? `${problem.model} · ${problem.graphVersion}` : 'No graph active';
}

function setProblemStatus(message) { $('problem-status').textContent = message; }
function activate(metadata) {
  problem = metadata; preparing = false; preparingId = null;
  $('prepare').disabled = false; $('prepare').textContent = 'Prepare problem';
  $('problem-title').textContent = metadata.statement.split('\n').find(line => line.trim())?.trim().slice(0, 120) || 'Problem';
  $('problem-text').textContent = metadata.statement;
  $('problem-form').hidden = true; $('problem-ready').hidden = false;
  setProblemStatus('Reference ready');
  newSession(); saveDraft();
}
function preparationFailed(error) {
  preparing = false; preparingId = null;
  $('prepare').disabled = false; $('prepare').textContent = 'Try preparing again';
  setProblemStatus(error.message || 'Preparation failed.');
  $('problem-status').setAttribute('role','alert');
}
async function pollProblem() {
  if (!preparingId) return;
  try {
    const result = await api(`/api/tutor/problems/${preparingId}`);
    if (result.status === 'ready') { activate(result); return; }
    if (result.status === 'failed') throw Error(result.error);
    const labels = { generating:'Mapping solution approaches…', reviewing:'Checking correctness and alternative paths…', repairing:'Refining the reference graph…' };
    setProblemStatus(labels[result.status] || 'Preparing…');
    pollTimer = setTimeout(pollProblem,1500);
  } catch (error) { preparationFailed(error); }
}

$('problem-input').value = sample;
$('problem-form').addEventListener('submit',async event => {
  event.preventDefault();
  if (preparing) return;
  preparing = true; problem = null; newSession();
  $('prepare').disabled = true; $('prepare').textContent = 'Preparing…';
  $('problem-status').setAttribute('role','status');
  setProblemStatus('Preparing a reusable solution reference…');
  try {
    const result = await api('/api/tutor/problems',{ statement:$('problem-input').value });
    if (result.status === 'ready') activate(result);
    else { preparingId = result.problemId; saveDraft(); pollProblem(); }
  } catch (error) { preparationFailed(error); }
});
$('change-problem').addEventListener('click',() => {
  problem = null; newSession();
  $('problem-form').hidden = false; $('problem-ready').hidden = true;
  $('problem-title').textContent = 'Paste a problem';
  setProblemStatus('Paste the full statement and constraints.');
  $('problem-input').focus(); saveDraft();
});
$('language').addEventListener('change',() => {
  language = $('language').value;
  editor.setLanguage(language);
  $('filename').textContent = language === 'python' ? 'solution.py' : 'solution.js';
  newSession(); saveDraft();
});
$('reset-signal').addEventListener('click',newSession);
editor.view.contentDOM.addEventListener('compositionstart',() => { composing = true; scheduler.setPaused(true); });
editor.view.contentDOM.addEventListener('compositionend',() => { composing = false; scheduler.setPaused(document.hidden || editor.code().length > 65536); });
document.addEventListener('visibilitychange',() => {
  scheduler.setPaused(document.hidden || composing || editor.code().length > 65536);
  if (document.hidden) { cancelAnimationFrame(frame); frame = 0; lastFrame = null; }
  else moveMeter();
});
reduced.addEventListener('change',moveMeter);
window.addEventListener('pagehide',() => { scheduler.dispose(); clearTimeout(pollTimer); cancelAnimationFrame(frame); });

newSession();
try {
  const draft = JSON.parse(localStorage.getItem('jev-tutor-draft'));
  if (draft && typeof draft.code === 'string' && draft.code.length <= 65536 && ['python','javascript'].includes(draft.language)) {
    language = draft.language; $('language').value = language; editor.setLanguage(language);
    $('filename').textContent = language === 'python' ? 'solution.py' : 'solution.js';
    if (typeof draft.statement === 'string') $('problem-input').value = draft.statement;
    editor.view.dispatch({ changes:{ from:0,to:editor.view.state.doc.length,insert:draft.code } });
    newSession();
    if (/^[a-f0-9]{64}$/.test(draft.problemId)) { preparingId = draft.problemId; preparing = true; $('prepare').disabled = true; pollProblem(); }
  }
} catch { /* Unavailable storage should not stop coding. */ }
fetch('/api/status').then(r=>r.json()).then(status => {
  $('connection').textContent = status.configured ? 'Gateway connected' : 'Gateway key missing';
}).catch(() => { $('connection').textContent = 'Server unavailable'; });
