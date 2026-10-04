import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";

const ffmpeg = (args) => execFileSync("ffmpeg", ["-v", "error", "-n", ...args], { windowsHide: true });
function fixtures(work) {
	const entries = [];
	for (const [name, encoding] of [
		["import-avc.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]],
		["导入 片段.mov", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]],
		["import-vp9.webm", ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8"]],
		["import-avc.mkv", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]],
	]) {
		const path = join(work, name);
		ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=320x180:r=30:d=2", ...encoding, path]);
		entries.push({ name, path, type: "video" });
	}
	for (const [extension, encoding] of [
		["wav", ["-c:a", "pcm_s16le"]], ["mp3", ["-c:a", "libmp3lame"]],
		["flac", ["-c:a", "flac"]], ["ogg", ["-c:a", "libvorbis"]],
		["opus", ["-c:a", "libopus"]], ["m4a", ["-c:a", "aac"]],
	]) {
		const name = "import-tone." + extension, path = join(work, name);
		ffmpeg(["-f", "lavfi", "-i", "sine=frequency=880:duration=2", ...encoding, path]);
		entries.push({ name, path, type: "audio" });
	}
	for (const extension of ["png", "jpg", "webp"]) {
		const name = "import-red." + extension, path = join(work, name);
		ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=320x180", "-frames:v", "1", path]);
		entries.push({ name, path, type: "image" });
	}
	return entries;
}

