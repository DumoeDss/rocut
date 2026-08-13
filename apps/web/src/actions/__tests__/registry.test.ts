import { describe, expect, test } from "bun:test";

import {
	bindAction,
	createActionScope,
	invokeAction,
	unbindAction,
} from "@/actions/registry";

describe("action registry scopes", () => {
	test("dispatches a same-named action only to the selected owner scope", () => {
		const firstScope = createActionScope({ owner: {} });
		const secondScope = createActionScope({ owner: {} });
		let firstCalls = 0;
		let secondCalls = 0;
		const first = () => {
			firstCalls += 1;
		};
		const second = () => {
			secondCalls += 1;
		};

		bindAction("toggle-play", first, firstScope);
		bindAction("toggle-play", second, secondScope);
		try {
			invokeAction("toggle-play", undefined, "keypress", secondScope);
			expect(firstCalls).toBe(0);
			expect(secondCalls).toBe(1);
		} finally {
			unbindAction("toggle-play", first, firstScope);
			unbindAction("toggle-play", second, secondScope);
		}
	});

	test("keeps unscoped binding and dispatch as the legacy compatibility path", () => {
		const scope = createActionScope({ owner: {} });
		let legacyCalls = 0;
		let scopedCalls = 0;
		const legacy = () => {
			legacyCalls += 1;
		};
		const scoped = () => {
			scopedCalls += 1;
		};

		bindAction("toggle-play", legacy);
		bindAction("toggle-play", scoped, scope);
		try {
			invokeAction("toggle-play");
			expect(legacyCalls).toBe(1);
			expect(scopedCalls).toBe(0);
		} finally {
			unbindAction("toggle-play", legacy);
			unbindAction("toggle-play", scoped, scope);
		}
	});

	test("unbind removes only the handler in the selected scope", () => {
		const firstScope = createActionScope({ owner: {} });
		const secondScope = createActionScope({ owner: {} });
		let firstCalls = 0;
		let secondCalls = 0;
		const first = () => {
			firstCalls += 1;
		};
		const second = () => {
			secondCalls += 1;
		};

		bindAction("toggle-play", first, firstScope);
		bindAction("toggle-play", second, secondScope);
		unbindAction("toggle-play", first, firstScope);
		try {
			invokeAction("toggle-play", undefined, undefined, firstScope);
			invokeAction("toggle-play", undefined, undefined, secondScope);
			expect(firstCalls).toBe(0);
			expect(secondCalls).toBe(1);
		} finally {
			unbindAction("toggle-play", first, firstScope);
			unbindAction("toggle-play", second, secondScope);
		}
	});

	test("nested invokeAction inherits the current handler scope", () => {
		const firstScope = createActionScope({ owner: {} });
		const secondScope = createActionScope({ owner: {} });
		let firstNestedCalls = 0;
		let secondNestedCalls = 0;
		const outer = () => invokeAction("deselect-all");
		const firstNested = () => {
			firstNestedCalls += 1;
		};
		const secondNested = () => {
			secondNestedCalls += 1;
		};

		bindAction("cancel-interaction", outer, firstScope);
		bindAction("deselect-all", firstNested, firstScope);
		bindAction("deselect-all", secondNested, secondScope);
		try {
			invokeAction("cancel-interaction", undefined, undefined, firstScope);
			expect(firstNestedCalls).toBe(1);
			expect(secondNestedCalls).toBe(0);
		} finally {
			unbindAction("cancel-interaction", outer, firstScope);
			unbindAction("deselect-all", firstNested, firstScope);
			unbindAction("deselect-all", secondNested, secondScope);
		}
	});
});
