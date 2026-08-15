import { expect, test } from "bun:test";
import {
	buildStorageFailureRecord,
	runStorageClear,
	STORAGE_FAILURE_MESSAGE,
} from "../storage-provider-operations";

test("storage diagnostics expose stable identity without raw provider payload", () => {
	const secret = "PRIVATE-STORAGE-PAYLOAD";
	const error = Object.assign(new Error(secret), {
		code: "quota-exceeded",
		providerPayload: secret,
	});
	const record = buildStorageFailureRecord({
		operation: "clear-projects",
		error,
	});

	expect(record).toEqual({
		level: "error",
		message: "Durable editor storage operation failed",
		context: {
			operation: "clear-projects",
			scope: "store",
			code: "quota-exceeded",
		},
	});
	expect(JSON.stringify(record)).not.toContain(secret);
	expect(STORAGE_FAILURE_MESSAGE).toMatch(/retry/i);
});

test("storage clear rejects before publishing a false refreshed state", async () => {
	const secret = "controlled-clear-failure";
	const calls: string[] = [];
	const store = {
		clear: async () => {
			calls.push("clear");
			throw new Error(secret);
		},
		inspect: async () => {
			calls.push("inspect");
			return { availability: "available" as const, capacity: null };
		},
	};

	await expect(
		runStorageClear({
			store,
			scope: "projects",
			reloadProjects: async () => {
				calls.push("reload");
			},
		}),
	).rejects.toThrow(secret);
	expect(calls).toEqual(["clear"]);
});

test("storage clear also rejects when the post-clear project refresh fails", async () => {
	const secret = "controlled-refresh-failure";
	const calls: string[] = [];
	const store = {
		clear: async () => {
			calls.push("clear");
		},
		inspect: async () => {
			calls.push("inspect");
			return { availability: "available" as const, capacity: null };
		},
	};

	await expect(
		runStorageClear({
			store,
			scope: "all",
			reloadProjects: async () => {
				calls.push("reload");
				throw new Error(secret);
			},
		}),
	).rejects.toThrow(secret);
	expect(calls).toEqual(["clear", "reload"]);
});
