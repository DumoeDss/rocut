import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export function validateGpuMemorySample(value, { gpuPid, mainPid, created }) {
	assert.equal(value.pid, gpuPid, "GPU process identity changed");
	assert.equal(
		value.parentPid,
		mainPid,
		"GPU process is not owned by this host",
	);
	assert.equal(value.isGpu, true, "Target is not a GPU process");
	assert.equal(typeof value.created, "string");
	assert(value.created.length > 0, "Process creation time is required");
	if (created) assert.equal(value.created, created, "GPU PID was reused");
	assert(
		Array.isArray(value.rows) && value.rows.length > 0,
		"GPU counters unavailable",
	);
	const seen = new Set();
	const totals = { dedicated: 0, shared: 0, committed: 0 };
	for (const row of value.rows) {
		assert.equal(typeof row.name, "string");
		assert(
			row.name.startsWith(`pid_${gpuPid}_`),
			"Counter belongs to another process",
		);
		assert(!seen.has(row.name), "Duplicate GPU adapter counter");
		seen.add(row.name);
		for (const key of Object.keys(totals)) {
			assert(
				Number.isSafeInteger(row[key]) && row[key] >= 0,
				"Invalid GPU byte counter",
			);
			totals[key] += row[key];
			assert(Number.isSafeInteger(totals[key]), "GPU counter sum overflow");
		}
	}
	// Dedicated/shared resident usage and committed bytes are separate metrics.
	// Do not add committed bytes to resident usage or infer editor attribution.
	return { ...value, totals };
}

export async function readWindowsGpuMemory({ gpuPid, mainPid, created }) {
	for (const id of [gpuPid, mainPid])
		assert(Number.isSafeInteger(id) && id > 0);
	assert.equal(process.platform, "win32", "Windows GPU counters required");
	const command = `
$ErrorActionPreference='Stop'
$taskGpu=Get-CimInstance Win32_Process -Filter 'ProcessId=${gpuPid}'
if ($null -eq $taskGpu) { throw 'GPU process disappeared' }
$taskRows=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory | Where-Object { $_.Name -match '^pid_${gpuPid}_' } | ForEach-Object { @{name=$_.Name;dedicated=[long]$_.DedicatedUsage;shared=[long]$_.SharedUsage;committed=[long]$_.TotalCommitted} })
@{pid=[int]$taskGpu.ProcessId;parentPid=[int]$taskGpu.ParentProcessId;isGpu=[bool]($taskGpu.CommandLine -match '--type=gpu-process');created=$taskGpu.CreationDate.ToUniversalTime().ToString('o');rows=$taskRows} | ConvertTo-Json -Depth 4 -Compress
`;
	const { stdout } = await run(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-Command", command],
		{
			windowsHide: true,
			timeout: 20000,
			maxBuffer: 128 * 1024,
			encoding: "utf8",
		},
	);
	return validateGpuMemorySample(JSON.parse(stdout.trim()), {
		gpuPid,
		mainPid,
		created,
	});
}
