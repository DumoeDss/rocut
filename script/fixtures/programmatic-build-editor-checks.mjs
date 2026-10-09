import { strict as assert } from "node:assert";
import { join } from "node:path";
export { checkLateCompilerReply } from "./programmatic-build-editor-races.mjs";

export async function checkAuthorEditor({ page, artifact }) {
	const checks = [];
	const code = page.getByLabel("Author code", { exact: true });
	const apply = page.getByRole("button", {
		name: "Recompile and apply",
		exact: true,
	});
	const discard = page.getByRole("button", { name: "Discard", exact: true });
	const committed = () => page.getByTestId("committed-source").textContent();
	const pixel = async (value) => {
		await page.waitForFunction(
			(expected) => {
				const error = document.querySelector('[data-testid="render-error"]');
				if (error?.textContent) throw Error(error.textContent);
				return (
					document.querySelector('[data-testid="pixel"]')?.textContent ===
					expected
				);
			},
			value,
			{ timeout: 60000 },
		);
	};
	const loaded = async (text) =>
		page.waitForFunction(
			(expected) => {
				const label = [...document.querySelectorAll("label")].find(
					(node) => node.textContent === "Author code",
				);
				return (
					label &&
					document.getElementById(label.htmlFor)?.value.includes(expected)
				);
			},
			text,
			{ timeout: 15000 },
		);
	const clean = () =>
		page
			.getByRole("status")
			.filter({ hasText: "Author source is up to date" })
			.waitFor();
	await pixel("255,0,0,255");
	await loaded("#ff0000");
	assert.equal(
		await page.getByLabel("Author file", { exact: true }).inputValue(),
		"index.html",
	);
	assert.equal(await page.getByLabel("Input props (JSON)").count(), 0);
	const original = await code.inputValue();
	const baseline = await committed();
	const green = original.replace("#ff0000", "#00ff00");
	await code.fill(green);
	assert.equal(await committed(), baseline);
	await apply.click();
	await pixel("0,255,0,255");
	await clean();
	await loaded("#00ff00");
	assert.notEqual(await committed(), baseline);
	checks.push(
		"HyperFrames archived author edit -> actual compiler -> changed PNG",
	);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await pixel("255,0,0,255");
	await loaded("#ff0000");
	assert.equal(await committed(), baseline);
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await pixel("0,255,0,255");
	await loaded("#00ff00");
	checks.push(
		"Actual editor history restores original/revised archive and pixels",
	);
	const retained = `${green}\n<!-- retained author draft -->`;
	await code.fill(retained);
	await page.getByLabel("Author file", { exact: true }).selectOption("gsap.js");
	await loaded("GSAP");
	await page
		.getByLabel("Author file", { exact: true })
		.selectOption("index.html");
	await loaded("retained author draft");
	assert.equal(await code.inputValue(), retained);
	await page
		.getByRole("button", { name: "Select Remotion", exact: true })
		.click();
	await pixel("0,0,255,255");
	await loaded("registerRoot");
	await page
		.getByRole("button", { name: "Select HyperFrames", exact: true })
		.click();
	await loaded("retained author draft");
	assert.equal(await code.inputValue(), retained);
	await discard.click();
	await loaded("#00ff00");
	assert.equal(await code.inputValue(), green);
	checks.push(
		"Draft survives file/clip selection; discard reloads archive automatically",
	);
	await page
		.getByRole("button", { name: "Select Remotion", exact: true })
		.click();
	await pixel("0,0,255,255");
	await loaded("registerRoot");
	await page.getByLabel("Input props (JSON)").fill('{"color":"#00ff00"}');
	await apply.click();
	await pixel("0,255,0,255");
	await clean();
	await loaded("registerRoot");
	checks.push(
		"Remotion props-only revision renders through actual archived compiler",
	);
	const validCode = await code.inputValue();
	const validSource = await committed();
	await code.fill("export const =");
	await apply.click();
	await page
		.getByRole("alert")
		.filter({ hasText: /compil|Expected|Unexpected/i })
		.waitFor({ timeout: 60000 });
	assert.equal(await committed(), validSource);
	assert.equal(await code.inputValue(), "export const =");
	await pixel("0,255,0,255");
	await discard.click();
	await loaded("registerRoot");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await pixel("0,0,255,255");
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await pixel("0,255,0,255");
	await loaded("registerRoot");
	checks.push(
		"Real compiler failure retains draft/source/pixels and adds no history entry",
	);
	await code.fill(
		validCode.replace("background: color", 'background: "#ffff00"'),
	);
	await apply.click();
	await pixel("255,255,0,255");
	await clean();
	await loaded("#ffff00");
	checks.push(
		"Remotion TSX revision changes actual PNG independently of props",
	);
	const beforeConflict = await code.inputValue();
	await code.fill(`${beforeConflict}\n// conflict retained`);
	const seed = Number(await page.getByTestId("committed-seed").textContent());
	await page
		.getByRole("button", { name: "External source change", exact: true })
		.click();
	await page
		.getByRole("alert")
		.filter({ hasText: "source changed outside" })
		.waitFor();
	assert.equal(await apply.isDisabled(), true);
	assert.equal(
		await code.inputValue(),
		`${beforeConflict}\n// conflict retained`,
	);
	assert.equal(
		Number(await page.getByTestId("committed-seed").textContent()),
		seed + 1,
	);
	await page.screenshot({
		path: join(artifact, "author-conflict.png"),
		fullPage: true,
	});
	await discard.click();
	await loaded("#ffff00");
	assert.equal(await code.inputValue(), beforeConflict);
	checks.push(
		"External source conflict retains copyable draft and prevents overwrite",
	);
	await page.screenshot({
		path: join(artifact, "author-panel.png"),
		fullPage: true,
	});
	return checks;
}
