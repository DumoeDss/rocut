import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

export function probeReportMode(args = process.argv.slice(2)) {
	const checkOnly = args.includes("--check");
	const writeReport = args.includes("--write");
	if (checkOnly && writeReport) {
		throw new Error("--check and --write are mutually exclusive");
	}
	return { checkOnly, writeReport };
}

export function emitProbeReport({
	report,
	reportPath,
	args = process.argv.slice(2),
}) {
	const { writeReport } = probeReportMode(args);

	const serialized = `${JSON.stringify(report, null, "\t")}\n`;
	if (!writeReport) {
		process.stdout.write(serialized);
		return;
	}

	const temporaryPath = `${reportPath}.${process.pid}.tmp`;
	try {
		writeFileSync(temporaryPath, serialized, { encoding: "utf8", flag: "wx" });
		renameSync(temporaryPath, reportPath);
	} finally {
		if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
	}
	console.log(`wrote ${reportPath}`);
}
