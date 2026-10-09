import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export interface OwnedLifecycleBrowser {
	pid: number;
	profile: string;
}

/** Read only; restrict OS observation to this test process's direct Chromium children. */
export function ownedLifecycleBrowsers(
	executable: string,
): OwnedLifecycleBrowser[] {
	assert.equal(process.platform, "win32");
	const quotedExecutable = executable.replace(/'/g, "''");
	const script = [
		"[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
		`$lifecycleChildren = @(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${process.pid}' | Where-Object { $_.ExecutablePath -eq '${quotedExecutable}' } | Select-Object ProcessId, CommandLine)`,
		"ConvertTo-Json -InputObject $lifecycleChildren -Compress",
	].join("\n");
	const raw = execFileSync(
		"powershell.exe",
		["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
		{
			encoding: "utf8",
			windowsHide: true,
			timeout: 5000,
			maxBuffer: 128 * 1024,
		},
	);
	const items = JSON.parse(raw) as { ProcessId: number; CommandLine: string }[];
	return items.flatMap((item) => {
		if (!item.CommandLine.includes("--remote-debugging-port=0")) return [];
		const match =
			/"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\s"]+)/.exec(
				item.CommandLine,
			);
		assert.ok(match, "Private Chromium must name its own profile");
		const profile = resolve(match[1] ?? match[2] ?? match[3]);
		assert.equal(dirname(profile), resolve(tmpdir()));
		assert.ok(basename(profile).startsWith("rocut-html-frame-"));
		return [{ pid: item.ProcessId, profile }];
	});
}

export async function lifecycleBrowserEndpoint(browser: OwnedLifecycleBrowser) {
	const [port, pathname] = (
		await readFile(join(browser.profile, "DevToolsActivePort"), "utf8")
	)
		.trim()
		.split(/\r?\n/);
	assert.ok(/^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535);
	assert.ok(/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(pathname));
	return `ws://127.0.0.1:${port}${pathname}`;
}

/** No signal is sent: signal 0 asks the OS whether this already-owned PID exists. */
export function assertLifecycleBrowserRemoved(browser: OwnedLifecycleBrowser) {
	assert.equal(
		existsSync(browser.profile),
		false,
		"Production close must remove its profile, including open-file handles",
	);
	let alive = true;
	try {
		process.kill(browser.pid, 0);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		alive = false;
	}
	assert.equal(
		alive,
		false,
		"Production close must terminate its own Chromium process",
	);
}
