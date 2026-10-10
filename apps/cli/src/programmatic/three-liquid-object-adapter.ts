import { THREE_LIQUID_OBJECT_FRAME_DRIVER } from "./engines/three-liquid-object-driver";
import { THREE_LIQUID_OBJECT_COMPILER_MODULES } from "./engines/three-liquid-object-compiler-plugin";
import { REMOTION_COMPILER_CHILD } from "./engines/remotion-compiler-child";
import { THREE_LIQUID_OBJECT_BROWSER_MODULE } from "./liquid-object-browser-module";
import { LIQUID_OBJECT_CAPTURE_BOOTSTRAP } from "./liquid-object-page-capture";
import { liquidIdentityDigest } from "./three-liquid-object-identity";

export function getThreeLiquidObjectAdapterHash(): string {
	return liquidIdentityDigest(
		[
			THREE_LIQUID_OBJECT_FRAME_DRIVER,
			THREE_LIQUID_OBJECT_COMPILER_MODULES,
			REMOTION_COMPILER_CHILD,
			THREE_LIQUID_OBJECT_BROWSER_MODULE,
			LIQUID_OBJECT_CAPTURE_BOOTSTRAP,
		].join("\n"),
	);
}
