import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIGEST = /^[0-9a-f]{64}$/;

function text(value) {
	return typeof value === "string" && value.length > 0;
}

function add(issues, condition, message) {
	if (!condition) issues.push(message);
}

const GLOBAL_HOOKS = [
	["globalThis.setTimeout", "timeouts"],
	["globalThis.setInterval", "intervals"],
	["globalThis.requestAnimationFrame", "animationFrames"],
	["globalThis.Worker", "workers"],
	["globalThis.AudioContext", "audioContextConstructions"],
	["globalThis.webkitAudioContext", "webkitAudioContextConstructions"],
	["URL.createObjectURL", "objectUrls"],
	["navigator.gpu.requestAdapter", "webGpuAdapterRequests"],
	["WebAssembly.instantiate", "wasmInstantiateCalls"],
	["WebAssembly.instantiateStreaming", "wasmInstantiateStreamingCalls"],
];
const GLOBAL_FIELDS = [
	"timeouts",
	"intervals",
	"animationFrames",
	"workers",
	"audioContexts",
	"audioContextConstructions",
	"webkitAudioContextConstructions",
	"objectUrls",
	"webGpuAdapterRequests",
	"wasmInstantiations",
	"wasmInstantiateCalls",
	"wasmInstantiateStreamingCalls",
];
const HOST_HOOKS = [
	["host.runtimeResources.createWorker", "workers"],
	["host.runtimeResources.createAudioContext", "audioContexts"],
	["host.runtimeResources.createObjectUrl", "objectUrls"],
	["host.environment.describeGraphics", "graphicsQueries"],
];
const HOST_FIELDS = [
	"workers",
	"audioContexts",
	"objectUrls",
	"graphicsQueries",
];
const REACT_HOOK_PATHS = [
	"document.reactRootMarkers",
	"globalThis.MutationObserver",
];
const REACT_FIELDS = [
	"mutationRecords",
	"rootMarkersBefore",
	"rootMarkersAfter",
	"mountAttempts",
];
const COMPOSITOR_FIELDS = [
	"hostGraphicsQueries",
	"webGpuAdapterRequests",
	"wasmInstantiations",
	"ownershipAttempts",
];

function validateHookGroup({ group, strategy, paths, label, issues }) {
	add(
		issues,
		group && typeof group === "object",
		`runtime ${label} hook provenance is absent`,
	);
	if (!group || typeof group !== "object") return [];
	add(
		issues,
		group.strategy === strategy,
		`runtime ${label} hook provenance strategy is invalid`,
	);
	const hooks = Array.isArray(group.hooks) ? group.hooks : [];
	add(
		issues,
		hooks.length === paths.length &&
			hooks.every((hook, index) => hook?.path === paths[index]),
		`runtime ${label} hook provenance field order is invalid`,
	);
	for (const [index, path] of paths.entries()) {
		const hook = hooks[index];
		add(
			issues,
			hook?.path === path &&
				["installed", "absent"].includes(hook?.status) &&
				text(hook?.detail),
			`runtime ${label} hook provenance is incomplete for ${path}`,
		);
		add(
			issues,
			hook?.status !== "unpatchable",
			`runtime ${label} hook is unpatchable: ${path}`,
		);
		if (hook?.status === "absent") {
			add(
				issues,
				/absent|typeof|no DOM/.test(hook.detail),
				`runtime ${label} hook absence lacks evidence for ${path}`,
			);
		}
	}
	return hooks;
}

function hookStatus(hooks, path) {
	return hooks.find((hook) => hook?.path === path)?.status;
}

