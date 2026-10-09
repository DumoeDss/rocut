import { strict as assert } from "node:assert";

/** Delay only the reply of a successful real compiler call, not the compiler itself. */
export async function checkLateCompilerReply(page, { conflict = false } = {}) {
	let release, arrived;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const ready = new Promise((resolve) => {
		arrived = resolve;
	});
	let routeFailure;
	const pattern = "**/api/programmatic/build/revise";
	const handler = async (route) => {
		try {
			const response = await route.fetch();
			assert.equal(response.status(), 200);
			arrived();
			await gate;
			await route.fulfill({ response }).catch(() => {}); // Fetch may already be aborted by UI Cancel.
		} catch (error) {
			routeFailure = error;
			arrived();
		}
	};
	await page.route(pattern, handler);
	try {
		const source = await page.getByTestId("committed-source").textContent();
		const code = page.getByLabel("Author code", { exact: true });
		const draft = `${await code.inputValue()}\n// delayed real compiler reply ${conflict}`;
		await code.fill(draft);
		await page
			.getByRole("button", { name: "Recompile and apply", exact: true })
			.click();
		let timer;
		try {
			await Promise.race([
				ready,
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(Error("Real compiler reply did not arrive")),
						60000,
					);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
		if (routeFailure) throw routeFailure;
		if (conflict)
			await page
				.getByRole("button", { name: "External source change", exact: true })
				.click();
		else
			await page.getByRole("button", { name: "Cancel", exact: true }).click();
		release();
		await page.unrouteAll({ behavior: "wait" });
		if (conflict)
			await page
				.getByRole("alert")
				.filter({ hasText: "source changed during compilation" })
				.waitFor();
		else
			await page
				.getByRole("status")
				.filter({ hasText: "Unapplied author draft" })
				.waitFor();
		const after = JSON.parse(
			await page.getByTestId("committed-source").textContent(),
		);
		const before = JSON.parse(source);
		if (conflict) before.seed += 1;
		assert.deepEqual(after, before);
		assert.equal(await code.inputValue(), draft);
		await page.getByRole("button", { name: "Discard", exact: true }).click();
	} finally {
		release();
		await page.unroute(pattern, handler);
	}
	return conflict
		? "Late real compiler result cannot overwrite external update"
		: "Cancel prevents late real compiler result from committing; draft retained";
}
