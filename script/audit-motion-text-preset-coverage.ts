#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	MOTION_TEXT_RENDERER_SUPPORT,
	MOTION_TEXT_RENDERER_SUPPORT_VERSION,
} from "../packages/editor-classic/src/services/renderer/motion-text/support-manifest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CATALOG = resolve(
	REPO_ROOT,
	"docs/motion-text/jizura-preset-catalog.json",
);
const DEFAULT_OUTPUT = resolve(
	REPO_ROOT,
	"docs/motion-text/jizura-preset-compatibility.json",
);
const DEFAULT_COST_REPORT = resolve(
	REPO_ROOT,
	"docs/motion-text/jizura-renderer-costs.json",
);
const DEFAULT_FONT_CATALOG = resolve(
	REPO_ROOT,
	"rust/crates/motion-text/resources/jizura-font-catalog.json",
);
const PUBLIC_ASSET_ROOT = resolve(REPO_ROOT, "apps/web/public");
const PRESET_GROUPS = new Set([
	"style",
	"layout",
	"enter",
	"hold",
	"exit",
	"decor",
	"treat",
	"bg",
	"cam",
	"fx",
	"trans",
]);
const COMPLEX_GROUPS = new Set(["bg", "cam", "fx", "trans"]);
const NATIVE_ONLY_SUPPORT = new Map([
	["style:base", "rocut neutral fallback palette"],
	["enter:fade", "rocut baseline opacity entrance"],
	["exit:fade", "rocut baseline opacity exit"],
	["bg:transparent", "rocut transparent surface alias"],
	["cam:static", "rocut no-camera-motion alias"],
	[
		"font:gothic_bold_zh_hans",
		"rocut-native zh-Hans language asset variant for the gothic_bold role",
	],
	[
		"font:gothic_bold_ko",
		"rocut-native Korean language asset variant for the gothic_bold role",
	],
]);
const VARIANT_MATRIX_REPRESENTATIVES = {
	style: "crimson",
	layout: "tySplitType",
	enter: "knWordSpin",
	hold: "knWordPulse",
	exit: "knStackAway",
	decor: "tyTextRule",
	treat: "knWordPlate",
	bg: "none",
	cam: "knTiltKick",
	fx: "hrPassingShadow",
	trans: "tyRuleWipe",
} as const;
const PREVIEW_FIXTURE_BASELINE_STYLES = [
	"noir",
	"crimson",
	"caution",
	"paper",
	"mono",
] as const;
const PREVIEW_FIXTURE_HORROR_STYLES = [
	"hrRuin",
	"hrNightRec",
	"hrCurse",
] as const;
const PREVIEW_FIXTURE_CATALOG_STYLES = [
	"magenta",
	"hud",
	"mint",
	"specimen",
	"transit",
	"blueprint",
	"rouge",
	"sakura",
	"ocean",
	"sunset",
	"forest",
	"vapor",
	"newsprint",
	"synth80",
	"kraft",
	"candy",
	"acid",
	"sumi",
	"gold",
] as const;
const PREVIEW_FIXTURE_BASELINE_LAYOUTS = [
	"center",
	"mixed",
	"vcols",
	"marquee",
	"huge",
	"type",
	"stack",
] as const;
const PREVIEW_FIXTURE_CORE_LAYOUTS = [
	"tile",
	"scatter",
	"ring",
	"wave",
	"labels",
	"condensed",
	"gloss",
	"diag",
	"circle",
	"pill",
	"title",
	"interlude",
] as const;
const PREVIEW_FIXTURE_LAYOUTS_A = [
	"lowerThird",
	"corners",
	"staircase",
	"zigzag",
	"arcTop",
	"spiral",
	"gridCells",
	"dropCap",
	"justified",
	"frameBox",
	"bubble",
	"subtitleBar",
	"ticker",
	"splitScreen",
	"mirror",
	"sideways",
	"edgeFrame",
	"perspective",
	"hanko",
	"genkou",
	"panels",
	"filmstrip",
	"quote",
	"ruler",
	"searchBar",
	"chat",
	"notification",
	"ticket",
] as const;
const PREVIEW_FIXTURE_LAYOUTS_B = [
	"rain",
	"hanging",
	"orbit",
	"tunnel",
	"wordCloud",
	"bounceLine",
	"elastic",
	"crossBands",
	"stickerBomb",
	"neon",
	"keycaps",
	"bubbles",
	"slotMachine",
	"flipBoard",
	"credits",
	"zoomRepeat",
	"splitHalves",
	"columnsBig",
	"circleWords",
	"dotMatrix",
	"depthStack",
	"typeSpecimen",
	"kanjiFocus",
	"halfVertical",
	"curtain",
	"equalizer",
	"tape",
] as const;
const PREVIEW_FIXTURE_LAYOUTS_C = [
	"magazine",
	"headlineDeck",
	"contents",
	"footnote",
	"proofread",
	"numbered",
	"poster",
	"swissGrid",
	"dictionary",
	"ema",
	"ransom",
	"newspaper",
	"vinyl",
	"cassette",
	"bookSpine",
	"polaroid",
	"stampSheet",
	"postcard",
	"letterPaper",
	"calendar",
	"chochin",
	"routeMap",
	"stationSign",
	"noren",
	"tanzaku",
	"omikuji",
	"kakejiku",
	"shoji",
	"clapper",
	"warningLabel",
	"priceTag",
	"nameTag",
	"stickyNotes",
	"karuta",
] as const;
const PREVIEW_FIXTURE_LAYOUTS_D = [
	"cube",
	"cylinder",
	"flipCards",
	"accordion",
	"flag",
	"ribbon",
	"pendulum",
	"pile",
	"blocks",
	"balloons",
	"magnets",
	"tiles",
	"bulbs",
	"ledScroll",
	"billboard",
	"crowdBubbles",
	"crossword",
	"wordSearch",
	"puzzle",
	"shadowPlay",
	"kaleido",
	"dominoes",
	"burst",
	"fisheye",
	"wall",
	"origami",
	"zipper",
	"sliceStack",
	"glitchGrid",
	"mosaicTiles",
	"maskReveal",
	"contour",
	"halftoneBig",
	"stencil",
] as const;
const PREVIEW_FIXTURE_BASELINE_ENTRANCES = [
	"cut",
	"pop",
	"wipe",
	"blur",
	"slideL",
	"slideR",
] as const;
const PREVIEW_FIXTURE_BASELINE_HOLDS = [
	"still",
	"jitter",
	"drift",
	"breathe",
	"float",
	"sway",
	"pulse",
] as const;
const PREVIEW_FIXTURE_BASELINE_EXITS = [
	"cut",
	"drift",
	"wipe",
	"shrink",
	"blur",
	"slideOutL",
	"slideOutR",
] as const;
const PREVIEW_FIXTURE_CORE_ANIM_ENTRANCES = [
	"assemble",
	"slice",
	"type",
	"drop",
	"stretch",
	"spin",
	"flicker",
	"scramble",
	"zoom",
] as const;
const PREVIEW_FIXTURE_CORE_ANIM_HOLDS = ["wave", "glitchtick"] as const;
const PREVIEW_FIXTURE_CORE_ANIM_EXITS = [
	"explode",
	"fall",
	"slice",
	"stretch",
	"scatter",
	"glitch",
] as const;
const PREVIEW_FIXTURE_EXIT_HOLD_HOLDS = [
	"shimmer",
	"colorRun",
	"rotateSlow",
	"trackBreathe",
	"skewWobble",
	"beatHop",
	"hWave",
	"heartbeat",
	"orbitSmall",
	"jelly",
	"scanBand",
	"noiseDrift",
	"tilt",
	"zoomSlow",
	"stretchPulse",
	"glitchJump",
	"echoTrail",
] as const;
const PREVIEW_FIXTURE_EXIT_HOLD_EXITS = [
	"sinkMask",
	"riseOut",
	"flipOutX",
	"flipOutY",
	"foldOut",
	"squash",
	"trackOutWide",
	"collapse",
	"zoomThrough",
	"zoomFar",
	"spinOut",
	"twist",
	"waveOut",
	"blurOutStagger",
	"undraw",
	"outlineOut",
	"irisClose",
	"diagWipeOut",
	"blindsClose",
	"checkerOut",
	"splitApart",
	"vSliceDrop",
	"melt",
	"dissolve",
	"backspace",
	"scrambleOut",
	"glitchDissolve",
	"echoOut",
	"whipOut",
	"gravity",
	"popOut",
	"burn",
	"sweepCover",
	"shatterLite",
] as const;
const PREVIEW_FIXTURE_EXIT_B_HOLDS = [
	"glowFlicker",
	"windGust",
	"dangle",
	"eqBounce",
	"flashBox",
	"glintSweep",
	"flipSwap",
	"shadowSway",
	"magnetJiggle",
	"typeRattle",
	"focusRack",
	"pluckString",
] as const;
const PREVIEW_FIXTURE_EXIT_B_EXITS = [
	"peelOff",
	"crumpleOut",
	"tearOut",
	"scorchOut",
	"overexposeOut",
	"scanOut",
	"stripesOut",
	"halftoneOut",
	"eraserOut",
	"vacuumOut",
	"sandOut",
	"shredOut",
	"dominoOut",
	"hingeOut",
	"rocketOff",
	"bounceOff",
	"balloonOff",
	"deflateOut",
	"hazeOut",
	"glassBreak",
	"zipOut",
	"clapShut",
	"lampOff",
	"slotOut",
	"clockOut",
	"matrixOut",
	"tornadoOut",
	"rollUpOut",
	"snakeOut",
	"flutterOut",
	"rollOff",
	"fanClose",
	"rgbSplitOut",
	"shockOut",
	"floodOut",
	"slashOut",
	"mosaicOut",
	"scribbleOut",
	"candleOut",
] as const;
const PREVIEW_FIXTURE_CORE_DECORS = [
	"grid",
	"stripes",
	"blobs",
	"bars",
	"shapes",
	"counter",
	"brackets",
	"rings",
	"dots",
	"arrows",
	"slash",
	"sparks",
	"leaders",
	"waveform",
	"barcode",
] as const;
const PREVIEW_FIXTURE_EXTENDED_DECORS = [
	"crosshair",
	"cropMarks",
	"reticle",
	"radar",
	"progressRing",
	"timecodeBar",
	"rulerEdge",
	"dimension",
	"indexNum",
	"dateStamp",
	"qrBlock",
	"glitchRects",
	"concentricSquares",
	"triangleSpin",
	"lineBurst",
	"plusGrid",
	"guides",
	"waveLine",
	"spiralLine",
	"halftonePatch",
	"checkerStrip",
	"beatRing",
	"orbitDots",
	"constellation",
	"confetti",
	"petals",
	"rainStreaks",
	"snow",
	"lightLeak",
	"bokeh",
	"speedCorner",
	"risingParticles",
	"twinkle",
	"brushStroke",
	"tapePieces",
	"scribbleCircle",
	"scribbleUnder",
	"crossOut",
	"highlightMark",
	"heartsStars",
	"watermarkKanji",
	"verticalStrip",
	"romajiLine",
	"bracketsJP",
	"seal",
] as const;
const PREVIEW_FIXTURE_DECOR_B = [
	"kamon",
	"seigaiha",
	"asanoha",
	"hanabi",
	"chochin",
	"shimenawa",
	"sensu",
	"tsukiKumo",
	"momiji",
	"namiGashira",
	"kasumi",
	"hexGrid",
	"spectrumRing",
	"dataColumns",
	"spinner",
	"headingTape",
	"glyphLock",
	"atomOrbit",
	"sonarArcs",
	"circuit",
	"swatches",
	"ruledLines",
	"registration",
	"punchHoles",
	"staple",
	"paperClip",
	"indexTabs",
	"vines",
	"cloudPuffs",
	"starField",
	"moonPhases",
	"sunRays",
	"rainRipples",
	"bubbles",
	"smoke",
	"dandelion",
	"fireflies",
	"memphis",
	"zigzagRibbon",
	"polkaPatch",
	"stripeCircle",
	"decoCorners",
	"halfCircles",
	"loopArrows",
	"starburst",
	"tally",
	"cursorClick",
	"windowChrome",
	"progressBar",
	"toggleSwitch",
	"notifBell",
	"likeCounter",
	"mediaControls",
	"volumeBars",
	"musicNotes",
] as const;
const PREVIEW_FIXTURE_BASELINE_TREATMENTS = [
	"none",
	"outline",
	"outlineFill",
	"glow",
	"underline",
] as const;
const PREVIEW_FIXTURE_LOOKS_TREATMENTS = [
	"doubleOutline",
	"extrude",
	"longShadow",
	"hardShadow",
	"softShadow",
	"marker",
	"strike",
	"boxed",
	"gradientV",
	"splitColor",
	"halftone",
	"stripes",
	"hatch",
	"dotted",
	"alternate",
	"italic",
	"wide",
	"tall",
	"echoOutline",
	"emphasisDots",
] as const;
const PREVIEW_FIXTURE_BASELINE_BACKGROUNDS = ["none"] as const;
const PREVIEW_FIXTURE_BASELINE_CAMERAS = ["push"] as const;
const PREVIEW_FIXTURE_LAYOUTS = [
	"tyBandHide",
	"tyBaseline",
	"tyCropGiant",
	"tyCross",
	"tyErode",
	"tyFullTrack",
	"tyIndexTable",
	"tyJustify",
	"tyKeySplit",
	"tyLineFocus",
	"tyMargin",
	"tyRotBlock",
	"tyRuby",
	"tyScaleSteps",
	"tySplitType",
	"tySquare",
	"tyStatCount",
	"tyVRuler",
] as const;
const PREVIEW_FIXTURE_ENTRANCES = [
	"tyBracketOpen",
	"tyDotGrow",
	"tyKeyFirst",
	"tyLineWipe",
	"tyRetype",
	"tyRubyDrop",
	"tyUnderLift",
	"tyZoomOne",
] as const;
const PREVIEW_FIXTURE_ENTER_B_ENTRANCES = [
	"springIn",
	"pendulum",
	"rollIn",
	"slingshot",
	"rockSettle",
	"bounceBall",
	"snapRail",
	"fanOpen",
	"cylinder",
	"shuffle",
	"stopMotion",
	"ripple",
	"zipper",
	"zoomAlt",
	"tiltUp",
	"stickerPeel",
	"crumple",
	"noteUnfold",
	"tornJoin",
	"splitFlap",
	"overexpose",
	"glint",
	"loupe",
	"filmFeed",
	"backlight",
	"lightLeak",
	"heatHaze",
	"crtOn",
	"interlace",
	"loadingBar",
	"dither",
	"odometer",
	"matrixRain",
	"hatchFill",
	"brushReveal",
	"inkDrop",
	"quarters",
	"invertBox",
	"printRegister",
	"echoCount",
	"liquidFill",
	"windBlown",
	"strokeOrder",
	"clockWipe",
	"shadowFirst",
	"bubbles",
	"tokoroten",
] as const;
const PREVIEW_FIXTURE_ENTER_A_ENTRANCES = [
	"riseMask",
	"dropMask",
	"slideWhole",
	"flipX",
	"flipY",
	"domino",
	"fold",
	"unroll",
	"strokeDraw",
	"outlineFill",
	"splitJoin",
	"vSlice",
	"shutter",
	"iris",
	"diagWipe",
	"blinds",
	"checker",
	"randomOrder",
	"bounceBig",
	"squashDrop",
	"rubber",
	"glitchIn",
	"echoIn",
	"whip",
	"skewIn",
	"trackIn",
	"trackOut",
	"blurStagger",
	"fadeStagger",
	"waveIn",
	"spiralIn",
	"zoomOut",
	"resolve",
	"magnet",
	"inkBleed",
	"neonOn",
	"cursorSweep",
	"stamp",
] as const;
const PREVIEW_FIXTURE_HOLDS = [
	"tyKeyPulse",
	"tyOutlineBlink",
	"tyReadCursor",
	"tyTrackStep",
] as const;
const PREVIEW_FIXTURE_EXITS = [
	"tyBracketClose",
	"tyFoldVert",
	"tyKeyLast",
	"tyLineFeed",
	"tyStrike",
	"tyToDot",
	"tyToIndex",
	"tyUnderSink",
] as const;
const PREVIEW_FIXTURE_DECORS = [
	"tyBigPunct",
	"tyColophon",
	"tyGlyphBody",
	"tyRunningHead",
	"tyTextRule",
	"tyTypeScale",
] as const;
const PREVIEW_FIXTURE_TREATMENTS = [
	"tyHeadBig",
	"tyHeadRules",
	"tyHollowKey",
	"tyIndexSup",
] as const;
const PREVIEW_FIXTURE_TRANSITIONS = ["tyGridCells", "tyRuleWipe"] as const;
const PREVIEW_FIXTURE_TREAT_TRANS_TREATMENTS = [
	"neonOutline",
	"chrome",
	"rainbow",
	"glitchSplit",
	"shadowStack",
	"stencilGap",
	"waterline",
	"karaoke",
	"sizeWave",
	"rotateAlt",
	"baselineShift",
	"fauxBold",
	"circled",
	"bracketsQuote",
	"reflection",
	"inline",
	"sticker",
	"gradientSweep",
	"kerningWide",
	"monoGrid",
	"outlineOffset",
	"toneShadow",
	"fadeChars",
	"cutShift",
	"focusPull",
	"spotChar",
	"ransom",
] as const;
const PREVIEW_FIXTURE_TREAT_TRANS_TRANSITIONS = [
	"wipe",
	"diagonalWipe",
	"clockWipe",
	"irisOpen",
	"pushSlide",
	"cover",
	"uncover",
	"zoomThrough",
	"doorsOpen",
	"blinds",
	"checker",
	"blockDissolve",
	"whipPan",
	"spinOut",
	"inkBlob",
	"shatterTiles",
	"sliceShift",
	"cubeTurn",
	"flashCross",
	"pixelate",
] as const;
const PREVIEW_FIXTURE_KINETIC_LAYOUTS = [
	"knCollide",
	"knFlowSnap",
	"knGearWords",
	"knPadGrid",
	"knPathRide",
	"knQuarterTurn",
	"knReflow",
	"knRhythmCuts",
	"knSeesaw",
	"knSlamStack",
	"knSwapCenter",
	"knTumble",
	"knTypeSlam",
	"knZoomDive",
] as const;
const PREVIEW_FIXTURE_HORROR_LAYOUTS = [
	"hrCctv",
	"hrDoorGap",
	"hrFlashlight",
	"hrMissing",
	"hrOuija",
	"hrRedacted",
	"hrRisingDark",
	"hrSpiritPhoto",
	"hrStaticTv",
	"hrWallScrawl",
	"hrWrongOne",
	"hrWrongShadow",
] as const;
const PREVIEW_FIXTURE_HORROR_ENTRANCES = [
	"hrBlinkCreep",
	"hrClawReveal",
	"hrJumpScare",
	"hrManifest",
	"hrMirrorSnap",
	"hrUneasy",
	"hrVhold",
] as const;
const PREVIEW_FIXTURE_HORROR_HOLDS = [
	"hrFlickerLight",
	"hrLagOne",
	"hrStare",
	"hrTwitch",
] as const;
const PREVIEW_FIXTURE_HORROR_EXITS = [
	"hrDrain",
	"hrFlickerDie",
	"hrLookBack",
	"hrPulledDown",
	"hrShiver",
	"hrSwallow",
	"hrTurnAway",
] as const;
const PREVIEW_FIXTURE_HORROR_TREATMENTS = [
	"hrDoubleExp",
	"hrEroded",
	"hrInkBleed",
	"hrRedact",
] as const;
const PREVIEW_FIXTURE_HORROR_DECORS = [
	"hrCracks",
	"hrDrips",
	"hrDustBeam",
	"hrScratches",
	"hrSigil",
	"hrStaticPatch",
	"hrWatchEye",
] as const;
const PREVIEW_FIXTURE_HORROR_BACKGROUNDS = [
	"hrCorridor",
	"hrDeadTrees",
	"hrFailingLamp",
	"hrMold",
] as const;
const PREVIEW_FIXTURE_HORROR_CAMERAS = ["hrDutchSnap", "hrNervous"] as const;
const PREVIEW_FIXTURE_BGCAM_BACKGROUNDS = [
	"auroraRibbons",
	"meshBlobs",
	"duotoneSweep",
	"horizonGlow",
	"seigaiha",
	"asanoha",
	"houndstooth",
	"herringbone",
	"argyle",
	"tartan",
	"chevron",
	"isoCubes",
	"hexGrid",
	"triTess",
	"moire",
	"squareTunnel",
	"spiralArms",
	"topoLines",
	"ridgePlot",
	"starfield",
	"nightMoon",
	"skyline",
	"sunsetSun",
	"oceanWaves",
	"rainWindow",
	"snowLayers",
	"fireworks",
	"cloudLayers",
	"mountains",
	"filmStrip",
	"vhsBand",
	"tornPaper",
	"godRays",
	"vignettePulse",
	"kaleidoscope",
	"marble",
	"paperCut",
] as const;
const PREVIEW_FIXTURE_BGCAM_CAMERAS = [
	"orbitDrift",
	"barrelRoll",
	"pendulumSway",
	"focusIn",
	"rackFocus",
	"earthquake",
	"floatNoise",
	"vertigo",
	"tiltDown",
	"spiralIn",
	"snapPan",
	"jelly",
] as const;
const PREVIEW_FIXTURE_LOOKS_BACKGROUNDS = [
	"sunburst",
	"concentric",
	"halftoneFade",
	"bigStripes",
	"splitV",
	"splitH",
	"splitDiag",
	"gradientSweep",
	"spotlight",
	"tvBars",
	"checker",
	"bigChar",
	"speedLines",
	"scanBars",
	"dotGrid",
	"retroGrid",
	"bokehBg",
	"particlesBg",
	"ripples",
	"polka",
	"eqBars",
	"borderFrame",
	"letterbox",
	"noiseField",
] as const;
const PREVIEW_FIXTURE_LOOKS_CAMERAS = [
	"pullOut",
	"panL",
	"panR",
	"tiltUp",
	"dutch",
	"handheld",
	"beatPunch",
	"whipIn",
	"crashZoom",
	"bounce",
	"roll",
	"driftDiag",
	"shakeHard",
	"dollyIn",
	"stepZoom",
] as const;
const PREVIEW_FIXTURE_LOOKS_EFFECTS = [
	"panelWipe",
	"irisTrans",
	"doors",
	"blindsTrans",
	"rgbSplit",
	"smear",
	"vhsRoll",
	"trackingNoise",
	"mirrorFlash",
	"strobe",
	"posterize",
	"hueShift",
	"tileShift",
	"filmBurn",
	"whipBlur",
	"blackFrame",
	"whiteFrame",
	"gridRepeat",
	"waveWarp",
	"pixelDrift",
	"zoomPunch",
	"lightSweep",
	"crtOff",
	"splitSlide",
] as const;
const PREVIEW_FIXTURE_HORROR_EFFECTS = [
	"hrPassingShadow",
	"hrSignalLoss",
	"hrSubliminal",
] as const;
const PREVIEW_FIXTURE_CORE_EFFECTS = [
	"block",
	"chroma",
	"flash",
	"invert",
	"mosaic",
	"shake",
	"slice",
	"zoom",
] as const;
const PREVIEW_FIXTURE_FX_B_EFFECTS = [
	"radialChroma",
	"bloomFlash",
	"bulge",
	"pixelSort",
	"interlace",
	"macroBlock",
	"halftone",
	"duotone",
	"ditherBit",
	"rotateSnap",
	"echoFrames",
	"kaleido",
	"bandInvert",
	"lightRays",
	"anamorphic",
	"heartbeat",
	"tvStatic",
	"dustScratches",
	"filmAdvance",
	"perspectiveTilt",
	"ripple",
	"focusLines",
	"speedLines",
	"starGlint",
	"colorBars",
	"zoomStutter",
	"negativeRing",
	"edgeDetect",
	"shatter",
	"defocus",
	"snapshot",
	"squash",
	"scanBar",
	"loopScroll",
] as const;
const PREVIEW_FIXTURE_HORROR_TRANSITIONS = ["hrBlink", "hrStaticCut"] as const;
const PREVIEW_FIXTURE_KINETIC_DECORS = ["knSpeedTrail", "knWordTicks"] as const;
const PREVIEW_FIXTURE_KINETIC_TREATMENTS = [
	"knWordPlate",
	"knWordScale",
] as const;
const PREVIEW_FIXTURE_KINETIC_TRANSITIONS = [
	"knCornerSwing",
	"knStripSlam",
	"knStutterCut",
] as const;
const PREVIEW_FIXTURE_KINETIC_CAMERAS = [
	"knCardFlip",
	"knJumpCut",
	"knReadPan",
	"knRushIn",
	"knShearKick",
	"knTiltKick",
] as const;
const PREVIEW_FIXTURE_KINETIC_HOLDS = [
	"knBeatLean",
	"knCounterRock",
	"knGapBreath",
	"knTickShift",
	"knWordPulse",
	"knWordRide",
] as const;
const PREVIEW_FIXTURE_KINETIC_ENTRANCES = [
	"knDiveIn",
	"knHingeDrop",
	"knInertia",
	"knLoopIn",
	"knPushIn",
	"knReplaceIn",
	"knStretchOut",
	"knTypeToSlam",
	"knWordSlam",
	"knWordSpin",
] as const;
const PREVIEW_FIXTURE_KINETIC_EXITS = [
	"knCloseGap",
	"knDiveGlyph",
	"knJumpCutOut",
	"knLaunch",
	"knPushOut",
	"knStackAway",
	"knWordBlink",
	"knWordKick",
] as const;
type PreviewFixture = {
	readonly path: string;
	readonly probe: string;
};