function validateRuntimeProbe(result, expected, issues, mode) {
	const probe = result.runtimeProbe;
	add(
		issues,
		probe && typeof probe === "object",
		"runtime probe provenance is absent",
	);
	if (!probe || typeof probe !== "object") return;
	add(issues, probe.schemaVersion === 1, "runtime probe schema is invalid");
	add(
		issues,
		probe.implementation === "headless-runtime-probe/v1",
		"runtime probe implementation identity is invalid",
	);
	add(
		issues,
		probe.probeId ===
			`c7-runtime-probe:${result.host}:${result.buildMarker}:${result.entry}`,
		"runtime probe identity is not attributable to this Host run",
	);
	add(issues, probe.host === expected.host, "runtime probe Host is mismatched");
	add(
		issues,
		probe.buildMarker === expected.buildMarker,
		"runtime probe build marker is mismatched",
	);
	add(
		issues,
		probe.entry === expected.entry,
		"runtime probe entry is mismatched",
	);
	add(
		issues,
		probe.environment === (expected.host === "vite" ? "browser" : "server"),
		"runtime probe environment is not the expected Host environment",
	);

	const events = Array.isArray(probe.events) ? probe.events : [];
	const eventKinds = [
		"probe-installed",
		"subject-load-started",
		"host-bound",
		"subject-completed",
		"probe-restored",
	];
	add(
		issues,
		events.length === eventKinds.length &&
			events.every(
				(event, index) =>
					event?.sequence === index + 1 && event?.kind === eventKinds[index],
			),
		"runtime probe did not install before subject loading and restore afterward",
	);

	const binding = probe.hostBinding;
	add(
		issues,
		binding?.source === "fixture-explicit-createInMemoryHost",
		"runtime probe Host/store selection provenance is absent",
	);
	add(
		issues,
		binding?.expectedProjectId === result.projectId &&
			binding?.actualProjectId === result.projectId &&
			binding?.projectMatches === true,
		"runtime probe observed a mismatched Host project",
	);
	add(
		issues,
		binding?.intendedStoreIdentity === "InMemoryProjectStore" &&
			binding?.actualStoreIdentity === result.storeIdentity &&
			binding?.sameStoreInstance === true &&
			binding?.fallbackUsed === false &&
			result.hostFallback === binding?.fallbackUsed,
		"runtime probe observed Host/store fallback or an unattributed store",
	);

	const globalHooks = validateHookGroup({
		group: probe.hookProvenance?.global,
		strategy: "pre-load-callable-proxy/v1",
		paths: GLOBAL_HOOKS.map(([path]) => path),
		label: "global",
		issues,
	});
	const hostHooks = validateHookGroup({
		group: probe.hookProvenance?.host,
		strategy: "post-bind-host-callable-proxy/v1",
		paths: HOST_HOOKS.map(([path]) => path),
		label: "Host",
		issues,
	});
	const reactHooks = validateHookGroup({
		group: probe.hookProvenance?.react,
		strategy:
			expected.host === "vite"
				? "browser-mutation-observer+root-marker-scan/v1"
				: "server-no-dom/v1",
		paths: REACT_HOOK_PATHS,
		label: "React",
		issues,
	});
	const requiredGlobalHooks = new Set([
		"globalThis.setTimeout",
		"globalThis.setInterval",
		"URL.createObjectURL",
		"WebAssembly.instantiate",
		"WebAssembly.instantiateStreaming",
	]);
	if (expected.host === "vite") {
		requiredGlobalHooks.add("globalThis.requestAnimationFrame");
		requiredGlobalHooks.add("globalThis.Worker");
		requiredGlobalHooks.add("globalThis.AudioContext");
	}
	for (const path of requiredGlobalHooks) {
		add(
			issues,
			hookStatus(globalHooks, path) === "installed",
			`runtime required global hook was not installed: ${path}`,
		);
	}
	for (const [path] of HOST_HOOKS) {
		add(
			issues,
			hookStatus(hostHooks, path) === "installed",
			`runtime required Host hook was not installed: ${path}`,
		);
	}
	for (const path of REACT_HOOK_PATHS) {
		add(
			issues,
			hookStatus(reactHooks, path) ===
				(expected.host === "vite" ? "installed" : "absent"),
			`runtime React hook status is invalid for ${path}`,
		);
	}

	for (const field of GLOBAL_FIELDS) {
		add(
			issues,
			Number.isInteger(probe.globalCalls?.[field]) &&
				probe.globalCalls[field] >= 0,
			`runtime probe global observation is incomplete for ${field}`,
		);
		if (mode === "clean") {
			add(
				issues,
				probe.globalCalls?.[field] === 0,
				`runtime probe globalCalls.${field} must be zero in clean mode`,
			);
		}
	}
	add(
		issues,
		probe.globalCalls?.audioContexts ===
			(probe.globalCalls?.audioContextConstructions ?? Number.NaN) +
				(probe.globalCalls?.webkitAudioContextConstructions ?? Number.NaN),
		"runtime probe audio aggregate is not derived from constructor hooks",
	);
	add(
		issues,
		probe.globalCalls?.wasmInstantiations ===
			(probe.globalCalls?.wasmInstantiateCalls ?? Number.NaN) +
				(probe.globalCalls?.wasmInstantiateStreamingCalls ?? Number.NaN),
		"runtime probe WASM aggregate is not derived from instantiate hooks",
	);
	if (mode === "sensitivity") {
		for (const [path, field] of GLOBAL_HOOKS) {
			const status = hookStatus(globalHooks, path);
			add(
				issues,
				status === "installed"
					? probe.globalCalls?.[field] > 0
					: status === "absent" && probe.globalCalls?.[field] === 0,
				`runtime sensitivity did not exercise installed global hook ${path}`,
			);
		}
	}

	for (const field of HOST_FIELDS) {
		add(
			issues,
			Number.isInteger(probe.hostCalls?.[field]) && probe.hostCalls[field] >= 0,
			`runtime probe Host observation is incomplete for ${field}`,
		);
		add(
			issues,
			mode === "clean"
				? probe.hostCalls?.[field] === 0
				: probe.hostCalls?.[field] > 0,
			`runtime probe hostCalls.${field} has the wrong ${mode} sensitivity`,
		);
	}
	for (const field of ["workers", "audioContexts", "objectUrls"]) {
		add(
			issues,
			Number.isInteger(probe.hostResourceState?.[field]) &&
				probe.hostResourceState[field] === probe.hostCalls?.[field],
			`runtime probe Host resource state is inconsistent for ${field}`,
		);
	}

	const react = probe.react;
	add(
		issues,
		react?.strategy ===
			(expected.host === "vite"
				? "mutation-observer+react-container-markers"
				: "server-no-dom") &&
			react?.domAvailable === (expected.host === "vite"),
		"runtime React mount probe strategy is not attributable to the Host",
	);
	for (const field of REACT_FIELDS) {
		add(
			issues,
			Number.isInteger(react?.[field]) && react[field] >= 0,
			`runtime React observation is incomplete for ${field}`,
		);
	}
	add(
		issues,
		result.reactMountAttempts === react?.mountAttempts,
		"runtime React mount summary is inconsistent",
	);
	add(
		issues,
		react?.mountAttempts ===
			(react?.mutationRecords ?? Number.NaN) +
				Math.max(
					0,
					(react?.rootMarkersAfter ?? Number.NaN) -
						(react?.rootMarkersBefore ?? Number.NaN),
				),
		"runtime React mount aggregate is not derived from probe observations",
	);
	if (mode === "clean" || expected.host !== "vite") {
		for (const field of REACT_FIELDS) {
			add(
				issues,
				react?.[field] === 0,
				`runtime react.${field} must be zero for ${mode}/${expected.host}`,
			);
		}
	} else {
		add(
			issues,
			react?.mutationRecords > 0 &&
				react?.rootMarkersAfter > react?.rootMarkersBefore &&
				react?.mountAttempts > 0,
			"runtime browser React sensitivity control did not mount and mutate a real root",
		);
	}

	const compositorGpu = probe.compositorGpu;
	add(
		issues,
		probe.hookProvenance?.compositorGpu?.strategy ===
			"derived-host-webgpu-wasm/v1",
		"runtime compositor/GPU provenance strategy is invalid",
	);
	add(
		issues,
		Array.isArray(probe.hookProvenance?.compositorGpu?.fields) &&
			probe.hookProvenance.compositorGpu.fields.length ===
				COMPOSITOR_FIELDS.length &&
			probe.hookProvenance.compositorGpu.fields.every(
				(field, index) => field === COMPOSITOR_FIELDS[index],
			),
		"runtime compositor/GPU provenance field order is invalid",
	);
	add(
		issues,
		compositorGpu?.strategy === "host-graphics+webgpu+wasm-construction" &&
			compositorGpu?.hostGraphicsQueries === probe.hostCalls?.graphicsQueries &&
			compositorGpu?.webGpuAdapterRequests ===
				probe.globalCalls?.webGpuAdapterRequests &&
			compositorGpu?.wasmInstantiations ===
				probe.globalCalls?.wasmInstantiations &&
			compositorGpu?.ownershipAttempts ===
				(probe.hostCalls?.graphicsQueries ?? Number.NaN) +
					(probe.globalCalls?.webGpuAdapterRequests ?? Number.NaN) +
					(probe.globalCalls?.wasmInstantiations ?? Number.NaN),
		"runtime compositor/GPU ownership probe is inconsistent",
	);
	for (const field of COMPOSITOR_FIELDS) {
		add(
			issues,
			Number.isInteger(compositorGpu?.[field]) && compositorGpu[field] >= 0,
			`runtime compositor/GPU observation is incomplete for ${field}`,
		);
		if (mode === "clean") {
			add(
				issues,
				compositorGpu?.[field] === 0,
				`runtime compositorGpu.${field} must be zero in clean mode`,
			);
		}
	}
	if (mode === "sensitivity") {
		add(
			issues,
			compositorGpu?.hostGraphicsQueries > 0 &&
				compositorGpu?.wasmInstantiations > 0 &&
				compositorGpu?.ownershipAttempts > 0,
			"runtime compositor/WASM sensitivity control did not acquire ownership",
		);
		add(
			issues,
			hookStatus(globalHooks, "navigator.gpu.requestAdapter") === "installed"
				? compositorGpu?.webGpuAdapterRequests > 0
				: compositorGpu?.webGpuAdapterRequests === 0,
			"runtime GPU sensitivity does not match hook availability",
		);
	}

	const counts = result.runtimeResourceCounts;
	add(
		issues,
		counts?.timers ===
			(probe.globalCalls?.timeouts ?? Number.NaN) +
				(probe.globalCalls?.intervals ?? Number.NaN) &&
			counts?.animationFrames === probe.globalCalls?.animationFrames &&
			counts?.workers ===
				(probe.globalCalls?.workers ?? Number.NaN) +
					(probe.hostCalls?.workers ?? Number.NaN) &&
			counts?.audioContexts ===
				(probe.globalCalls?.audioContexts ?? Number.NaN) +
					(probe.hostCalls?.audioContexts ?? Number.NaN) &&
			counts?.objectUrls ===
				(probe.globalCalls?.objectUrls ?? Number.NaN) +
					(probe.hostCalls?.objectUrls ?? Number.NaN) &&
			counts?.compositorGpuOwners === compositorGpu?.ownershipAttempts,
		"runtime resource summary is not derived from probe observations",
	);
}

