import { expect, test } from "bun:test";
import { threeLiquidObjectCapability } from "../programmatic/engines/three-liquid-object-capability";

test("Liquid configuration discovery never asserts health or Electron support", () => {
	const value = threeLiquidObjectCapability({
		toolchainConfigured: true,
		executable: "C:/fixtures/chrome.exe",
	});
	expect(value).toMatchObject({
		capability: "liquid-object-v1",
		profile: "three-liquid-object-v1",
		compile: "configured-not-health-probed",
		capture: "configured-not-health-probed",
		electron: "unavailable",
		experimental: true,
	});
	expect(Object.isFrozen(value)).toBe(true);
});

test("missing toolchain/browser, relative executable or Electron excludes Liquid capture", () => {
	for (const options of [
		{ toolchainConfigured: false, executable: "C:/fixtures/chrome.exe" },
		{ toolchainConfigured: true },
		{ toolchainConfigured: true, executable: "chrome.exe" },
		{
			toolchainConfigured: true,
			executable: "C:/fixtures/chrome.exe",
			connectionFile: "C:/fixtures/electron.json",
		},
	])
		expect(threeLiquidObjectCapability(options).capture).toBe("unavailable");
	expect(
		threeLiquidObjectCapability({ toolchainConfigured: false }).compile,
	).toBe("unavailable");
});
