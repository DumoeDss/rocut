import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverOutput, prepareOutputDestination } from "../output-delivery";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true });
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "rocut-output-delivery-"));
	roots.push(root);
	const source = join(root, "encoded.mp4");
	await writeFile(source, "retained encoded bytes");
	return { root, source };
}

test("prepares missing export parents before rendering and delivers the retained output", async () => {
	const { root, source } = await fixture();
	const destination = await prepareOutputDestination(
		join(root, "exports", "v1", "mv.mp4"),
	);
	await deliverOutput(source, destination);
	expect(await readFile(destination!, "utf8")).toBe("retained encoded bytes");
	expect(await readFile(source, "utf8")).toBe("retained encoded bytes");
});

test("rejects invalid destinations before rendering and handles a self-copy", async () => {
	const { root, source } = await fixture();
	await expect(prepareOutputDestination(root)).rejects.toThrow(
		"not a regular file",
	);
	await expect(prepareOutputDestination(" ")).rejects.toThrow("empty");
	await expect(
		prepareOutputDestination(join(source, "mv.mp4")),
	).rejects.toThrow();
	await deliverOutput(source, await prepareOutputDestination(source));
	expect(await readFile(source, "utf8")).toBe("retained encoded bytes");
});

test("delivery failure preserves the already rendered source and explains copy recovery", async () => {
	const { root, source } = await fixture();
	await expect(
		deliverOutput(source, join(root, "missing", "mv.mp4")),
	).rejects.toThrow("without rendering again");
	expect(await readFile(source, "utf8")).toBe("retained encoded bytes");
});