function validateSemanticResult(result, expected, mode) {
	const issues = [];
	add(issues, result && typeof result === "object", "result must be an object");
	if (!result || typeof result !== "object") {
		throw new Error(
			`C7 headless semantic result rejected: ${issues.join("; ")}`,
		);
	}

	add(issues, result.schemaVersion === 1, "schemaVersion must be 1");
	add(issues, result.host === expected.host, "Host identity does not match");
	add(
		issues,
		result.buildMarker === expected.buildMarker,
		"build marker does not match",
	);
	add(
		issues,
		result.acceptedHead === expected.acceptedHead,
		"accepted HEAD does not match",
	);
	add(
		issues,
		result.acceptedTree === expected.acceptedTree,
		"accepted tree does not match",
	);
	add(issues, result.entry === expected.entry, "exact entry does not match");
	add(
		issues,
		result.storeIdentity === "InMemoryProjectStore",
		"headless run must use the explicit in-memory store",
	);
	add(issues, text(result.storeRunIdentity), "store run identity is absent");
	add(issues, text(result.projectId), "project identity is absent");
	add(issues, text(result.firstOwnerId), "first owner identity is absent");
	add(issues, text(result.secondOwnerId), "second owner identity is absent");
	add(
		issues,
		result.ownersDistinct === true &&
			result.firstOwnerId !== result.secondOwnerId,
		"a distinct second owner is required",
	);

	add(
		issues,
		text(result.seededName) &&
			text(result.editedName) &&
			result.seededName !== result.editedName,
		"an actual edit with distinct seeded and edited values is required",
	);
	add(
		issues,
		result.reopenedName === result.editedName,
		"reopened name does not contain the edit",
	);
	add(
		issues,
		text(result.seededUpdatedAt) &&
			text(result.editedUpdatedAt) &&
			result.seededUpdatedAt !== result.editedUpdatedAt &&
			result.reopenedUpdatedAt === result.editedUpdatedAt,
		"updated timestamp does not prove edit and reopen",
	);

	const digestFields = [
		"seededProjectDigest",
		"firstLoadDigest",
		"savedProjectDigest",
		"reopenedProjectDigest",
		"reopenedLoadDigest",
		"seededOpaqueDigest",
		"reopenedOpaqueDigest",
		"seededAttachmentDigest",
		"reopenedAttachmentDigest",
		"seededAttachmentMetadataDigest",
		"reopenedAttachmentMetadataDigest",
	];
	for (const field of digestFields) {
		add(issues, DIGEST.test(result[field]), `${field} is not a SHA-256 digest`);
	}
	add(
		issues,
		result.seededProjectDigest !== result.savedProjectDigest &&
			result.savedProjectDigest === result.reopenedProjectDigest &&
			result.firstLoadDigest !== result.reopenedLoadDigest,
		"project digests do not prove an actual durable edit and reopen",
	);
	add(
		issues,
		result.opaquePreserved === true &&
			result.seededOpaqueDigest === result.reopenedOpaqueDigest,
		"opaque provider data was not preserved",
	);
	add(issues, text(result.attachmentKey), "attachment key is absent");
	add(
		issues,
		Number.isInteger(result.attachmentSchemaVersion),
		"attachment schema version is absent",
	);
	add(
		issues,
		result.attachmentPreserved === true &&
			result.seededAttachmentDigest === result.reopenedAttachmentDigest &&
			result.seededAttachmentMetadataDigest ===
				result.reopenedAttachmentMetadataDigest,
		"attachment body or opaque metadata changed",
	);
	add(
		issues,
		result.durableProjectPresent === true &&
			result.durableAttachmentPresent === true,
		"durable project or attachment is absent after disposal",
	);
	add(
		issues,
		result.firstDisposal === "fulfilled" &&
			result.secondDisposal === "fulfilled",
		"headless disposal did not complete",
	);
	add(
		issues,
		result.postDisposeWriteRejected === true &&
			result.postDisposeStoreUntouched === true,
		"post-dispose write was not rejected without store mutation",
	);
	validateRuntimeProbe(result, expected, issues, mode);
	add(
		issues,
		result.navigationAttempts === 0,
		"headless run attempted UI navigation",
	);
	add(
		issues,
		mode !== "clean" ||
			(result.runtimeResourceCounts?.timers === 0 &&
				result.runtimeResourceCounts?.animationFrames === 0 &&
				result.runtimeResourceCounts?.workers === 0 &&
				result.runtimeResourceCounts?.audioContexts === 0 &&
				result.runtimeResourceCounts?.objectUrls === 0 &&
				result.runtimeResourceCounts?.compositorGpuOwners === 0),
		"headless clean run acquired a C6 runtime resource",
	);
	add(
		issues,
		Array.isArray(result.errors) && result.errors.length === 0,
		"headless run contains unhandled errors",
	);

	if (issues.length > 0) {
		throw new Error(
			`C7 headless semantic result rejected: ${issues.join("; ")}`,
		);
	}
	return { host: result.host, projectId: result.projectId };
}

