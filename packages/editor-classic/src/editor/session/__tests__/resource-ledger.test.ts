import { describe, expect, test } from "bun:test";
import { ResourceLedger } from "../resource-ledger";
import type { SessionResourceRef } from "../resources";

describe("resource ledger retention", () => {
	test("drops completed timer closures while keeping bounded ordered evidence", () => {
		const ledger = new ResourceLedger<
			SessionResourceRef & { release(): void }
		>();
		for (let index = 0; index < 5000; index++) {
			const entry = {
				resourceId: `timer-${index}`,
				resourceClass: "timer" as const,
				release() {},
			};
			ledger.track(entry);
			ledger.retire(entry);
		}
		expect(ledger.entries()).toEqual([]);
		const history = ledger.releaseHistory();
		expect(history.releaseOrder).toHaveLength(1024);
		expect(history.releaseOrderOmitted).toBe(3976);
		expect(history.releaseOrder[0].resourceId).toBe("timer-3976");
		expect(history.releaseOrder.at(-1)?.resourceId).toBe("timer-4999");
		expect(history.releaseOrder.every((entry) => !("release" in entry))).toBe(
			true,
		);
	});

	test("retains pending ownership order and GPU reconciliation tombstones", () => {
		const ledger = new ResourceLedger<SessionResourceRef>();
		const first = { resourceId: "worker", resourceClass: "worker" as const };
		const second = { resourceId: "timer", resourceClass: "timer" as const };
		const gpu = { resourceId: "gpu", resourceClass: "gpuResource" as const };
		ledger.track(first);
		ledger.track(second);
		ledger.track(gpu);
		ledger.retire(second);
		ledger.retire(gpu);
		expect(ledger.entries()).toEqual([first, gpu]);
		expect(ledger.releaseHistory()).toEqual({
			releaseOrder: [second, gpu],
			releaseOrderOmitted: 0,
		});
		ledger.retire(first);
		expect(ledger.entries()).toEqual([gpu]);
	});
});
