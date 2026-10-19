import { describe, expect, test } from "bun:test";
import {
	assembleWorkspacePages,
	isWorkspacePage,
} from "./creator-workspace-pages";

const body = JSON.stringify({
	projectId: "project",
	revision: "2",
	documents: [],
	assets: [{ name: "界😀" }],
});
const chunks = [body.slice(0, 30), body.slice(30)];
const page = (index: number) => ({
	transport: "workspace-pages-v1",
	token: "token",
	projectId: "project",
	revision: "2",
	pageCount: 2,
	totalBytes: new TextEncoder().encode(body).byteLength,
	index,
	chunk: chunks[index],
});

describe("atomic workspace pages", () => {
	test("assembles UTF-8 metadata only after every page arrives", async () => {
		expect(
			await assembleWorkspacePages({
				initial: page(0),
				read: async () => page(1),
			}),
		).toEqual(JSON.parse(body));
	});
	test("rejects page identity drift, omissions, and transfer limits", async () => {
		for (const changed of [
			{ token: "other" },
			{ revision: "3" },
			{ projectId: "other" },
			{ index: 0 },
			{ totalBytes: 1 },
		])
			await expect(
				assembleWorkspacePages({
					initial: page(0),
					read: async () => ({
						...page(1),
						...changed,
					}),
				}),
			).rejects.toThrow();
		await expect(
			assembleWorkspacePages({
				initial: { ...page(0), totalBytes: 1 },
				read: async () => page(1),
			}),
		).rejects.toThrow();
		expect(isWorkspacePage({ ...page(0), pageCount: 65 })).toBe(false);
		expect(
			isWorkspacePage({ ...page(0), totalBytes: 32 * 1024 * 1024 + 1 }),
		).toBe(false);
		expect(
			isWorkspacePage({ ...page(0), chunk: "x".repeat(1024 * 1024) }),
		).toBe(false);
	});
});