export function validateHeadlessSemanticResult(result, expected) {
	return validateSemanticResult(result, expected, "clean");
}

export function validateHeadlessRuntimeSensitivityResult(result, expected) {
	return validateSemanticResult(result, expected, "sensitivity");
}

export function validateIndependentHeadlessResults({ vite, next }) {
	validateHeadlessSemanticResult(vite, {
		host: "vite",
		buildMarker: vite.buildMarker,
		acceptedHead: vite.acceptedHead,
		acceptedTree: vite.acceptedTree,
		entry: vite.entry,
	});
	validateHeadlessSemanticResult(next, {
		host: "next",
		buildMarker: next.buildMarker,
		acceptedHead: next.acceptedHead,
		acceptedTree: next.acceptedTree,
		entry: next.entry,
	});

	const issues = [];
	add(
		issues,
		vite.buildMarker !== next.buildMarker &&
			vite.entry !== next.entry &&
			vite.storeRunIdentity !== next.storeRunIdentity,
		"Vite and Next results are copied rather than independently attributed",
	);
	add(
		issues,
		vite.acceptedHead === next.acceptedHead &&
			vite.acceptedTree === next.acceptedTree,
		"Vite and Next results do not target the same accepted base",
	);
	for (const field of [
		"projectId",
		"seededName",
		"editedName",
		"reopenedName",
		"seededProjectDigest",
		"savedProjectDigest",
		"reopenedProjectDigest",
		"seededOpaqueDigest",
		"reopenedOpaqueDigest",
		"seededAttachmentDigest",
		"reopenedAttachmentDigest",
	]) {
		add(
			issues,
			vite[field] === next[field],
			`cross-Host semantic field differs: ${field}`,
		);
	}
	if (issues.length > 0) {
		throw new Error(
			`C7 independent Host results rejected: ${issues.join("; ")}`,
		);
	}
	return { projectId: vite.projectId, editedName: vite.editedName };
}

