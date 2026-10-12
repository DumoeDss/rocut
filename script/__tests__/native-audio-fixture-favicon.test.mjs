import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(
	new URL("../fixtures/native-audio-editor-browser.html", import.meta.url),
	"utf8",
);
const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1];

test("editor fixture declares one self-contained, well-formed SVG favicon in its head", () => {
	const icons = [...head.matchAll(/<link\b[^>]*\brel="icon"[^>]*>/g)];
	assert.equal(icons.length, 1);
	assert.match(icons[0][0], /\btype="image\/svg\+xml"/);
	assert.match(icons[0][0], /\bsizes="any"/);
	const href = icons[0][0].match(/\bhref="([^"]+)"/)?.[1];
	assert.equal(new URL(href).protocol, "data:");
	assert.ok(href.startsWith("data:image/svg+xml,"));
	const svg = decodeURIComponent(href.slice("data:image/svg+xml,".length));
	assert.equal(
		svg,
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#334155"/></svg>',
	);
	assert.ok(
		!/<(?:script|image|foreignObject)\b|\bon\w+=|\bhref=|url\(/i.test(svg),
	);
});

test("removing only the icon gives the exact original entrypoint, preserving its script and title", () => {
	assert.equal(
		html.replace(/<link\b[^>]*\brel="icon"[^>]*>/, ""),
		'<!doctype html><html><head><meta charset="utf-8"><title>Isolated native audio editor probe</title></head><body><script type="module" src="./native-audio-editor-browser.ts"></script></body></html>\n',
	);
});

test("existing console/page/HTTP observation and result-error acceptance gates remain strict", async () => {
	const probe = await readFile(
		new URL("../probe-remotion-audio.mjs", import.meta.url),
		"utf8",
	);
	assert.ok(probe.includes("errors.push(message.text().slice(0, 1000))"));
	assert.ok(
		probe.includes('page.on("pageerror", error => errors.push(error.message))'),
	);
	assert.ok(
		probe.includes(
			"if (response.status() >= 400) httpFailures.push(nativeAudioHttpObservation(response))",
		),
	);
	assert.ok(probe.includes("if (result.error || errors.length) throw Error"));
	assert.ok(
		!/message\.text\(\).*favicon|(?:includes|endsWith)\(["']\/favicon\.ico/.test(
			probe,
		),
	);
});
