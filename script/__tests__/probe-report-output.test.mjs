import { expect, test } from "bun:test";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmdirSync,
	unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emitProbeReport, probeReportMode } from "../probe-report-output.mjs";

test("writes one complete UTF-8 report from an explicit --write request", () => {
	const directory = mkdtempSync(join(tmpdir(), "rocut-probe-report-"));
	const reportPath = join(directory, "report.json");
	try {
		emitProbeReport({
			report: { schemaVersion: 1, result: "ok" },
			reportPath,
			args: ["--write"],
		});
		expect(readFileSync(reportPath, "utf8")).toBe(
			'{\n\t"schemaVersion": 1,\n\t"result": "ok"\n}\n',
		);
		expect(readdirSync(directory)).toEqual(["report.json"]);
	} finally {
		unlinkSync(reportPath);
		rmdirSync(directory);
	}
});

test("rejects conflicting check and write modes before touching the report", () => {
	expect(() => probeReportMode(["--check", "--write"])).toThrow(
		"--check and --write are mutually exclusive",
	);
	expect(() =>
		emitProbeReport({
			report: { schemaVersion: 1 },
			reportPath: "unused.json",
			args: ["--check", "--write"],
		}),
	).toThrow("--check and --write are mutually exclusive");
});
