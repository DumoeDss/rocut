import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";

export async function probeInstalledPreview(parent, frame, work, evidence) {
  await frame.locator('[aria-label="Media"]').click();
  const count = () => frame.evaluate(async () => (await (await fetch(new URL('api/attachments',location.href))).json()).length);
  const before = await count();
  const chooser = parent.waitForEvent('filechooser');
  await frame.locator('[aria-label="Import media"]').click();
  await (await chooser).setFiles(resolve('apps/vite-example/tests/fixtures/fixture-image.png'));
  await expect.poll(count).toBe(before+1);
  evidence.checks.push({name:'native media file chooser imports PNG without replacing existing attachments',pass:true});
  await frame.locator('[aria-label="Edit playhead time"]').click();
  await frame.locator('[aria-label="Playhead time"]').fill('00:00:02:00');
  await frame.locator('[aria-label="Playhead time"]').press('Enter');
  await frame.locator('[aria-label="Play preview"]').click();
  await expect.poll(()=>frame.locator('[aria-label="Edit playhead time"]').innerText()).not.toBe('00:00:02:00');
  await frame.locator('[aria-label="Pause preview"]').click();
  const png=await frame.locator('canvas').first().screenshot({path:join(work,'real-preview.png')});
  const pixels=await parent.evaluate(async bytes=>{
    const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
    const {data}=ctx.getImageData(0,0,bitmap.width,bitmap.height);
    let red=0,light=0;
    for(let i=0;i<data.length;i+=4){if(data[i]>160&&data[i+1]<130&&data[i+2]<130)red++;if(data[i]>200&&data[i+1]>200&&data[i+2]>200)light++;}
    bitmap.close();return {redFraction:red/(data.length/4),lightFraction:light/(data.length/4)};
  },Array.from(png));
  assert(pixels.redFraction>0.25,'Real iframe preview must show video pixels');
  assert(pixels.lightFraction>0.001,'Real iframe preview must overlay motion glyphs');
  evidence.checks.push({name:'installed preview visibly composites video and motion text, plays and pauses',...pixels,pass:true});
}
