import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("Surface React identity evidence", () => {
	test("keeps the probe private and requires identity, context, state, and effect fields", () => {
		const probe = readFileSync(
			resolve(HERE, "../surface-react-identity-probe.tsx"),
			"utf8",
		);
		const barrel = readFileSync(resolve(HERE, "../index.ts"), "utf8");
		for (const field of ["identity", "context", "state", "effect"]) {
			expect(probe).toContain(`${field}:`);
		}
		expect(probe).toContain('data-testid="r2-react-state-probe"');
		expect(probe).toContain('onClick={() => setState("state-ok")}');
		expect(probe).toContain("hostReactIdentity === surfaceReactIdentity");
		expect(barrel).not.toContain("surface-react-identity-probe");
	});
});
