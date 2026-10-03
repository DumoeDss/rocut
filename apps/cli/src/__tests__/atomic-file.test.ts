import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeAtomic } from "../atomic-file";

const roots: string[] = [];
async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-atomic-file-"));
	roots.push(root);
	const filePath = path.join(root, "project.json");
	await writeFile(filePath, "old committed contents", "utf8");
	return { root, filePath };
}
afterEach(async () => {
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true });
});

describe("atomic project file replacement", () => {
	for (const code of ["EPERM", "EACCES", "EBUSY"]) {
		test(`retries transient Windows ${code} without removing the previous file`, async () => {
			const { root, filePath } = await fixture();
			const waits: number[] = [];
			let attempts = 0;
			await writeAtomic({
				filePath,
				contents: "new complete contents",
				platform: "win32",
				wait: async (ms) => {
					waits.push(ms);
				},
				renameFile: async (source, destination) => {
					expect(await readFile(filePath, "utf8")).toBe(
						"old committed contents",
					);
					if (++attempts < 3)
						throw Object.assign(new Error("locked"), { code });
					await rename(source, destination);
				},
			});
			expect(attempts).toBe(3);
			expect(waits).toEqual([10, 25]);
			expect(await readFile(filePath, "utf8")).toBe("new complete contents");
			expect(await readdir(root)).toEqual(["project.json"]);
		});
	}

	for (const scenario of [
		{ platform: "win32" as const, code: "EPERM", attempts: 6 },
		{ platform: "win32" as const, code: "ENOSPC", attempts: 1 },
		{ platform: "linux" as const, code: "EPERM", attempts: 1 },
	]) {
		test(`preserves committed data on permanent ${scenario.platform} ${scenario.code}`, async () => {
			const { root, filePath } = await fixture();
			let attempts = 0;
			const failure = Object.assign(new Error("cannot replace"), {
				code: scenario.code,
			});
			await expect(
				writeAtomic({
					filePath,
					contents: "not committed",
					platform: scenario.platform,
					wait: async () => undefined,
					renameFile: async () => {
						attempts++;
						throw failure;
					},
				}),
			).rejects.toBe(failure);
			expect(attempts).toBe(scenario.attempts);
			expect(await readFile(filePath, "utf8")).toBe("old committed contents");
			expect(await readdir(root)).toEqual(["project.json"]);
		});
	}

	test("concurrent writers use distinct temporary files and publish complete contents", async () => {
		const { root, filePath } = await fixture();
		const sources = new Set<string>();
		await Promise.all(
			Array.from({ length: 12 }, (_, value) =>
				writeAtomic({
					filePath,
					contents: JSON.stringify({ value }),
					platform: "win32",
					renameFile: async (source, destination) => {
						sources.add(String(source));
						await rename(source, destination);
					},
				}),
			),
		);
		expect(sources.size).toBe(12);
		const saved = JSON.parse(await readFile(filePath, "utf8"));
		expect(saved.value).toBeGreaterThanOrEqual(0);
		expect(saved.value).toBeLessThan(12);
		expect(await readdir(root)).toEqual(["project.json"]);
	});
});
