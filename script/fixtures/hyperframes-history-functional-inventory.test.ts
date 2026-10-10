import { expect, test } from "bun:test";
import { lifecycleBrowserInventoryScript } from "./hyperframes-audio-analysis-lifecycle-process";

test.skipIf(process.platform!=="win32")("slash and native Chromium paths identify the same exact direct child",()=>{
	const slash="C:/Program Files/Google/Chrome/Application/chrome.exe";
	const native="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
	const script=lifecycleBrowserInventoryScript(slash,1234);
	expect(script).toBe(lifecycleBrowserInventoryScript(native,1234));
	expect(script).toContain("ParentProcessId = 1234");
	expect(script).toContain(`$_.ExecutablePath -eq '${native}'`);
});
test("inventory quotes exact executable rather than interpolating shell code",()=>{
	const script=lifecycleBrowserInventoryScript("C:/author's tools/chrome.exe",1234);
	expect(script).toContain("author''s tools");
	expect(()=>lifecycleBrowserInventoryScript("C:/chrome.exe",NaN)).toThrow();
});
