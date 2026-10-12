import { spawn } from "node:child_process";
import { blazeEditorRequest } from "./blaze-editor-control.mjs";

export async function openFrostScheduleHost({ directory, runtime, toolchain,
	chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe" }) {
	const child = spawn(process.execPath, [runtime + "/rocut.mjs", "host", "start",
		directory + "/project", "--port", "0", "--targets-root", directory + "/registry"], {
		cwd: directory, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, ROCUT_ENGINE_TOOLCHAIN_DIR: toolchain,
			ROCUT_HTML_BROWSER_PATH: chrome, ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
			ROCUT_NATIVE_FFMPEG_PATH: "E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe",
			ROCUT_NATIVE_FFPROBE_PATH: "E:/Software/ffmpeg-6.0-full_build/bin/ffprobe.exe" },
	});
	let output = "", errors = "";
	const closed = new Promise(resolve => child.once("exit", resolve));
	child.stderr.on("data", bytes => { errors = (errors + bytes.toString()).slice(-2000); });
	const editorUrl = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(Error("Frost Host startup deadline")), 30000);
		child.once("error", error => { clearTimeout(timer); reject(error); });
		child.once("exit", code => { clearTimeout(timer); reject(Error("Frost Host exited " + code + " " + errors)); });
		child.stdout.on("data", bytes => {
			output += bytes.toString();
			const match = output.match(/editorUrl (\S+)/u);
			if (match) { clearTimeout(timer); resolve(match[1]); }
		});
	}).catch(async error => { child.kill(); await closed; throw error; });
	return { editorUrl, pid: child.pid, request: blazeEditorRequest(editorUrl),
		async close() { child.kill(); await closed; } };
}
