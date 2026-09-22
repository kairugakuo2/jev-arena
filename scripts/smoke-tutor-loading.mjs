// Run against a local server. All AI/source responses are fixtures: no paid calls.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}) });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  const catalog = ['Easy','Medium','Hard'].map((difficulty,index)=>({slug:`problem-${index}`,title:`Problem ${index}`,
    pattern:'Arrays & Hashing',difficulty,order:index+1,questionUrl:`https://neetcode.io/problems/problem-${index}`}));
  const starterCode = {python:'class Solution:\n    def solve(self, nums: list[int]) -> int:\n        ',javascript:'class Solution {\n    solve(nums) {\n    }\n}'};
  const id = index=>String(index+1).repeat(64);
  const metadata = index=>({problemId:id(index),graphVersion:'v4',model:'fixture',title:`Problem ${index}`,
    statement:`Problem ${index}: find the answer for the given numbers.`,source:{kind:'neetcode',slug:`problem-${index}`,
      url:catalog[index].questionUrl,starterCode}});
  let stage = 'mapping_approaches';
  const evaluations = [];
  let heldPoll, releasePoll;
  await page.route('**/api/status',route=>route.fulfill({json:{configured:true}}));
  await page.route('**/api/tutor/**',async route=>{
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/catalog')) return route.fulfill({json:{problems:catalog}});
    if (path.endsWith('/evaluate')) {
      const input = request.postDataJSON(); evaluations.push(input);
      const {sessionId,problemId,graphVersion,language,baselineRevision,currentRevision}=input;
      return route.fulfill({json:{sessionId,problemId,graphVersion,language,baselineRevision,currentRevision,probabilities:{hotter:.8,colder:.2}}});
    }
    if (request.method()==='POST') {
      const input=request.postDataJSON();
      if (!input.source) return route.fulfill({status:202,json:{problemId:id(0),status:'queued',preview:{title:'Custom',statement:input.statement}}});
      const index=Number(input.slug.split('-')[1]);
      return route.fulfill({status:202,json:{problemId:id(index),status:'importing'}});
    }
    const index=Number(path.split('/').at(-1)[0])-1;
    if (heldPoll) { const wait=heldPoll; heldPoll=null; await wait; }
    return route.fulfill({json:stage==='ready' ? {status:stage,...metadata(index)} :
      {problemId:id(index),status:stage,preview:metadata(index),...(stage==='failed'?{error:'Feedback temporarily unavailable.'}:{})}});
  });
  await page.goto(`${process.env.BASE_URL || 'http://localhost:3000'}/tutor`);
  await expect(page.locator('.problem-choice')).toHaveCount(3);
  const colors = await page.locator('.difficulty').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).color));
  assert.equal(new Set(colors).size,3);
  await page.getByRole('button',{name:'Problem 0, Easy',exact:true}).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toHaveAttribute('contenteditable','true');
  await expect(editor).toContainText('def solve');
  await editor.fill('class Solution:\n    def solve(self, nums):\n        return sum(nums)');
  assert.equal(evaluations.length,0,'No evaluation before a reviewed map');
  stage='ready';
  await expect(page.locator('#direction')).toHaveText('Warmer',{timeout:8000});
  assert.match(evaluations[0].beforeCode,/Write your code inside the method below/);
  assert.match(evaluations[0].afterCode,/return sum/);
  await expect(editor).toContainText('return sum');
  await page.locator('#language').selectOption('javascript');
  await expect(editor).toContainText('solve(nums)');
  await page.locator('#language').selectOption('python');
  await expect(editor).toContainText('return sum');

  // A late response for a previous question cannot replace the new editor.
  await page.locator('#change-problem').click(); stage='mapping_approaches';
  heldPoll=new Promise(resolve=>{releasePoll=resolve;});
  await page.getByRole('button',{name:'Problem 1, Medium',exact:true}).click();
  await expect(page.locator('#cancel-preparation')).toBeVisible();
  await page.locator('#cancel-preparation').click();
  await page.getByRole('button',{name:'Problem 2, Hard',exact:true}).click();
  await expect(page.locator('#problem-text')).toContainText('Problem 2');
  releasePoll();
  await expect(page.locator('#problem-text')).toContainText('Problem 2');
  await editor.fill('class Solution:\n    def solve(self, nums):\n        return 42');
  stage='failed';
  await expect(page.locator('#retry-feedback')).toBeVisible({timeout:5000});
  await expect(editor).toContainText('return 42');
  stage='ready'; await page.locator('#retry-feedback').click();
  await expect(page.locator('#problem-status')).toContainText('Jev is ready');
  await expect(editor).toContainText('return 42');

  await page.locator('#change-problem').click();
  await page.locator('#custom-tab').click(); stage='mapping_approaches';
  await page.locator('#prepare').click();
  await expect(editor).toHaveAttribute('contenteditable','true');
  await expect(page.locator('#problem-source')).toHaveText('Custom');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile has no horizontal overflow');
  assert.deepEqual(errors,[]);
  console.log('PASS: early editing, ready baseline, draft/language retention, stale responses, retry, Custom, difficulty colors, mobile.');
} finally { await browser.close(); }
