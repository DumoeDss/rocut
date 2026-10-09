export const AUDIO_PHASE_PREFIX = "__ROCUT_MULTISHOT_AUDIO_PHASE__";
export const AUDIO_PHASES = new Set([
	"outer-start",
	"iframe-attached",
	"dom-ready",
	"resources-before",
	"resources-after",
	"author-ready-before",
	"author-ready-after",
	"fonts-before",
	"fonts-after",
	"render-before",
	"render-after",
	"metadata-before",
	"metadata-after",
	"snapshot-post-before",
	"snapshot-post-after",
	"bootstrap-error",
	"outer-success-message",
	"outer-raf-one",
	"outer-raf-two",
	"outer-resolved",
]);

function once(body, needle, replacement) {
	if (body.split(needle).length !== 2)
		throw Error(
			"Audio diagnostic expression shape changed; refusing unverified instrumentation",
		);
	return body.replace(needle, () => replacement);
}

/** Observe only the fixed generated bootstrap. Authored HTML stays byte-identical.
 * All original awaits, native snapshot, promise settlement and RAF callbacks remain.
 */
export function instrumentAudioExpression(expression) {
	const prefix = "\n    iframe.srcdoc = ";
	const suffix = ";\n    document.body.appendChild(iframe);";
	if (
		expression.split(prefix).length !== 2 ||
		expression.split(suffix).length !== 2
	)
		throw Error("Audio diagnostic srcdoc boundary changed");
	const start = expression.indexOf(prefix) + prefix.length;
	const end = expression.indexOf(suffix, start);
	const document = JSON.parse(expression.slice(start, end));
	const scriptStart = document.indexOf("<script>") + "<script>".length;
	const scriptEnd = document.indexOf("</script>", scriptStart);
	if (scriptStart < 8 || scriptEnd < scriptStart)
		throw Error("Audio diagnostic bootstrap boundary changed");
	let bootstrap = document.slice(scriptStart, scriptEnd);
	const mark = (phase) => `__multishotAudioPhase(${JSON.stringify(phase)});`;
	bootstrap = once(
		bootstrap,
		"addEventListener('DOMContentLoaded', async () => {\n  try {",
		`addEventListener('DOMContentLoaded', async () => {\n  try { ${mark("dom-ready")}`,
	);
	for (const [statement, before, after] of [
		["await resourcesReady;", "resources-before", "resources-after"],
		[
			"if (typeof author?.renderFrame === 'function') await author.renderFrame({ ...frame, random });",
			"render-before",
			"render-after",
		],
		[
			"parent.postMessage({ tag: 'rocut-html-frame', ok: true, assets: nativeAudioBridge.snapshot() }, '*');",
			"snapshot-post-before",
			"snapshot-post-after",
		],
	])
		bootstrap = once(
			bootstrap,
			statement,
			`${mark(before)}${statement}${mark(after)}`,
		);
	bootstrap = once(
		bootstrap,
		"await author?.ready;\n    void document.body?.offsetHeight;\n    await document.fonts.ready;",
		`${mark("author-ready-before")}await author?.ready;${mark("author-ready-after")}\n    void document.body?.offsetHeight;\n    ${mark("fonts-before")}await document.fonts.ready;${mark("fonts-after")}`,
	);
	bootstrap = once(
		bootstrap,
		"    this.checkMedia();\n    const deadline = performance.now() + 8000;",
		`    this.checkMedia();\n    ${mark("metadata-before")}const deadline = performance.now() + 8000;`,
	);
	bootstrap = once(
		bootstrap,
		"    }));\n  },\n  begin(frame) {",
		`    }));${mark("metadata-after")}\n  },\n  begin(frame) {`,
	);
	bootstrap = once(
		bootstrap,
		"    parent.postMessage({ tag: 'rocut-html-frame', error: String(error).slice(0, 1000) }, '*');",
		`    ${mark("bootstrap-error")}parent.postMessage({ tag: 'rocut-html-frame', error: String(error).slice(0, 1000) }, '*');`,
	);
	bootstrap =
		`const __multishotAudioPhase = phase => parent.postMessage({tag:'rocut-multishot-audio-phase',phase,clock:performance.now()}, '*');\n` +
		bootstrap;
	const observedDocument =
		document.slice(0, scriptStart) + bootstrap + document.slice(scriptEnd);
	const placeholder = "__MULTISHOT_SRCDOC_PLACEHOLDER__";
	if (expression.includes(placeholder))
		throw Error("Audio diagnostic placeholder collision");
	let observed =
		expression.slice(0, start) + placeholder + expression.slice(end);
	observed = once(
		observed,
		"new Promise((resolve, reject) => {",
		`new Promise((resolve, reject) => {\n const __multishotAudioOuterPhase = (phase,clock=performance.now()) => console.debug(${JSON.stringify(AUDIO_PHASE_PREFIX)}+JSON.stringify({phase,clock}));\n __multishotAudioOuterPhase('outer-start');`,
	);
	observed = once(
		observed,
		"      if (event.source !== iframe.contentWindow) return;",
		"      if (event.source !== iframe.contentWindow) return;\n      if (event.data?.tag === 'rocut-multishot-audio-phase') __multishotAudioOuterPhase(event.data.phase,event.data.clock);",
	);
	const legacy =
		"      if (event.data.ok) requestAnimationFrame(() => requestAnimationFrame(() => resolve(event.data.assets)));";
	const immediate = "      if (event.data.ok) resolve(event.data.assets);";
	const legacyCount = observed.split(legacy).length - 1;
	const immediateCount = observed.split(immediate).length - 1;
	if (legacyCount + immediateCount !== 1)
		throw Error("Audio diagnostic success settlement shape changed");
	observed =
		legacyCount === 1
			? once(
					observed,
					legacy,
					"      if (event.data.ok) { __multishotAudioOuterPhase('outer-success-message'); requestAnimationFrame(() => { __multishotAudioOuterPhase('outer-raf-one'); requestAnimationFrame(() => { __multishotAudioOuterPhase('outer-raf-two'); resolve(event.data.assets); }); }); }",
				)
			: once(
					observed,
					immediate,
					"      if (event.data.ok) { __multishotAudioOuterPhase('outer-success-message'); resolve(event.data.assets); __multishotAudioOuterPhase('outer-resolved'); }",
				);
	observed = once(
		observed,
		"    document.body.appendChild(iframe);",
		"    document.body.appendChild(iframe); __multishotAudioOuterPhase('iframe-attached');",
	);
	return once(observed, placeholder, JSON.stringify(observedDocument));
}