function previewFixtureEntries(
	entries: ReadonlyArray<ReadonlyArray<string | PreviewFixture>>,
): Array<readonly [string, PreviewFixture]> {
	return entries.map((entry, index) => {
		const [key, fixture] = entry;
		if (
			entry.length !== 2 ||
			typeof key !== "string" ||
			typeof fixture !== "object"
		) {
			throw new TypeError(`Preview fixture entry ${index} must be a key pair.`);
		}
		return [key, fixture];
	});
}

const PREVIEW_FIXTURES = new Map(
	previewFixtureEntries([
		...PREVIEW_FIXTURE_BASELINE_STYLES.map((style) => [
			`style:${style}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `baselineStyles.${style}`,
			},
		]),
		...PREVIEW_FIXTURE_HORROR_STYLES.map((style) => [
			`style:${style}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `horrorStyles.${style}`,
			},
		]),
		...PREVIEW_FIXTURE_CATALOG_STYLES.map((style) => [
			`style:${style}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `catalogStyles.${style}`,
			},
		]),
		...PREVIEW_FIXTURE_BASELINE_LAYOUTS.map((layout) => [
			`layout:${layout}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `baselineLayouts.${layout}`,
			},
		]),
		...PREVIEW_FIXTURE_CORE_LAYOUTS.map((layout) => [
			`layout:${layout}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `coreLayouts.${layout}`,
			},
		]),
		...PREVIEW_FIXTURE_LAYOUTS_A.map((layout) => [
			`layout:${layout}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `layoutsA.${layout}`,
			},
		]),
		...PREVIEW_FIXTURE_LAYOUTS_B.map((layout) => [
			`layout:${layout}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `layoutsB.${layout}`,
			},
		]),
		...PREVIEW_FIXTURE_LAYOUTS_C.map((layout) => [
			`layout:${layout}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `layoutsC.${layout}`,
			},
		]),
		...PREVIEW_FIXTURE_LAYOUTS_D.map((layout) => [
			`layout:${layout}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `layoutsD.${layout}`,
			},
		]),
		...PREVIEW_FIXTURE_BASELINE_ENTRANCES.map((enter) => [
			`enter:${enter}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `baselineEntrances.${enter}`,
			},
		]),
		...PREVIEW_FIXTURE_BASELINE_HOLDS.map((hold) => [
			`hold:${hold}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `baselineHolds.${hold}`,
			},
		]),
		...PREVIEW_FIXTURE_BASELINE_EXITS.map((exit) => [
			`exit:${exit}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `baselineExits.${exit}`,
			},
		]),
		...PREVIEW_FIXTURE_CORE_ANIM_ENTRANCES.map((enter) => [
			`enter:${enter}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `coreAnimEntrances.${enter}`,
			},
		]),
		...PREVIEW_FIXTURE_CORE_ANIM_HOLDS.map((hold) => [
			`hold:${hold}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `coreAnimHolds.${hold}`,
			},
		]),
		...PREVIEW_FIXTURE_CORE_ANIM_EXITS.map((exit) => [
			`exit:${exit}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `coreAnimExits.${exit}`,
			},
		]),
		...PREVIEW_FIXTURE_EXIT_HOLD_HOLDS.map((hold) => [
			`hold:${hold}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `exitHoldHolds.${hold}`,
			},
		]),
		...PREVIEW_FIXTURE_EXIT_HOLD_EXITS.map((exit) => [
			`exit:${exit}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `exitHoldExits.${exit}`,
			},
		]),
		...PREVIEW_FIXTURE_EXIT_B_HOLDS.map((hold) => [
			`hold:${hold}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `exitBHolds.${hold}`,
			},
		]),
		...PREVIEW_FIXTURE_EXIT_B_EXITS.map((exit) => [
			`exit:${exit}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `exitBExits.${exit}`,
			},
		]),
		...PREVIEW_FIXTURE_CORE_DECORS.map((decor) => [
			`decor:${decor}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `coreDecors.${decor}`,
			},
		]),
		...PREVIEW_FIXTURE_EXTENDED_DECORS.map((decor) => [
			`decor:${decor}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `extendedDecors.${decor}`,
			},
		]),
		...PREVIEW_FIXTURE_DECOR_B.map((decor) => [
			`decor:${decor}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `decorB.${decor}`,
			},
		]),
		...PREVIEW_FIXTURE_BASELINE_TREATMENTS.map((treat) => [
			`treat:${treat}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `baselineTreatments.${treat}`,
			},
		]),
		...PREVIEW_FIXTURE_LOOKS_TREATMENTS.map((treat) => [
			`treat:${treat}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `looksTreatments.${treat}`,
			},
		]),
		...PREVIEW_FIXTURE_BASELINE_BACKGROUNDS.map((bg) => [
			`bg:${bg}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `baselineBackgrounds.${bg}`,
			},
		]),
		...PREVIEW_FIXTURE_BASELINE_CAMERAS.map((cam) => [
			`cam:${cam}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `baselineCameras.${cam}`,
			},
		]),
		...PREVIEW_FIXTURE_LAYOUTS.map((layout) => [
			`layout:${layout}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `typographyLayouts.${layout}`,
			},
		]),
		...PREVIEW_FIXTURE_ENTRANCES.map((enter) => [
			`enter:${enter}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `typographyEntrances.${enter}`,
			},
		]),
		...PREVIEW_FIXTURE_ENTER_B_ENTRANCES.map((enter) => [
			`enter:${enter}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `enterBEntrances.${enter}`,
			},
		]),
		...PREVIEW_FIXTURE_ENTER_A_ENTRANCES.map((enter) => [
			`enter:${enter}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `enterAEntrances.${enter}`,
			},
		]),
		...PREVIEW_FIXTURE_HOLDS.map((hold) => [
			`hold:${hold}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `typographyHolds.${hold}`,
			},
		]),
		...PREVIEW_FIXTURE_EXITS.map((exit) => [
			`exit:${exit}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `typographyExits.${exit}`,
			},
		]),
		...PREVIEW_FIXTURE_DECORS.map((decor) => [
			`decor:${decor}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `typographyDecors.${decor}`,
			},
		]),
		...PREVIEW_FIXTURE_TREATMENTS.map((treat) => [
			`treat:${treat}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `typographyTreatments.${treat}`,
			},
		]),
		...PREVIEW_FIXTURE_TRANSITIONS.map((trans) => [
			`trans:${trans}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `typographyTransitions.${trans}`,
			},
		]),
		...PREVIEW_FIXTURE_TREAT_TRANS_TREATMENTS.map((treat) => [
			`treat:${treat}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `treatTransTreatments.${treat}`,
			},
		]),
		...PREVIEW_FIXTURE_TREAT_TRANS_TRANSITIONS.map((trans) => [
			`trans:${trans}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `treatTransTransitions.${trans}`,
			},
		]),
		...PREVIEW_FIXTURE_KINETIC_LAYOUTS.map((layout) => [
			`layout:${layout}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `kineticLayouts.${layout}`,
			},
		]),
		...PREVIEW_FIXTURE_HORROR_LAYOUTS.map((layout) => [
			`layout:${layout}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `horrorLayouts.${layout}`,
			},
		]),
		...PREVIEW_FIXTURE_HORROR_ENTRANCES.map((enter) => [
			`enter:${enter}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `horrorEntrances.${enter}`,
			},
		]),
		...PREVIEW_FIXTURE_HORROR_HOLDS.map((hold) => [
			`hold:${hold}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `horrorHolds.${hold}`,
			},
		]),
		...PREVIEW_FIXTURE_HORROR_EXITS.map((exit) => [
			`exit:${exit}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `horrorExits.${exit}`,
			},
		]),
		...PREVIEW_FIXTURE_HORROR_TREATMENTS.map((treat) => [
			`treat:${treat}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `horrorTreatments.${treat}`,
			},
		]),
		...PREVIEW_FIXTURE_HORROR_DECORS.map((decor) => [
			`decor:${decor}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `horrorDecors.${decor}`,
			},
		]),
		...PREVIEW_FIXTURE_HORROR_BACKGROUNDS.map((bg) => [
			`bg:${bg}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `horrorBackgrounds.${bg}`,
			},
		]),
		...PREVIEW_FIXTURE_HORROR_CAMERAS.map((cam) => [
			`cam:${cam}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `horrorCameras.${cam}`,
			},
		]),
		...PREVIEW_FIXTURE_BGCAM_BACKGROUNDS.map((bg) => [
			`bg:${bg}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `bgcamBackgrounds.${bg}`,
			},
		]),
		...PREVIEW_FIXTURE_BGCAM_CAMERAS.map((cam) => [
			`cam:${cam}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `bgcamCameras.${cam}`,
			},
		]),
		...PREVIEW_FIXTURE_LOOKS_BACKGROUNDS.map((bg) => [
			`bg:${bg}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `looksBackgrounds.${bg}`,
			},
		]),
		...PREVIEW_FIXTURE_LOOKS_CAMERAS.map((cam) => [
			`cam:${cam}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `looksCameras.${cam}`,
			},
		]),
		...PREVIEW_FIXTURE_HORROR_EFFECTS.map((effect) => [
			`fx:${effect}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `horrorEffects.${effect}`,
			},
		]),
		...PREVIEW_FIXTURE_CORE_EFFECTS.map((effect) => [
			`fx:${effect}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `coreEffects.${effect}`,
			},
		]),
		...PREVIEW_FIXTURE_FX_B_EFFECTS.map((effect) => [
			`fx:${effect}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `fxBEffects.${effect}`,
			},
		]),
		...PREVIEW_FIXTURE_LOOKS_EFFECTS.map((effect) => [
			`fx:${effect}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `looksEffects.${effect}`,
			},
		]),
		...PREVIEW_FIXTURE_HORROR_TRANSITIONS.map((trans) => [
			`trans:${trans}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `horrorTransitions.${trans}`,
			},
		]),
		...PREVIEW_FIXTURE_KINETIC_DECORS.map((decor) => [
			`decor:${decor}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `kineticDecors.${decor}`,
			},
		]),
		...PREVIEW_FIXTURE_KINETIC_TREATMENTS.map((treat) => [
			`treat:${treat}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `kineticTreatments.${treat}`,
			},
		]),
		...PREVIEW_FIXTURE_KINETIC_TRANSITIONS.map((trans) => [
			`trans:${trans}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `kineticTransitions.${trans}`,
			},
		]),
		...PREVIEW_FIXTURE_KINETIC_CAMERAS.map((cam) => [
			`cam:${cam}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `kineticCameras.${cam}`,
			},
		]),
		...PREVIEW_FIXTURE_KINETIC_HOLDS.map((hold) => [
			`hold:${hold}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `kineticHolds.${hold}`,
			},
		]),
		...PREVIEW_FIXTURE_KINETIC_ENTRANCES.map((enter) => [
			`enter:${enter}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `kineticEntrances.${enter}`,
			},
		]),
		...PREVIEW_FIXTURE_KINETIC_EXITS.map((exit) => [
			`exit:${exit}`,
			{
				path: "script/fixtures/motion-text-renderer-browser-probe.html",
				probe: `kineticExits.${exit}`,
			},
		]),
	]),
);

function argument(name: string, fallback: string): string {
	const inlinePrefix = `--${name}=`;
	const inline = process.argv.find((value) => value.startsWith(inlinePrefix));
	if (inline) return inline.slice(inlinePrefix.length);
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function strictUtf8(path: string): string {
	return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}

function requiredString(
	record: Record<string, unknown>,
	key: string,
	context: string,
): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new TypeError(`${context}.${key} must be a non-empty string.`);
	}
	return value;
}

function requiredNumber(
	record: Record<string, unknown>,
	key: string,
	context: string,
): number {
	const value = record[key];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new TypeError(`${context}.${key} must be a finite number.`);
	}
	return value;
}

function nullableString(
	record: Record<string, unknown>,
	key: string,
	context: string,
): string | null {
	const value = record[key];
	if (value === null || value === undefined) return null;
	if (typeof value !== "string") {
		throw new TypeError(`${context}.${key} must be a string or null.`);
	}
	return value;
}

function stringArray(
	record: Record<string, unknown>,
	key: string,
	context: string,
): string[] {
	const value = record[key];
	if (value === undefined) return [];
	if (
		!Array.isArray(value) ||
		value.some((entry) => typeof entry !== "string")
	) {
		throw new TypeError(`${context}.${key} must be a string array.`);
	}
	return [...value];
}

function optionalMetadataValue(
	metadata: Record<string, unknown>,
	keys: readonly string[],
): unknown {
	for (const key of keys) {
		if (metadata[key] !== undefined) return metadata[key];
	}
	return null;
}

function batchFor({
	group,
	set,
	supported,
}: {
	readonly group: string;
	readonly set: string | null;
	readonly supported: boolean;
}): "A" | "B" | "C" | "D" | "resource" {
	if (group === "font") return "resource";
	if (set === "typo" || set === "kinetic") return "B";
	if (set === "horror" || COMPLEX_GROUPS.has(group)) return "C";
	if (supported) return "A";
	return "D";
}

const catalogPath = resolve(argument("catalog", DEFAULT_CATALOG));
const outputPath = resolve(argument("output", DEFAULT_OUTPUT));
const costReportPath = resolve(argument("cost-report", DEFAULT_COST_REPORT));
const checkOnly = process.argv.includes("--check");
const catalogSource = strictUtf8(catalogPath);
const parsedCatalog: unknown = JSON.parse(catalogSource);
if (!isRecord(parsedCatalog) || !Array.isArray(parsedCatalog.entries)) {
	throw new TypeError(
		"The JIZURA preset catalog must contain an entries array.",
	);
}
const source = parsedCatalog.source;
if (!isRecord(source)) {
	throw new TypeError("The JIZURA preset catalog must identify its source.");
}
const engineVersion = requiredString(source, "version", "catalog.source");
const engineRevision = nullableString(source, "revision", "catalog.source");

const fontCatalogSource = strictUtf8(DEFAULT_FONT_CATALOG);
const parsedFontCatalog: unknown = JSON.parse(fontCatalogSource);
if (
	!isRecord(parsedFontCatalog) ||
	parsedFontCatalog.schemaVersion !== 1 ||
	!Array.isArray(parsedFontCatalog.fonts)
) {
	throw new TypeError("The JIZURA font catalog must use schema version 1.");
}
const fontResourceEvidence = new Map<
	string,
	{
		readonly family: string;
		readonly style: string;
		readonly weight: number;
		readonly kind: string;
		readonly supportedLanguages: readonly string[];
		readonly builtinPath: string;
		readonly bytes: number;
		readonly contentDigest: string;
		readonly license: string;
		readonly licensePath: string;
		readonly sourceDirectory: string;
		readonly sourceFile: string;
	}
>();
for (const [index, rawFont] of parsedFontCatalog.fonts.entries()) {
	const context = `fontCatalog.fonts[${index}]`;
	if (!isRecord(rawFont)) throw new TypeError(`${context} must be an object.`);
	const id = requiredString(rawFont, "id", context);
	const key = `font:${id}`;
	if (fontResourceEvidence.has(key)) {
		throw new Error(`Font catalog contains duplicate ${key}.`);
	}
	const builtinPath = requiredString(rawFont, "builtinPath", context);
	if (!/^motion-text\/fonts\/[a-z0-9][a-z0-9-]*\.ttf$/u.test(builtinPath)) {
		throw new Error(`${context}.builtinPath must be a logical TTF asset.`);
	}
	const licensePath = requiredString(rawFont, "licensePath", context);
	if (
		!/^motion-text\/fonts\/licenses\/[a-z0-9-]+-OFL\.txt$/u.test(licensePath)
	) {
		throw new Error(`${context}.licensePath must be an OFL inventory asset.`);
	}
	const contentDigest = requiredString(rawFont, "contentDigest", context);
	if (!/^sha256:[a-f0-9]{64}$/u.test(contentDigest)) {
		throw new Error(`${context}.contentDigest must be a SHA-256 digest.`);
	}
	const assetPath = resolve(PUBLIC_ASSET_ROOT, builtinPath);
	const licenseAssetPath = resolve(PUBLIC_ASSET_ROOT, licensePath);
	const assetBytes = readFileSync(assetPath);
	const actualDigest = `sha256:${createHash("sha256").update(assetBytes).digest("hex")}`;
	if (actualDigest !== contentDigest) {
		throw new Error(
			`${context} digest mismatch: expected ${contentDigest}, received ${actualDigest}.`,
		);
	}
	const licenseText = strictUtf8(licenseAssetPath);
	if (!licenseText.includes("SIL OPEN FONT LICENSE Version 1.1")) {
		throw new Error(`${context} license is not an OFL 1.1 text.`);
	}
	fontResourceEvidence.set(key, {
		family: requiredString(rawFont, "family", context),
		style: requiredString(rawFont, "style", context),
		weight: requiredNumber(rawFont, "weight", context),
		kind: requiredString(rawFont, "kind", context),
		supportedLanguages: stringArray(rawFont, "supportedLanguages", context),
		builtinPath,
		bytes: assetBytes.byteLength,
		contentDigest,
		license: requiredString(rawFont, "license", context),
		licensePath,
		sourceDirectory: requiredString(rawFont, "sourceDirectory", context),
		sourceFile: requiredString(rawFont, "sourceFile", context),
	});
}
const supportKeys = new Set<string>();
for (const entry of MOTION_TEXT_RENDERER_SUPPORT) {
	const key = `${entry.group}:${entry.id}`;
	if (supportKeys.has(key)) {
		throw new Error(`Renderer support contains duplicate ${key}.`);
	}
	supportKeys.add(key);
}
for (const key of fontResourceEvidence.keys()) supportKeys.add(key);

const parsedCostReport: unknown = JSON.parse(strictUtf8(costReportPath));
if (!isRecord(parsedCostReport)) {
	throw new TypeError("The motion-text cost report must be an object.");
}
const costSource = parsedCostReport.source;
if (!isRecord(costSource)) {
	throw new TypeError("The motion-text cost report must identify its source.");
}
const costReportCurrent =
	requiredNumber(costSource, "rendererSupportVersion", "cost.source") ===
	MOTION_TEXT_RENDERER_SUPPORT_VERSION;
const costConfig = parsedCostReport.config;
if (!isRecord(costConfig)) {
	throw new TypeError("The motion-text cost report must include config.");
}
if (
	requiredNumber(costConfig, "width", "cost.config") !== 1280 ||
	requiredNumber(costConfig, "height", "cost.config") !== 720 ||
	requiredNumber(costConfig, "sampleFrames", "cost.config") < 30 ||
	requiredString(costConfig, "measurement", "cost.config") !==
		"resolve-draw-and-canvas-flush"
) {
	throw new Error(
		"The motion-text cost report does not satisfy the 720p budget.",
	);
}
if (!Array.isArray(parsedCostReport.measurements)) {
	throw new TypeError("The motion-text cost report must contain measurements.");
}
const COST_TIERS = new Set(["low", "medium", "high", "heavy", "over-budget"]);
const costMeasurements = new Map<
	string,
	{
		readonly tier: string;
		readonly minMs: number;
		readonly medianMs: number;
		readonly p95Ms: number;
		readonly maxMs: number;
		readonly meanMs: number;
	}
>();
if (costReportCurrent) {
	for (const [
		index,
		rawMeasurement,
	] of parsedCostReport.measurements.entries()) {
		const context = `cost.measurements[${index}]`;
		if (!isRecord(rawMeasurement)) {
			throw new TypeError(`${context} must be an object.`);
		}
		const group = requiredString(rawMeasurement, "group", context);
		const id = requiredString(rawMeasurement, "id", context);
		const key = requiredString(rawMeasurement, "key", context);
		if (key !== `${group}:${id}`) {
			throw new Error(`${context}.key does not match its group and id.`);
		}
		if (!supportKeys.has(key)) {
			throw new Error(
				`Cost report references unsupported renderer entry ${key}.`,
			);
		}
		if (costMeasurements.has(key)) {
			throw new Error(`Cost report contains duplicate ${key}.`);
		}
		const tier = requiredString(rawMeasurement, "tier", context);
		if (!COST_TIERS.has(tier)) {
			throw new Error(`${context}.tier is invalid.`);
		}
		costMeasurements.set(key, {
			tier,
			minMs: requiredNumber(rawMeasurement, "minMs", context),
			medianMs: requiredNumber(rawMeasurement, "medianMs", context),
			p95Ms: requiredNumber(rawMeasurement, "p95Ms", context),
			maxMs: requiredNumber(rawMeasurement, "maxMs", context),
			meanMs: requiredNumber(rawMeasurement, "meanMs", context),
		});
	}
}

const catalogKeys = new Set<string>();
const statusCounts = { supported: 0, pending: 0, "unsupported-with-reason": 0 };
const batchCounts = { A: 0, B: 0, C: 0, D: 0, resource: 0 };
const groupCounts: Record<
	string,
	{ total: number; supported: number; pending: number; unsupported: number }
> = {};
const entries = parsedCatalog.entries.map((rawEntry, index) => {
	const context = `catalog.entries[${index}]`;
	if (!isRecord(rawEntry)) throw new TypeError(`${context} must be an object.`);
	const group = requiredString(rawEntry, "group", context);
	if (group !== "font" && !PRESET_GROUPS.has(group)) {
		throw new Error(`${context} has unknown group ${group}.`);
	}
	const id = requiredString(rawEntry, "id", context);
	const key = `${group}:${id}`;
	if (catalogKeys.has(key))
		throw new Error(`Catalog contains duplicate ${key}.`);
	catalogKeys.add(key);
	const name = requiredString(rawEntry, "name", context);
	const pack = requiredString(rawEntry, "pack", context);
	const set = nullableString(rawEntry, "set", context);
	const sourceFile = requiredString(rawEntry, "sourceFile", context);
	const metadata = isRecord(rawEntry.metadata) ? rawEntry.metadata : {};
	const plannerChoice = isRecord(rawEntry.plannerChoice)
		? rawEntry.plannerChoice
		: {};
	const supported = supportKeys.has(key);
	const status = supported ? "supported" : "pending";
	const batch = batchFor({ group, set, supported });
	const previewFixture = PREVIEW_FIXTURES.get(key) ?? null;
	const costMeasurement = costMeasurements.get(key) ?? null;
	const fontResource = fontResourceEvidence.get(key) ?? null;
	statusCounts[status] += 1;
	batchCounts[batch] += 1;
	const byGroup = (groupCounts[group] ??= {
		total: 0,
		supported: 0,
		pending: 0,
		unsupported: 0,
	});
	byGroup.total += 1;
	byGroup[status] += 1;
	return {
		group,
		id,
		name,
		labels: [group, pack, set].filter((value) => value !== null),
		batch,
		status,
		reason: supported
			? null
			: group === "font"
				? "Font file, license, digest, and language mapping are not integrated yet."
				: "Preset has not yet been adapted into the rocut motion-text renderer pack.",
		source: { file: sourceFile, pack, set },
		engine: { version: engineVersion, revision: engineRevision },
		implementationKind: requiredString(rawEntry, "implementation", context),
		functionFields: stringArray(rawEntry, "functionFields", context),
		parameterSchema: optionalMetadataValue(metadata, [
			"parameterSchema",
			"parameters",
			"params",
		]),
		constraints: {
			language: optionalMetadataValue(metadata, [
				"language",
				"languages",
				"lang",
			]),
			aspectRatio: optionalMetadataValue(metadata, [
				"aspectRatio",
				"aspectRatios",
				"ratio",
			]),
			minChars: plannerChoice.minChars ?? null,
			maxChars: plannerChoice.maxChars ?? null,
			minDuration: plannerChoice.minDuration ?? null,
			maxDuration: plannerChoice.maxDuration ?? null,
		},
		fontDependencies: stringArray(rawEntry, "explicitFontRefs", context),
		fontResource,
		transparentMode:
			group === "font"
				? "not-applicable"
				: supported
					? "declared-overlay-and-scene"
					: "unverified",
		costTier:
			group === "font"
				? "not-applicable"
				: (costMeasurement?.tier ?? "unmeasured"),
		costMeasurement:
			costMeasurement === null
				? null
				: {
						...costMeasurement,
						width: 1280,
						height: 720,
						sampleFrames: requiredNumber(
							costConfig,
							"sampleFrames",
							"cost.config",
						),
						measurement: "resolve-draw-and-canvas-flush",
					},
		previewFixture,
		evidence:
			supported && group === "font"
				? [
						{
							kind: "offline-font-resource",
							path: fontResource?.builtinPath,
							test: `${key} bytes and SHA-256 match the Rust font catalog`,
						},
						{
							kind: "font-license",
							path: fontResource?.licensePath,
							test: `${key} ships an OFL 1.1 notice`,
						},
						{
							kind: "font-ready-barrier",
							path: "packages/editor-classic/src/services/renderer/__tests__/motion-text-font-runtime.test.ts",
							test: `${key} uses digest verification, glyph inspection, and FontFace lifecycle isolation`,
						},
					]
				: supported
					? [
							{
								kind: "runtime-smoke",
								path: "packages/editor-classic/src/services/renderer/__tests__/motion-text-node.test.ts",
								test: "every advertised renderer preset resolves and draws without unsupported diagnostics",
							},
							...(previewFixture
								? [
										{
											kind: "chromium-pixel-probe",
											path: "script/probe-motion-text-renderer-browser.mjs",
											test: previewFixture.probe,
										},
									]
								: []),
							...(costMeasurement
								? [
										{
											kind: "chromium-cost-benchmark",
											path: "docs/motion-text/jizura-renderer-costs.json",
											test: key,
										},
									]
								: []),
						]
					: [],
	};
});

for (const key of PREVIEW_FIXTURES.keys()) {
	if (!catalogKeys.has(key)) {
		throw new Error(`Preview fixture references unknown catalog entry ${key}.`);
	}
	if (!supportKeys.has(key)) {
		throw new Error(
			`Preview fixture references unsupported renderer entry ${key}.`,
		);
	}
}
for (const key of costMeasurements.keys()) {
	if (!catalogKeys.has(key)) {
		throw new Error(`Cost report references unknown catalog entry ${key}.`);
	}
}

const nativeOnlySupport = [...supportKeys]
	.filter((key) => !catalogKeys.has(key))
	.map((key) => {
		const reason = NATIVE_ONLY_SUPPORT.get(key);
		if (!reason) {
			throw new Error(
				`Renderer advertises ${key}, which is absent from JIZURA.`,
			);
		}
		const separator = key.indexOf(":");
		return {
			group: key.slice(0, separator),
			id: key.slice(separator + 1),
			reason,
		};
	})
	.sort((left, right) =>
		`${left.group}:${left.id}`.localeCompare(`${right.group}:${right.id}`),
	);
for (const key of NATIVE_ONLY_SUPPORT.keys()) {
	if (!supportKeys.has(key)) {
		throw new Error(`Native-only support ledger contains stale ${key}.`);
	}
}

const presetTotal = entries.filter((entry) => entry.group !== "font").length;
const fontTotal = entries.length - presetTotal;
const supportedPresetGroups = [
	...new Set(
		entries
			.filter((entry) => entry.status === "supported" && entry.group !== "font")
			.map((entry) => entry.group),
	),
].sort();
const variantMatrixGroups = Object.keys(VARIANT_MATRIX_REPRESENTATIVES).sort();
const report = {
	schemaVersion: 1,
	generatedBy: "script/audit-motion-text-preset-coverage.ts",
	source: {
		catalog: "docs/motion-text/jizura-preset-catalog.json",
		catalogSha256: createHash("sha256").update(catalogSource).digest("hex"),
		fontCatalog: "rust/crates/motion-text/resources/jizura-font-catalog.json",
		fontCatalogSha256: createHash("sha256")
			.update(fontCatalogSource)
			.digest("hex"),
		engineVersion,
		engineRevision,
		rendererSupportVersion: MOTION_TEXT_RENDERER_SUPPORT_VERSION,
	},
	summary: {
		total: entries.length,
		presets: presetTotal,
		fonts: fontTotal,
		status: statusCounts,
		batch: batchCounts,
		byGroup: groupCounts,
		nativeOnlySupport: nativeOnlySupport.length,
	},
	gates: {
		allCatalogEntriesClassified: entries.length === catalogKeys.size,
		allSupportedEntriesHaveRuntimeSmokeEvidence: entries
			.filter((entry) => entry.status === "supported")
			.every((entry) => entry.evidence.length > 0),
		allSupportedEntriesHavePreviewEvidence: entries
			.filter((entry) => entry.status === "supported" && entry.group !== "font")
			.every((entry) => entry.previewFixture !== null),
		allSupportedPresetGroupsHaveVariantMatrixEvidence:
			supportedPresetGroups.length === variantMatrixGroups.length &&
			supportedPresetGroups.every(
				(group, index) => group === variantMatrixGroups[index],
			),
		allSupportedEntriesHaveCostEvidence: entries
			.filter((entry) => entry.status === "supported" && entry.group !== "font")
			.every((entry) => entry.costTier !== "unmeasured"),
		allCostsMeasured: entries
			.filter((entry) => entry.group !== "font")
			.every((entry) => entry.costTier !== "unmeasured"),
		allTransparentModesVerified: entries.every(
			(entry) =>
				entry.group === "font" || entry.transparentMode !== "unverified",
		),
	},
	verificationMatrices: [
		{
			id: "supported-family-variants-v1",
			scope: "representative-of-each-supported-preset-group",
			representatives: VARIANT_MATRIX_REPRESENTATIVES,
			axes: {
				textLength: ["short", "long"],
				language: ["en", "zh-CN", "ja", "ko"],
				aspect: ["landscape", "portrait"],
				compositionMode: ["overlay", "scene"],
			},
			scenarioCount: 8,
			evidence: {
				kind: "chromium-pixel-probe",
				path: "script/probe-motion-text-renderer-browser.mjs",
				test: "variantMatrix",
			},
		},
	],
	costBenchmark: {
		path: "docs/motion-text/jizura-renderer-costs.json",
		current: costReportCurrent,
		config: costConfig,
		environment: costReportCurrent
			? (parsedCostReport.environment ?? null)
			: null,
		summary: costReportCurrent ? (parsedCostReport.summary ?? null) : null,
	},
	nativeOnlySupport,
	entries,
};
const serialized = `${JSON.stringify(report, null, "\t")}\n`;
if (checkOnly) {
	let current: string;
	try {
		current = strictUtf8(outputPath);
	} catch {
		console.error(`Preset compatibility report is missing: ${outputPath}`);
		process.exit(1);
	}
	if (current !== serialized) {
		console.error(
			`Preset compatibility report is stale. Run: bun script/audit-motion-text-preset-coverage.ts`,
		);
		process.exit(1);
	}
	console.log(
		`motion-text preset coverage: PASS (${entries.length} classified, ${statusCounts.supported} supported, ${statusCounts.pending} pending)`,
	);
} else {
	writeFileSync(outputPath, serialized, "utf8");
	console.log(
		`motion-text preset coverage: ${entries.length} classified, ${statusCounts.supported} supported, ${statusCounts.pending} pending -> ${outputPath}`,
	);
}
