import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
	new URL("./draggable-item.tsx", import.meta.url),
	"utf8",
);

test("all card, compact and drag-overlay add labels preserve the asset name in Chinese", () => {
	expect(source.match(/label=\{`将 \$\{name\} 添加到时间线`\}/g)).toHaveLength(
		3,
	);
	expect(source).toContain('tooltipText="添加到时间线或拖动到指定位置"');
	expect(source).not.toContain("Add to timeline");
	expect(source).not.toContain("Add ${name}");
	expect(source).toContain("aria-label={label}");
	expect(source).toContain("title={tooltipText}");
});
