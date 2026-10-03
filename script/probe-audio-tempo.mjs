import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function probeAudioTempo(page, evidence) {
  const read = () => page.evaluate(async () => {
    const {record}=await (await fetch(new URL("api/record",location.href))).json();
    return record.data.motionTextSequences[0];
  });
  const before=await read();
  const bpm=page.getByLabel("Manual BPM",{exact:true});
  await bpm.fill("10");
  await expect(page.getByRole("button",{name:"Apply tempo",exact:true})).toBeDisabled();
  assert.deepEqual((await read()).audioBinding,before.audioBinding,"Invalid tempo must not persist");
  await bpm.fill("120");
  await page.getByLabel("First beat (sequence sec)",{exact:true}).fill("0.2");
  await page.getByRole("button",{name:"Apply tempo",exact:true}).click();
  await expect.poll(async()=> (await read()).audioBinding.beatOverride).toEqual({bpm:120,firstBeat:24000});
  const focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,insideSurface:!!document.activeElement?.closest("[data-editor-surface]")}));
  evidence.checks.push({name:"manual audio tempo apply focus",...focus});
  assert(focus.insideSurface,"Applying tempo must preserve shortcut focus");
  await page.keyboard.press("Control+z");
  await expect.poll(async()=> (await read()).audioBinding.beatOverride).toEqual(before.audioBinding.beatOverride);
  await expect(bpm).toHaveValue(before.audioBinding.beatOverride?.bpm?.toString()??"");
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async()=> (await read()).audioBinding.beatOverride).toEqual({bpm:120,firstBeat:24000});
  await expect(bpm).toHaveValue("120");
  await page.getByRole("button",{name:"Use detected",exact:true}).click();
  await expect.poll(async()=> (await read()).audioBinding.beatOverride).toBeUndefined();
  await page.keyboard.press("Control+z");
  await expect.poll(async()=> (await read()).audioBinding.beatOverride).toEqual({bpm:120,firstBeat:24000});
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async()=> (await read()).audioBinding.beatOverride).toBeUndefined();
  evidence.checks.push({name:"manual tempo validation, apply/reset and keyboard undo/redo",pass:true});
}
