import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { expect } from "@playwright/test";

export async function probeCueRanges(page, evidence) {
  const editingDigest = record => {
    // Playhead/zoom and updatedAt may autosave during a genuine preview.
    // Compare the actual edit graph and settings, not those view preferences.
    const {scenes,motionTextSequences,settings}=record.data;
    return createHash("sha256").update(JSON.stringify({scenes,motionTextSequences,settings})).digest("hex");
  };
  await page.locator('[aria-label="Timeline"]').getByText('Clean caption',{exact:true}).click();
  const cue=page.locator('[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]').first();
  if(await cue.getAttribute('aria-expanded')!=='true') await cue.click();
  const range=page.locator('[data-motion-text-cue-range="true"]');
  await expect(range).toBeVisible();
  const overflow=await range.evaluate(e=>({width:e.clientWidth,content:e.scrollWidth}));
  assert(overflow.content<=overflow.width+1,'Cue range actions overflow the inspector: '+JSON.stringify(overflow));
  const before=await page.evaluate(async()=>(await(await fetch(new URL('api/record',location.href))).json()).record);
  const start=Number(await range.getAttribute('data-range-start'))/120000;
  const end=Number(await range.getAttribute('data-range-end'))/120000;
  await range.getByRole('button',{name:'Use cue as export range',exact:true}).click();
  await expect(range.getByRole('button',{name:'Clear export range',exact:true})).toBeVisible();
  await range.getByRole('button',{name:'Clear export range',exact:true}).click();
  await range.getByRole('button',{name:'Loop selected cue',exact:true}).click();
  await expect(page.locator('[aria-label="Pause preview"]')).toBeVisible();
  await page.locator('[aria-label="Pause preview"]').click();
  const nearEnd=end-0.1;
  const seconds=Math.floor(nearEnd),frames=Math.round((nearEnd-seconds)*30);
  const time='00:00:'+String(seconds).padStart(2,'0')+':'+String(frames).padStart(2,'0');
  await page.locator('[aria-label="Edit playhead time"]').click();
  await page.locator('[aria-label="Playhead time"]').fill(time);
  await page.locator('[aria-label="Playhead time"]').press('Enter');
  await page.locator('[aria-label="Play preview"]').click();
  await expect.poll(async()=>{
    const [h,m,s,f]=(await page.locator('[aria-label="Edit playhead time"]').innerText()).split(':').map(Number);
    const now=h*3600+m*60+s+f/30;
    return now>=start && now<start+1;
  },{timeout:5000,message:'Cue playback must wrap from its end to its start'}).toBe(true);
  await page.locator('[aria-label="Pause preview"]').click();
  await range.getByRole('button',{name:'Stop cue loop',exact:true}).click();
  await expect(range.getByRole('button',{name:'Loop selected cue',exact:true})).toBeVisible();
  const after=await page.evaluate(async()=>(await(await fetch(new URL('api/record',location.href))).json()).record);
  assert.equal(editingDigest(after),editingDigest(before),'Loop/export selection must not mutate the edit graph or settings');
  await page.locator('textarea[id^="motion-text-cue-"]').locator('..').locator('..').getByRole('button',{name:'Cancel',exact:true}).click();
  evidence.checks.push({name:'cue loop wraps, export range toggles and preview controls preserve project data',pass:true});
}