function validateHostReport(report, host) {
	const issues = [];
	add(issues, report?.schemaVersion === 1, `${host} report schema is invalid`);
	add(issues, report?.host === host, `${host} report Host is invalid`);
	add(issues, report?.status === "passed", `${host} report did not pass`);
	add(
		issues,
		Array.isArray(report?.errors) && report.errors.length === 0,
		`${host} report contains errors`,
	);
	add(issues, text(report?.output), `${host} output identity is absent`);
	add(issues, text(report?.base), `${host} public base is absent`);
	add(issues, text(report?.graph?.path), `${host} graph path is absent`);
	add(
		issues,
		DIGEST.test(report?.graph?.sha256),
		`${host} graph digest is invalid`,
	);
	add(issues, text(report?.graph?.buildId), `${host} graph build ID is absent`);
	add(
		issues,
		Number.isInteger(report?.graph?.moduleCount) &&
			report.graph.moduleCount > 0,
		`${host} graph module count is invalid`,
	);
	add(
		issues,
		Number.isInteger(report?.processes?.server?.pid) &&
			report.processes.server.pid > 0 &&
			Number.isInteger(report?.processes?.server?.port) &&
			report.processes.server.port > 0,
		`${host} server ownership is absent`,
	);
	if (host === "vite") {
		add(
			issues,
			Number.isInteger(report?.processes?.browser?.pid) &&
				report.processes.browser.pid > 0 &&
				Number.isInteger(report?.processes?.browser?.port) &&
				report.processes.browser.port > 0,
			"Vite browser ownership is absent",
		);
	}
	add(
		issues,
		report?.cleanup?.server?.stopped === true &&
			report?.cleanup?.browser?.stopped === true &&
			report?.cleanup?.serverPortReleased === true &&
			report?.cleanup?.browserPortReleased === true &&
			report?.cleanup?.browserProfileRemoved === true,
		`${host} owned cleanup is incomplete`,
	);
	const semantic = report?.runtime?.semantic;
	add(
		issues,
		report?.runtime?.proofControl === "neutral",
		`${host} clean proof control is not neutral`,
	);
	if (semantic) {
		validateHeadlessSemanticResult(semantic, {
			host,
			buildMarker: report.marker,
			acceptedHead: report.acceptedBase?.head,
			acceptedTree: report.acceptedBase?.tree,
			entry: report.entry,
		});
	} else {
		issues.push(`${host} semantic result is absent`);
	}
	if (issues.length > 0) {
		throw new Error(`C7 ${host} Host report rejected: ${issues.join("; ")}`);
	}
	return semantic;
}