export async function probeMediaImport({ page, hostPage, work, evidence, onPhase }) {
	onPhase("media import format fixtures");
	const entries = fixtures(work);
	const attachments = () => page.evaluate(async () => (await fetch(new URL("api/attachments", location.href))).json());
	const clips = () => page.evaluate(async () => {
		const tracks = (await (await fetch(new URL("api/record", location.href))).json()).record.data.scenes[0].tracks;
		return [tracks.main, ...tracks.overlay, ...tracks.audio].flatMap(track => track.elements);
	});
	await page.getByLabel("Media", { exact: true }).click();
	await page.evaluate(() => {
		globalThis.__importObservations = [];
		document.addEventListener("change", event => {
			if (event.target instanceof HTMLInputElement && event.target.type === "file")
				globalThis.__importObservations.push(...Array.from(event.target.files ?? [], file => ({name:file.name,type:file.type,size:file.size})));
		}, true);
	});
	const chooseFiles = async (paths) => {
		const chooserPromise = hostPage.waitForEvent("filechooser");
		await page.getByLabel("Import media", { exact: true }).click();
		const chooser = await chooserPromise;
		assert(chooser.isMultiple(), "Import button must allow a batch");
		await chooser.setFiles(paths);
	};
	onPhase("real Import button and multi-format batch");
	await chooseFiles(entries.map(entry => entry.path));
	await expect(page.getByLabel("Import media", { exact: true })).toBeEnabled({timeout:60000});
	const imported = await attachments();
	evidence.importFormats = { input:await page.evaluate(() => globalThis.__importObservations), stored:imported.map(item=>item.metadata), toasts:await page.locator('[data-sonner-toast]').allTextContents() };
	assert.deepEqual(imported.map(item=>item.metadata.name).sort(), entries.map(entry=>entry.name).sort(), "Every supported format must persist");
	for (const entry of entries) {
		const saved = imported.find(item=>item.metadata.name === entry.name);
		assert.equal(saved.metadata.type, entry.type);
		if (entry.type !== "image") assert(saved.metadata.duration > 1.9 && saved.metadata.duration < 2.2, "Finite source duration: " + entry.name);
		if (entry.type !== "audio") {assert.equal(saved.metadata.width,320);assert.equal(saved.metadata.height,180);}
		const bodyHash = await page.evaluate(async key => {
			const body = await (await fetch(new URL("api/attachment/"+encodeURIComponent(key), location.href))).arrayBuffer();
			return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",body)), value=>value.toString(16).padStart(2,"0")).join("");
		},saved.key);
		assert.equal(bodyHash,createHash("sha256").update(readFileSync(entry.path)).digest("hex"));
	}
	evidence.checks.push({name:"Import button opens multi-file chooser; 13 formats preserve bytes, type, metadata and Unicode names",pass:true});
	onPhase("media batch reopen");
	await page.reload();
	await page.getByLabel("Media", { exact: true }).click();
	const list = page.getByLabel("Switch to list view", {exact:true});
	if (await list.count()) await list.click();
	for (const entry of entries) await expect(page.getByLabel("Add "+entry.name+" to timeline",{exact:true})).toBeAttached();
	assert.deepEqual((await attachments()).map(item=>item.metadata.name).sort(), entries.map(entry=>entry.name).sort());
	evidence.checks.push({name:"Every imported format and Unicode filename rehydrates after iframe reopen",pass:true});
	onPhase("imported picture previews");
	for (const entry of entries.filter(item=>item.type!=="audio")) {
		await page.getByLabel("Add "+entry.name+" to timeline",{exact:true}).click();
		await expect.poll(async ()=>(await clips()).length).toBe(1);
		await page.getByLabel("Edit playhead time",{exact:true}).click();
		await page.getByLabel("Playhead time",{exact:true}).fill("00:00:00:15");
		await page.getByLabel("Playhead time",{exact:true}).press("Enter");
		await expect.poll(async () => {
			const bytes = await page.locator("canvas").first().screenshot();
			return page.evaluate(async bytes => {
				const image = await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:"image/png"}));
				const canvas=new OffscreenCanvas(image.width,image.height), context=canvas.getContext("2d");
				context.drawImage(image,0,0);image.close();
				const pixel=context.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data;
				return pixel[0]>180 && pixel[1]<75 && pixel[2]<75;
			},Array.from(bytes));
		},{timeout:20000,message:"Decoded preview for "+entry.name}).toBe(true);
		await page.getByLabel("Delete element",{exact:true}).click();
		await expect.poll(async ()=>(await clips()).length).toBe(0);
	}
	evidence.checks.push({name:"MP4/MOV/WebM/MKV/PNG/JPEG/WebP have decoded red previews after reopen",pass:true});
	onPhase("mixed valid and corrupt import batch");
	const corrupt = join(work,"broken-batch.mp4");writeFileSync(corrupt,"not a media container");
	const valid = join(work,"batch-survivor.wav");ffmpeg(["-f","lavfi","-i","sine=frequency=440:duration=1","-c:a","pcm_s16le",valid]);
	await chooseFiles([corrupt,valid]);
	await expect(page.getByLabel("Import media",{exact:true})).toBeEnabled({timeout:30000});
	const after = await attachments();
	assert.equal(after.length,entries.length+1);
	assert(after.some(item=>item.metadata.name==="batch-survivor.wav"));
	assert(!after.some(item=>item.metadata.name==="broken-batch.mp4"));
	evidence.checks.push({name:"Corrupt file does not poison a mixed batch or overwrite previous imports",pass:true});
	onPhase("failed persistence must not claim upload success");
	const rejected = join(work,"storage-rejected.wav");ffmpeg(["-f","lavfi","-i","sine=frequency=440:duration=1","-c:a","pcm_s16le",rejected]);
	let rejectedWrites = 0;
	const rejectAttachment = async route => {
		if (route.request().method() !== "PUT") return route.continue();
		const metadata=JSON.parse(Buffer.from(route.request().headers()["x-opencut-metadata"],"base64").toString("utf8"));
		if (metadata.name !== "storage-rejected.wav") return route.continue();
		rejectedWrites++;
		await route.fulfill({status:507,contentType:"application/json",body:JSON.stringify({error:"E2E controlled storage failure"})});
	};
	await hostPage.route("**/api/attachment/*",rejectAttachment);
	try {
		await chooseFiles([rejected]);
		await expect.poll(()=>rejectedWrites).toBe(1);
		await expect(page.getByLabel("Import media",{exact:true})).toBeEnabled({timeout:30000});
		assert.equal((await attachments()).length,entries.length+1);
		const toasts=await page.locator('[data-sonner-toast]').allTextContents();
		evidence.storageFailure={rejectedWrites,toasts};
		assert(!toasts.some(text=>text.includes("storage-rejected.wav has been uploaded")),"Failed persistence must not report successful upload");
		assert(toasts.some(text=>text.includes("Failed to upload")),"Failed persistence must show failed upload feedback");
		const partial=join(work,"partial-survivor.wav");ffmpeg(["-f","lavfi","-i","sine=frequency=660:duration=1","-c:a","pcm_s16le",partial]);
		await chooseFiles([rejected,partial]);
		await expect.poll(()=>rejectedWrites).toBe(2);
		await expect(page.getByLabel("Import media",{exact:true})).toBeEnabled({timeout:30000});
		assert.equal((await attachments()).length,entries.length+2);
		await expect(page.locator('[data-sonner-toast][data-visible="true"]').filter({hasText:"1 of 2 media assets uploaded; 1 failed"}).first()).toBeVisible();
	} finally {await hostPage.unroute("**/api/attachment/*",rejectAttachment);}
	evidence.checks.push({name:"Failed and partial attachment persistence reports only durable assets",pass:true});
	await chooseFiles([rejected]);
	await expect.poll(async ()=>(await attachments()).length).toBe(entries.length+3);
	await expect(page.getByLabel("Import media",{exact:true})).toBeEnabled({timeout:30000});
	await page.reload();
	assert.equal((await attachments()).length,entries.length+3);
	evidence.checks.push({name:"Retry after storage recovery succeeds and all successful imports survive reopen",pass:true});
	await page.screenshot({path:join(work,"media-import-formats.png")});
}
