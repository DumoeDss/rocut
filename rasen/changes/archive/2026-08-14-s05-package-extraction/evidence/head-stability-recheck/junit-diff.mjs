/**
 * Diffs the failing-testcase title sets between two `bun test --reporter=junit`
 * XML runs, used for M-3's HEAD-stability recheck (review round 1,
 * `evidence/review-report.md`).
 *
 * Console-vs-JUnit is not a valid stability control: switching reporters
 * changes representation *and* is two separate process invocations, so it
 * cannot distinguish "the tests are stable" from "the tests are flaky and two
 * different runs were compared." This script instead diffs two same-reporter
 * runs (JUnit-to-JUnit) so the only variable between them is time.
 *
 *   node evidence/head-stability-recheck/junit-diff.mjs runA.xml runB.xml
 *
 * `junit-run1.xml` / `junit-run2.xml` in this directory are the two runs this
 * was actually invoked against (`bun test --reporter=junit`, no code change
 * between them, at HEAD `af0a52ba`). `console-run1.log` / `console-run2.log`
 * are each run's plain console output, kept alongside for the same reason
 * the earlier draft's console-vs-JUnit comparison is discussed in the report:
 * so a later reader can see the representational difference directly rather
 * than take the description on faith.
 */
import { readFileSync } from "node:fs";

function extractFailTitles(path) {
	const xml = readFileSync(path, "utf8");
	// Split into <testcase ...>...</testcase> or self-closing <testcase .../>
	const testcaseRe = /<testcase\b[^>]*\/>|<testcase\b[^>]*>[\s\S]*?<\/testcase>/g;
	const titles = [];
	let m;
	while ((m = testcaseRe.exec(xml)) !== null) {
		const block = m[0];
		const hasFailure = /<failure\b/.test(block) || /<error\b/.test(block);
		if (!hasFailure) continue;
		const nameMatch = block.match(/name="([^"]*)"/);
		const classMatch = block.match(/classname="([^"]*)"/);
		const name = nameMatch ? nameMatch[1] : "?";
		const cls = classMatch ? classMatch[1] : "?";
		titles.push(`${cls} > ${name}`);
	}
	return titles.sort();
}

const [pathA, pathB] = process.argv.slice(2);
const a = extractFailTitles(pathA);
const b = extractFailTitles(pathB);

console.log(`${pathA}: ${a.length} failing testcase(s)`);
console.log(`${pathB}: ${b.length} failing testcase(s)`);

const setA = new Set(a);
const setB = new Set(b);
const onlyA = a.filter((t) => !setB.has(t));
const onlyB = b.filter((t) => !setA.has(t));

console.log(`\nOnly in ${pathA} (${onlyA.length}):`);
for (const t of onlyA) console.log(`  - ${t}`);
console.log(`\nOnly in ${pathB} (${onlyB.length}):`);
for (const t of onlyB) console.log(`  - ${t}`);