export function validateIndependentHeadlessHostReports({ vite, next }) {
	const viteResult = validateHostReport(vite, "vite");
	const nextResult = validateHostReport(next, "next");
	const semantic = validateIndependentHeadlessResults({
		vite: viteResult,
		next: nextResult,
	});
	const issues = [];
	add(issues, vite.marker !== next.marker, "Host markers are not independent");
	add(
		issues,
		vite.output !== next.output,
		"Host output paths are not independent",
	);
	add(issues, vite.base !== next.base, "Host public bases are not independent");
	add(
		issues,
		vite.graph.path !== next.graph.path &&
			vite.graph.sha256 !== next.graph.sha256 &&
			vite.graph.buildId !== next.graph.buildId,
		"Host graph evidence is copied rather than independent",
	);
	add(
		issues,
		vite.processes.server.pid !== next.processes.server.pid &&
			vite.processes.server.port !== next.processes.server.port,
		"Host server ownership is not independent",
	);
	add(
		issues,
		vite.acceptedBase.head === next.acceptedBase.head &&
			vite.acceptedBase.tree === next.acceptedBase.tree,
		"Host reports do not target the same accepted base",
	);
	if (issues.length > 0) {
		throw new Error(
			`C7 independent Host reports rejected: ${issues.join("; ")}`,
		);
	}
	return {
		...semantic,
		viteGraph: vite.graph.sha256,
		nextGraph: next.graph.sha256,
	};
}

function parseArguments(values) {
	const parsed = {};
	for (let index = 0; index < values.length; index += 2) {
		parsed[values[index]?.replace(/^--/, "")] = values[index + 1];
	}
	return parsed;
}

if (
	process.argv[1] &&
	basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))
) {
	const args = parseArguments(process.argv.slice(2));
	if (!args.vite || !args.next) {
		console.error(
			"usage: node script/check-headless-semantic-result.mjs --vite <Vite report JSON> --next <Next report JSON>",
		);
		process.exit(2);
	}
	try {
		const vite = JSON.parse(readFileSync(resolve(args.vite), "utf8"));
		const next = JSON.parse(readFileSync(resolve(args.next), "utf8"));
		console.log(
			JSON.stringify(
				validateIndependentHeadlessHostReports({ vite, next }),
				null,
				2,
			),
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
