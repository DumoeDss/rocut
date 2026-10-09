import assert from "node:assert/strict";
import test from "node:test";
import { exactCredentialMatch } from "./particle-editor-credentials.mjs";

test("credential matcher detects exact current token in binary/text without returning it", () => {
	assert.equal(
		exactCredentialMatch(
			Buffer.from("prefix-private-test-token-suffix"),
			new Set(["private-test-token"]),
		),
		true,
	);
	assert.equal(
		exactCredentialMatch(
			Buffer.from([0, 1, 97, 98, 99, 255]),
			new Set(["abc"]),
		),
		true,
	);
});
test("credential matcher rejects prefixes, empty secrets and absent tokens", () => {
	assert.equal(
		exactCredentialMatch(
			Buffer.from("private-test"),
			new Set(["private-test-token"]),
		),
		false,
	);
	assert.equal(
		exactCredentialMatch(Buffer.from("normal"), new Set(["", "absent"])),
		false,
	);
});
