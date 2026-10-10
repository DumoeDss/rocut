import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { join, win32 } from "node:path";
import { imageBytes } from "./frost-editor-image.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function run({
	startHost,
	TargetRegistry,
	root,
	creator,
	configPath,
}) {
	const privatePath = async (path) => {
		const resolved = await realpath(path),
			relative = win32.relative("C:/tmps", resolved);
		assert(
			relative && !relative.startsWith("..") && !win32.isAbsolute(relative),
		);
		return resolved;
	};
	await privatePath(root);
	await privatePath(configPath);
	const config = JSON.parse(await readFile(configPath, "utf8"));
	await privatePath(config.editorDist);
	const manifest = JSON.parse(
		await readFile(join(root, "editor-closure.json"), "utf8"),
	);
	const pin = async () => {
		for (const f of [...manifest.files, ...manifest.pinned])
			assert.equal(sha(await readFile(f.path)), f.sha256, f.path);
	};
	await pin();
	const command = new Promise((done) => {
		let input = "";
		process.stdin.on("data", (bytes) => {
			input += bytes.toString();
			if (input.includes("\n")) done(input.split(/\r?\n/)[0].trim());
		});
		process.stdin.once("end", () => done(input.trim() || "stop"));
	});
	const projectRoot = config.projectRoot || join(root, "project");
	if (config.projectRoot) await privatePath(projectRoot);
	const options = {
		projectRoot,
		staticDir: config.editorDist,
		port: 0,
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	const lifecycle = {
		hostClosed: false,
		reopened: false,
		ready: false,
		verified: false,
		exportTested: false,
	};
	let host;
	const open = async () => {
		host = await startHost(options);
	};
	const close = async () => {
		if (host) {
			await host.close();
			host = undefined;
		}
	};
	const save = (name, value) =>
		writeFile(
			join(root, name),
			Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2),
			{ flag: "wx" },
		);
	const request = async (route) => {
		const response = await fetch(new URL(`api/${route}`, host.editorUrl), {
			signal: AbortSignal.timeout(15000),
		});
		const value = await response.json();
		assert.equal(response.status, 200, JSON.stringify(value));
		return value;
	};
	const snapshot = async () => {
		const context = await request("context"),
			byId = (a, b) => a.id.localeCompare(b.id);
		return {
			project: context.project,
			revision: context.revision,
			clips: (await request("clips")).sort(byId),
			tracks: (await request("tracks")).sort(byId),
		};
	};
	try {
		let imagePath;
		if (!config.projectRoot) {
			const author = join(root, "author");
			await mkdir(author);
			const png = imageBytes(192, 128);
			imagePath = join(author, "frost-source.png");
			await writeFile(imagePath, png.bytes, { flag: "wx" });
			await save("image-evidence.json", {
				sha256: sha(png.bytes),
				...png.alphaFixture,
			});
		}
		await open();
		const liveConfig = {
			...config,
			creator,
			root: config.fixtureRoot || root,
			imagePath,
			prepare: !config.projectRoot,
			projectPath: join(projectRoot, "project.json"),
			editorUrl: host.editorUrl,
		};
		await save("live-config.json", liveConfig);
		lifecycle.ready = true;
		console.log(
			JSON.stringify({
				ready: true,
				editorUrl: host.editorUrl,
				root,
				configPath: join(root, "live-config.json"),
			}),
		);
		const action = await command;
		process.stdin.pause();
		assert(
			["stop", "verify"].includes(action),
			"Expected stdin stop or verify",
		);
		if (action === "verify") {
			const current = await snapshot(),
				persisted = await readFile(liveConfig.projectPath);
			const expected = JSON.parse(
				await readFile(
					join(config.fixtureRoot || root, "frost-editor-final-expected.json"),
					"utf8",
				),
			);
			assert.deepEqual(current, expected);
			await close();
			await open();
			assert.deepEqual(await snapshot(), current);
			assert.deepEqual(await readFile(liveConfig.projectPath), persisted);
			lifecycle.reopened = true;
			lifecycle.verified = true;
			await save("project-after-reopen.json", persisted);
			await save("verified.json", {
				snapshot: current,
				projectSha256: sha(persisted),
				byteIdentical: true,
			});
		}
	} catch (error) {
		lifecycle.error = error.stack ?? String(error);
		throw error;
	} finally {
		try {
			await close();
			lifecycle.hostClosed = true;
			await pin();
		} finally {
			await save("host-lifecycle.json", lifecycle);
		}
	}
}
