import { MV_EMBER_RASTER_SOURCE } from "./mv-ember-raster";
import { MV_HEART_RASTER_SOURCE } from "./mv-heart-raster";
import { MV_HEART_FILTERED_SOURCE } from "./mv-heart-renderer-filtered";
import { MV_HEART_DRAW_SOURCE } from "./mv-heart-renderer-draw";
import { MV_HEART_LIFETIME_SOURCE } from "./mv-heart-renderer-lifetime";

/** Fixed native interpreter for actual Rust Heart/Sky transport, not authored
 * code or a scene producer. Callers return/throw into a cancelled iterator.
 * Heart crop and Sky owner envelopes share this fixed native draw interpreter. */
export const MV_HEART_RENDERER_SOURCE =
	MV_EMBER_RASTER_SOURCE +
	MV_HEART_RASTER_SOURCE +
	MV_HEART_FILTERED_SOURCE +
	MV_HEART_DRAW_SOURCE +
	MV_HEART_LIFETIME_SOURCE;
