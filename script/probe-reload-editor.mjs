import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";

// Electron/CDP can miss the frame's navigation event around beforeunload.
// A per-document marker proves the old JS context was actually replaced.
export async function reloadEditorFrame(frame) {
  const marker = "__rocut_reload_" + randomUUID().replaceAll("-", "");
  await frame.evaluate(key => { globalThis[key] = true; }, marker);
  await frame.evaluate(() => location.reload());
  await expect.poll(async () => {
    try { return await frame.evaluate(key => globalThis[key] !== true, marker); }
    catch { return false; }
  }, {timeout:30000, message:"Editor reload must replace its document"}).toBe(true);
  await expect(frame.locator('[aria-label="Media"]')).toBeVisible({timeout:30000});
}
