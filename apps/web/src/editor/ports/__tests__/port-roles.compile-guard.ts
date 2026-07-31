/**
 * The compile-time guard on **role completeness**.
 *
 * `resolveEditorHost()` checks exactly the roles named in `PORT_ROLES`. If that
 * register can fall behind `EditorHostPorts`, then a later child adds a role,
 * forgets the register, and the gate silently stops checking the new role — with
 * nothing going red. At a freeze that is the worst available failure shape,
 * because six children build on the gate.
 *
 * `PORT_ROLES` is therefore derived from `Record<PortRole, true>`, which fails to
 * compile on omission. This file proves that in **both** directions, the same way
 * `runtime-graphics-query.compile-guard.ts` does for the wasm seam:
 *
 * - a complete register compiles;
 * - an incomplete one does not — and the `@ts-expect-error` marking it also fails
 *   the build if it ever stops being an error, so the guard cannot become
 *   vacuous.
 *
 * No runtime assertions; `tsc` is the assertion. Named `.compile-guard.ts`,
 * outside `bun test`'s globs.
 */
import type { EditorHostPorts, PortRole } from "../index";

/** Complete — compiles. */
export const completeRegister: Record<PortRole, true> = {
	store: true,
	assets: true,
	assetLoader: true,
	runtimeResources: true,
	exporter: true,
	diagnostics: true,
	ids: true,
	environment: true,
};

/**
 * Incomplete — must not compile. `environment` is missing, which is precisely
 * the omission the old `satisfies readonly PortRole[]` form accepted silently.
 */
// @ts-expect-error a register missing a port role must fail to compile.
export const incompleteRegister: Record<PortRole, true> = {
	store: true,
	assets: true,
	assetLoader: true,
	runtimeResources: true,
	exporter: true,
	diagnostics: true,
	ids: true,
};

/**
 * A role that is not on `EditorHostPorts` is rejected too, so the register
 * cannot drift *ahead* of the interface either.
 */
export const inventedRoleIsRejected: Record<PortRole, true> = {
	...completeRegister,
	// @ts-expect-error "telemetry" is not a port role.
	telemetry: true,
};

/**
 * And the register's key type really is the interface's key set, not a
 * hand-maintained union that could drift from it.
 */
export type RegisterKeysAreInterfaceKeys = PortRole extends keyof EditorHostPorts
	? keyof EditorHostPorts extends PortRole
		? true
		: never
	: never;
export const registerKeysMatchInterface: RegisterKeysAreInterfaceKeys = true;
