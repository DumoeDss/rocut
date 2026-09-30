/**
 * @opencutSurface provider — React-free Rust/WASM motion-text automation factory
 *
 * React-free motion-text factory surface for hosts and automation clients.
 *
 * The Rust/WASM factory owns parsing, planning, mutation and variation. The
 * renderer support manifest is published beside it so non-UI hosts use the
 * same supported preset set as the Classic renderer.
 */
export * from "../wasm/motion-text-factory";
export {
	MOTION_TEXT_RENDERER_SUPPORT,
	MOTION_TEXT_RENDERER_SUPPORT_VERSION,
} from "../services/renderer/motion-text/support-manifest";
export {
	JIZURA_PRESET_CATALOG,
	MOTION_TEXT_PRESET_GROUPS,
	type MotionTextPresetCatalogEntry,
} from "./preset-catalog";
