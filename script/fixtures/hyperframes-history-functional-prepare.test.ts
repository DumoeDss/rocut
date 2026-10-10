import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { functionalHistoryHtml } from "./hyperframes-history-functional-project";

test("functional author fixture retains original timeline, fallback and fractional source loop", () => {
	const template=readFileSync(new URL("./hyperframes-native-gain-history.html",import.meta.url),"utf8");
	const html=functionalHistoryHtml(template);
	expect(html).toContain(".to(authored,{level:0.75");
	expect(html).toContain('id="fractional-loop"');
	expect(html).toContain('data-media-start="0.0123"');
	expect(html).toContain('data-duration="0.4000052083333333"');
	expect(html).toContain('data-media-start="0.010005208333333334"');
	expect(html).toContain('id="scalar-fractional" src="scalar.wav"');
	expect(html).toContain("await originalFrame(frame)");
	expect(html).toContain("window.__player.renderSeek(frame.time");
	expect(html).not.toContain("collectAppliedAuthorGain");
	expect(html).not.toContain("beginNativeHistory");
});
