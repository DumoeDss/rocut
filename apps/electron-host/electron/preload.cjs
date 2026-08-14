"use strict";
/**
 * s05-second-host preload (design E2/E4).
 *
 * contextIsolation: true, sandbox: true, nodeIntegration: false — configured
 * in main.cjs. Group 4 lands the single `opencutStore` bridge here (the
 * minimal, identifier-keyed ProjectStoreFiles surface); until then this file
 * deliberately exposes nothing, and the renderer is a pure sandboxed page.
 */
