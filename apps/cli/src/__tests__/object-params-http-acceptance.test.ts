import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { runObjectParamsHttp } from "../../../../script/fixtures/object-params-http";

test.skipIf(process.env.ROCUT_TEST_OBJECT_PARAMS_HTTP !== "1")(
	"real Host object resolver HTTP and Creator callback preserve read-only project state",
	async () => {
		const root = await mkdtemp("C:/tmps/rocut-object-params-http-test-");
		const result = await runObjectParamsHttp(root);
		expect(result.ok).toBe(true);
		expect(Object.values(result.checks).every(Boolean)).toBe(true);
	},
	60000,
);
