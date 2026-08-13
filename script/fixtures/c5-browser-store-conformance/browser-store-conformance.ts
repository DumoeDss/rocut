import {
	type ProjectStoreConformanceFixture,
	runPortConformance,
} from "@opencut/editor-ports/conformance";
import { createInMemoryPorts } from "@opencut/editor-ports/in-memory";
import { createBrowserProjectStoreConformanceFixture } from "../../../apps/web/src/services/storage/browser-project-store-conformance";

export async function runBrowserStoreConformance() {
	const prefix = "c5-disposable-";
	const identity = `${prefix}${crypto.randomUUID()}`;
	const fixture: ProjectStoreConformanceFixture =
		await createBrowserProjectStoreConformanceFixture({ identity, prefix });
	const disposable = fixture.disposableMigration;
	if (!fixture.control || !disposable) {
		throw new Error(
			"complete browser conformance requires controls and a disposable migration binding",
		);
	}
	if (
		disposable.identity !== identity ||
		disposable.store !== fixture.store ||
		disposable.cleanup.identity !== identity ||
		disposable.cleanup.store !== fixture.store
	) {
		throw new Error(
			"browser conformance store, identity, and cleanup target are not bound",
		);
	}

	try {
		const report = await runPortConformance({
			label: `browser project store (${identity})`,
			ports: createInMemoryPorts({ store: fixture.store }),
			storeFixture: fixture,
			storeConformanceProfile: "complete-browser",
			exerciseMigration: true,
		});
		const requiredSkips = report.results.filter(
			(result) =>
				result.port === "store" &&
				(result.status === "skipped" ||
					result.detail?.startsWith(
						"required complete-browser case skipped:",
					) === true),
		);
		if (requiredSkips.length > 0) {
			throw new Error(
				`complete browser conformance skipped ${requiredSkips.length} required storage cases`,
			);
		}
		return report;
	} finally {
		await disposable.cleanup.run();
	}
}
