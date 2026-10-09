import assert from "node:assert/strict";

export async function checkRecipeEditor({ page, artifact }) {
	const checks = [],
		sources = [];
	const recipe = page.getByLabel("Recipe JSON (advanced)", { exact: true });
	const apply = page.getByRole("button", { name: "Apply recipe", exact: true }),
		discard = page.getByRole("button", {
			name: "Discard recipe draft",
			exact: true,
		});
	const pixel = async (value) => {
		await page
			.getByTestId("pixel")
			.filter({ hasText: value })
			.waitFor({ timeout: 30000 });
		assert.deepEqual(
			await page
				.getByTestId("preview")
				.evaluate((canvas) => [
					...canvas.getContext("2d").getImageData(0, 0, 1, 1).data,
				]),
			value.split(",").map(Number),
		);
	};
	const source = async () =>
		JSON.parse(await page.getByTestId("committed-source").textContent());
	const record = () =>
		page.evaluate(() => globalThis.__recipeEditorProbe.record());
	await pixel("255,0,0,255");
	const original = await source(),
		red = JSON.parse(await recipe.inputValue()),
		green = structuredClone(red);
	green.nodes[0].scene.color = [0, 1, 0, 1];
	await recipe.fill(JSON.stringify(green));
	assert.deepEqual(await source(), original);
	checks.push("Draft does not publish before Apply");
	await apply.click();
	await pixel("0,255,0,255");
	assert.deepEqual(await source(), { ...original, recipe: green });
	sources.push(await source());
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await pixel("255,0,0,255");
	assert.deepEqual(await source(), original);
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await pixel("0,255,0,255");
	checks.push("Native recipe Apply/Undo/Redo changes actual canvas red/green");
	for (const text of [
		"{broken",
		JSON.stringify({ ...green, root: "missing" }),
	]) {
		const before = await source(),
			persisted = await record();
		await recipe.fill(text);
		await apply.click();
		await page
			.getByRole("alert")
			.filter({
				hasText:
					text === "{broken"
						? "Recipe JSON is invalid"
						: "editing.programmatic",
			})
			.waitFor();
		assert.equal(await recipe.inputValue(), text);
		assert.deepEqual(await source(), before);
		assert.deepEqual(await record(), persisted);
		await discard.click();
		await pixel("0,255,0,255");
	}
	checks.push(
		"Invalid JSON and Rust recipe rejection retain draft and leave persisted project unchanged",
	);
	await recipe.fill("draft retained A");
	await page.getByRole("button", { name: "Select clip B" }).click();
	await pixel("0,0,255,255");
	assert.deepEqual(
		JSON.parse(await recipe.inputValue()).nodes[0].scene.color,
		[0, 0, 1, 1],
	);
	await page.getByRole("button", { name: "Select clip A" }).click();
	await pixel("0,255,0,255");
	assert.equal(await recipe.inputValue(), "draft retained A");
	checks.push("Selection switch retains clip-scoped recipe draft");
	await page.getByRole("button", { name: "External recipe update" }).click();
	await pixel("255,255,0,255");
	assert.equal(await recipe.inputValue(), "draft retained A");
	assert.equal(await apply.isDisabled(), true);
	await discard.click();
	assert.deepEqual(
		JSON.parse(await recipe.inputValue()).nodes[0].scene.color,
		[1, 1, 0, 1],
	);
	checks.push(
		"External update conflicts explicitly; Discard loads current recipe",
	);
	for (const external of [
		"External inline update",
		"External compiled update",
	]) {
		await recipe.fill("recoverable old recipe");
		await page.getByRole("button", { name: external, exact: true }).click();
		const recovered = page.getByLabel("Previous recipe draft (read-only)", {
			exact: true,
		});
		await recovered.waitFor();
		assert.equal(await recovered.inputValue(), "recoverable old recipe");
		assert.equal(await recovered.isDisabled(), false);
		assert.equal(await recovered.getAttribute("readonly"), "");
		assert.equal(await apply.isDisabled(), true);
		await recovered.focus();
		await page.keyboard.press("Control+A");
		assert.equal(
			await recovered.evaluate((element) =>
				element.value.slice(element.selectionStart, element.selectionEnd),
			),
			"recoverable old recipe",
		);
		await discard.click();
		assert.equal(await recovered.count(), 0);
		await page.getByRole("button", { name: "Undo", exact: true }).click();
		await pixel("255,255,0,255");
	}
	checks.push(
		"Inline/compiled replacement keeps old recipe copyable and blocks Apply; undo restores recipe preview",
	);
	sources.push(await source());
	await page.screenshot({
		path: `${artifact}/recipe-panel.png`,
		fullPage: true,
	});
	assert.equal(await page.getByTestId("preview-error").count(), 0);
	return { checks, sources, persisted: await record() };
}
