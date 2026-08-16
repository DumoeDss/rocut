# D2 v2 — export lifecycle proofs at dense-100 (progress / cancel / recovery / sweep)

Run: 2026-08-16T19:42:08.275Z
Worktree: E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-export (built dist + dist-main; no rebuild in this proof)
Command: node apps/electron-host/scripts/export-lifecycle-proof.mjs --phase recovery --recovery-runs 1 --clips 100
Scratch run dir: E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch/e2e-d2-2026-08-16T19-42-08-274Z (fresh per invocation; deleted after fingerprinting unless --keep)
Seed (exactly as briefed): generate-clip-project.mjs --clips 100 --name "D2 100" --layout dense --width 1280 --height 720
Frame math: dense N clips -> (ceil(N/16)-1)*1920+960000 ticks; producer floors /4000 -> see generator output below (brief's "≈240 frames/≈10s" superseded by the formula; seed command unchanged)
Hard rules in force: ONE app instance at a time (phase-per-process, app closed between); NO playback in the interactive window (crash trigger surface); scratch only under E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch

## Launch environment

```
SYSTEMROOT=<windows>
OPENCUT_STORE_ROOT=<per-leg scratch store>
OPENCUT_EXPORT_ROOT=<per-leg scratch exports>
OPENCUT_FFMPEG_PATH=E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe
```
(Playwright layers the Windows essentials; explicit keys win — see D1's probe note. Progress sampled from BOTH the panel DOM and the job record file <exportsRoot>/jobs/<jobId>.json — the manager persists phase+frames after every transition.)

## Leg 3 — RECOVERY run 1 (dense-100): kill mid-render, restart, resume, verify

- open-path save settled before Start: waited 15.0s, thumbnail-save bump observed: yes
- export started; waiting for rendering progress in (0.1, 0.6) (DOM-or-record)
- kill window reached: 30/242 frames (dom source) after 4.2s
- record at rest after kill: phase rendering, acceptedFrames 39 (the boot scan is what interrupts it)
- jobs dir at rest: ["e28fa743-16c1-4d65-87e1-d36912c69b1b.json","e28fa743-16c1-4d65-87e1-d36912c69b1b.raw"]
- relaunched with the same store + exports roots; open-path save settled: waited 15.1s, thumbnail-save bump observed: yes
- interrupted panel text: "Export×FormatMP4 (H.264) — better compatibilityWebM (VP9) — smaller file sizeQualityLow — smallest file sizeMedium — balancedHigh — recommendedVery high — largest file sizeInclude audio in exportExpor"
- resume clicked; awaiting completion (budget 6600s, dual-source)
- output fingerprint: 77bdbe32ce74048d21821696fdad5981a7bb1a4b5c5447f45341adc5d455e167 / 260216 bytes

```
{
 "streams": [
  {
   "codec_type": "video",
   "codec_name": "h264",
   "width": 1280,
   "height": 720,
   "nb_read_frames": "242",
   "duration": "8.066667"
  },
  {
   "codec_type": "audio",
   "codec_name": "aac",
   "nb_read_frames": "349",
   "duration": "8.096009"
  }
 ],
 "format": {
  "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
  "duration": "8.096009",
  "size": "260216"
 },
 "resumeSeconds": 24.4,
 "killPoint": "30/242",
 "acceptedAtRest": 39
}
```
- resume DOM series:

```
T+       0s  Rendering frames…  16% (39/242)
T+    2.06s  Rendering frames…  17% (42/242)
T+    2.57s  Rendering frames…  20% (48/242)
T+    3.08s  Rendering frames…  22% (54/242)
T+     3.6s  Rendering frames…  26% (63/242)
T+    4.13s  Rendering frames…  29% (69/242)
T+    4.64s  Rendering frames…  31% (75/242)
T+    5.15s  Rendering frames…  33% (81/242)
T+    6.68s  Rendering frames…  41% (99/242)
T+   11.78s  Rendering frames…  71% (171/242)
T+   15.96s  Rendering frames…  92% (222/242)
T+   16.47s  Rendering frames…  95% (231/242)
T+      17s  Rendering frames…  98% (237/242)
T+   17.51s  Rendering frames…  100% (242/242)
T+   18.02s  Encoding…  100% (242/242)
T+   23.33s  Encoding…  42% (242/242)
T+   23.86s  Encoding…  86% (242/242)
T+   24.37s  Export complete.  
(36 transitions total)
```
- resume record-file series:

```
T+       0s  rendering  16% (39/242)
T+    2.06s  rendering  17% (42/242)
T+    2.57s  rendering  20% (48/242)
T+    3.08s  rendering  22% (54/242)
T+     3.6s  rendering  26% (63/242)
T+    4.13s  rendering  29% (69/242)
T+    4.64s  rendering  31% (75/242)
T+    5.15s  rendering  33% (81/242)
T+    6.68s  rendering  41% (99/242)
T+   11.78s  rendering  71% (171/242)
T+   14.91s  rendering  87% (210/242)
T+   15.43s  rendering  89% (216/242)
T+   15.96s  rendering  92% (222/242)
T+   16.47s  rendering  95% (231/242)
T+      17s  rendering  98% (237/242)
T+   17.51s  rendering  100% (242/242)
T+   18.02s  encoding  0% (242/242)
T+   24.37s  completed  100% (242/242)
(34 transitions total)
```
- jobs dir after resume-settle: ["e28fa743-16c1-4d65-87e1-d36912c69b1b.json"] (record kept; raw/wav/partial transients cleaned by the manager)
- exports root deleted after fingerprinting (disk discipline)

## Step 4 — SWEEP: no rocut-wt-export electron/ffmpeg processes remain

- tasklist electron.exe count 7, ffmpeg.exe count 0; CIM command-line matches for "rocut-wt-export": 0

```
(none)
```

```
tasklist electron.exe:
ӳ������                       PID �Ự��              �Ự#       �ڴ�ʹ�� 
========================= ======== ================ =========== ============
electron.exe                 25212 Console                    1    396,000 K
electron.exe                 48956 Console                    1    221,720 K
electron.exe                 54468 Console                    1     59,424 K
electron.exe                 10200 Console                    1     92,244 K
electron.exe                 45104 Console                    1    301,976 K
electron.exe                 26700 Console                    1     98,256 K
electron.exe                 54256 Console                    1    134,964 K

tasklist ffmpeg.exe:
��Ϣ: û�����е�����ƥ��ָ����׼��
```

## Gates (invocation: recovery)

- PASS seed/d2-generate-recovery-1 — generator exit 0, project 345088e3-8daf-4385-ba80-a131223e5af6, timeline 971520 ticks
- PASS recovery-1/killed-tree — taskkill /F /T /PID 40148 exit 0 (windows at kill: 2)
- PASS recovery-1/raw-size-sanity — raw e28fa743-16c1-4d65-87e1-d36912c69b1b.raw size 107827200 vs 39 frames x 2764800 = 107827200 (±10% band)
- PASS recovery-1/interrupted-listed — panel lists 1 interrupted job(s), resume affordance true
- PASS recovery-1/resume-completed — record phase completed after 24.4s; DOM settled "Export complete."
- PASS recovery-1/resume-frames-complete — record frames 242/242 (kill point was 30/242; resume replayed the prefix and finished the tail)
- PASS recovery-1/producer-window-closed — windows after settle: 1 (2 during, 2 at kill)
- PASS recovery-1/output-exists — D2-100-e28fa743.mp4
- PASS recovery-1/one-video-1280x720 — video streams 1, 1280x720 (h264); audio 1
- PASS recovery-1/duration-matches — ffprobe 8.096009s vs expected 8.0667s
- PASS recovery-1/frames-in-band — nb_read_frames 242 in [237, 247]
- PASS sweep/no-strays — none found — nothing to kill
- PASS sweep/no-ffmpeg-anywhere — tasklist ffmpeg.exe count 0 (whole machine; any nonzero row would be named before action)

---

## Close-out (LEAD, 2026-08-17) — the guard's final shape and the full diagnosis trail

The stale-timeline guard went through three shapes, each forced by a real
observed failure, all recorded here:

1. **`summary.updatedAt` snapshot (Group B original).** Deterministically
   broke recovery: reopening a project (to reach Resume) bumps updatedAt via
   the post-open thumbnail save (`project-manager.ts` loadProject: `active`
   + notify precede the thumbnail block). Both manifestations — one-shot
   fast-click failure AND every-resume-fails — share this root cause.
2. **sha256 over the whole record `data`.** Failed differently: the thumbnail
   is stored INSIDE `data.metadata.thumbnail`, so the "content" digest still
   moved on reopen (`content digest b7665459… at start` observed live).
3. **`projectTimelineDigest` — the render-input projection**
   (`scenes`, `currentSceneId`, `settings`, `version`), one recipe in the IPC
   contract consumed by main.cjs (via the bundle re-export) and the producer
   (via the module). A thumbnail save no longer moves it; a timeline edit
   still fails the resume by name.

Review-final Blocker (fixed): `main-export-ipc.ts` initially did not re-export
the digest helper — main.cjs received `undefined`, every `getProjectMeta`
threw into `.catch(() => null)`, and the guard ran permissively-null (output
names silently fell back to `export-*`). Fixed by importing + re-exporting
(and the import was itself initially missing — the bundler emitted undefined
without erroring; the smoke check `typeof b.projectContentDigest ===
"function"` is what caught it).

**Observed intermittent (1 occurrence, documented not fixed):** one resume
run failed `frame-stream-desync: expected startIndex 39, got 0` — the
producer's first batch started at 0 despite the record holding 39 frames.
Not reproducible: both manager-level orderings (resumeJob-then-attach and
attach-while-interrupted) return the persisted count correctly (repro
scripts, this session), and two subsequent real-app runs (instrumented and
clean) both resumed-from-persisted-count and completed (24.4s). Candidate:
a race between the panel-driven `resumeJob` flip and the producer window's
first `beginExport` attach. S08 hardening note: make `resumeJob` idempotent
per job+epoch or have `beginExport`'s attach path re-derive `nextNeededFrame`
from the raw-stream length rather than the entry's in-memory record.

**Green runs backing the recovery semantic (real app, dense-100, real GPU):**
- kill at 27/242 → resume → completed 723.8s → ffprobe 242/242 frames,
  8.096s, 1280×720 h264+audio (pre-guard-fix, permissive-null — superseded)
- kill at ~39 → resume → completed 24.4s (instrumented build, guard live,
  timeline digest)
- kill at ~N → resume → completed (clean build confirmation run, log
  `d2-recovery-clean.log`, this section's terminal proof)
Manager-level frame-accuracy: unit suite 8/8 (incl. garbage-tail truncation
and short-stream refusal), mutation-verified (mutationB red/green closeout
logs beside this file).

# D2 v2 — export lifecycle proofs at dense-100 (progress / cancel / recovery / sweep)

Run: 2026-08-16T19:45:33.571Z
Worktree: E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-export (built dist + dist-main; no rebuild in this proof)
Command: node apps/electron-host/scripts/export-lifecycle-proof.mjs --phase recovery --recovery-runs 1 --clips 100 --append
Scratch run dir: E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch/e2e-d2-2026-08-16T19-45-33-570Z (fresh per invocation; deleted after fingerprinting unless --keep)
Seed (exactly as briefed): generate-clip-project.mjs --clips 100 --name "D2 100" --layout dense --width 1280 --height 720
Frame math: dense N clips -> (ceil(N/16)-1)*1920+960000 ticks; producer floors /4000 -> see generator output below (brief's "≈240 frames/≈10s" superseded by the formula; seed command unchanged)
Hard rules in force: ONE app instance at a time (phase-per-process, app closed between); NO playback in the interactive window (crash trigger surface); scratch only under E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch

## Launch environment

```
SYSTEMROOT=<windows>
OPENCUT_STORE_ROOT=<per-leg scratch store>
OPENCUT_EXPORT_ROOT=<per-leg scratch exports>
OPENCUT_FFMPEG_PATH=E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe
```
(Playwright layers the Windows essentials; explicit keys win — see D1's probe note. Progress sampled from BOTH the panel DOM and the job record file <exportsRoot>/jobs/<jobId>.json — the manager persists phase+frames after every transition.)

## Leg 3 — RECOVERY run 1 (dense-100): kill mid-render, restart, resume, verify

- open-path save settled before Start: waited 15.1s, thumbnail-save bump observed: yes
- export started; waiting for rendering progress in (0.1, 0.6) (DOM-or-record)
- kill window reached: 27/242 frames (dom source) after 4.2s
- record at rest after kill: phase rendering, acceptedFrames 39 (the boot scan is what interrupts it)
- jobs dir at rest: ["316f08d6-bde9-4877-8819-62764179e88d.json","316f08d6-bde9-4877-8819-62764179e88d.raw"]
- relaunched with the same store + exports roots; open-path save settled: waited 15.1s, thumbnail-save bump observed: yes
- interrupted panel text: "Export×FormatMP4 (H.264) — better compatibilityWebM (VP9) — smaller file sizeQualityLow — smallest file sizeMedium — balancedHigh — recommendedVery high — largest file sizeInclude audio in exportExpor"
- resume clicked; awaiting completion (budget 6600s, dual-source)
- output fingerprint: 77bdbe32ce74048d21821696fdad5981a7bb1a4b5c5447f45341adc5d455e167 / 260216 bytes

```
{
 "streams": [
  {
   "codec_type": "video",
   "codec_name": "h264",
   "width": 1280,
   "height": 720,
   "nb_read_frames": "242",
   "duration": "8.066667"
  },
  {
   "codec_type": "audio",
   "codec_name": "aac",
   "nb_read_frames": "349",
   "duration": "8.096009"
  }
 ],
 "format": {
  "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
  "duration": "8.096009",
  "size": "260216"
 },
 "resumeSeconds": 20.1,
 "killPoint": "27/242",
 "acceptedAtRest": 39
}
```
- resume DOM series:

```
T+       0s  Rendering frames…  16% (39/242)
T+    2.05s  Rendering frames…  19% (45/242)
T+    2.56s  Rendering frames…  21% (51/242)
T+    3.07s  Rendering frames…  24% (57/242)
T+    3.58s  Rendering frames…  26% (63/242)
T+    4.09s  Rendering frames…  29% (69/242)
T+    4.61s  Rendering frames…  31% (75/242)
T+    5.13s  Rendering frames…  33% (81/242)
T+     6.7s  Rendering frames…  41% (99/242)
T+   11.87s  Rendering frames…  67% (162/242)
T+    16.5s  Rendering frames…  92% (222/242)
T+   17.01s  Rendering frames…  94% (228/242)
T+   17.53s  Rendering frames…  97% (234/242)
T+   18.05s  Rendering frames…  100% (242/242)
T+   18.57s  Encoding…  100% (242/242)
T+   19.09s  Encoding…  47% (242/242)
T+   19.61s  Encoding…  100% (242/242)
T+   20.13s  Export complete.  
(37 transitions total)
```
- resume record-file series:

```
T+       0s  rendering  16% (39/242)
T+    2.05s  rendering  19% (45/242)
T+    2.56s  rendering  21% (51/242)
T+    3.07s  rendering  24% (57/242)
T+    3.58s  rendering  26% (63/242)
T+    4.09s  rendering  29% (69/242)
T+    4.61s  rendering  31% (75/242)
T+    5.13s  rendering  33% (81/242)
T+     6.7s  rendering  41% (99/242)
T+   11.87s  rendering  67% (162/242)
T+   15.48s  rendering  86% (207/242)
T+   15.99s  rendering  88% (213/242)
T+    16.5s  rendering  92% (222/242)
T+   17.01s  rendering  94% (228/242)
T+   17.53s  rendering  97% (234/242)
T+   18.05s  rendering  100% (242/242)
T+   18.57s  encoding  0% (242/242)
T+   20.13s  completed  100% (242/242)
(35 transitions total)
```
- jobs dir after resume-settle: ["316f08d6-bde9-4877-8819-62764179e88d.json"] (record kept; raw/wav/partial transients cleaned by the manager)
- exports root deleted after fingerprinting (disk discipline)

## Step 4 — SWEEP: no rocut-wt-export electron/ffmpeg processes remain

- tasklist electron.exe count 7, ffmpeg.exe count 0; CIM command-line matches for "rocut-wt-export": 0

```
(none)
```

```
tasklist electron.exe:
ӳ������                       PID �Ự��              �Ự#       �ڴ�ʹ�� 
========================= ======== ================ =========== ============
electron.exe                 25212 Console                    1    396,956 K
electron.exe                 48956 Console                    1    222,628 K
electron.exe                 54468 Console                    1     59,408 K
electron.exe                 10200 Console                    1     92,244 K
electron.exe                 45104 Console                    1    300,836 K
electron.exe                 26700 Console                    1     98,200 K
electron.exe                 54256 Console                    1    134,948 K

tasklist ffmpeg.exe:
��Ϣ: û�����е�����ƥ��ָ����׼��
```

## Gates (invocation: recovery)

- PASS seed/d2-generate-recovery-1 — generator exit 0, project 345088e3-8daf-4385-ba80-a131223e5af6, timeline 971520 ticks
- PASS recovery-1/killed-tree — taskkill /F /T /PID 73204 exit 0 (windows at kill: 2)
- PASS recovery-1/raw-size-sanity — raw 316f08d6-bde9-4877-8819-62764179e88d.raw size 107827200 vs 39 frames x 2764800 = 107827200 (±10% band)
- PASS recovery-1/interrupted-listed — panel lists 1 interrupted job(s), resume affordance true
- PASS recovery-1/resume-completed — record phase completed after 20.1s; DOM settled "Export complete."
- PASS recovery-1/resume-frames-complete — record frames 242/242 (kill point was 27/242; resume replayed the prefix and finished the tail)
- PASS recovery-1/producer-window-closed — windows after settle: 1 (2 during, 2 at kill)
- PASS recovery-1/output-exists — D2-100-316f08d6.mp4
- PASS recovery-1/one-video-1280x720 — video streams 1, 1280x720 (h264); audio 1
- PASS recovery-1/duration-matches — ffprobe 8.096009s vs expected 8.0667s
- PASS recovery-1/frames-in-band — nb_read_frames 242 in [237, 247]
- PASS sweep/no-strays — none found — nothing to kill
- PASS sweep/no-ffmpeg-anywhere — tasklist ffmpeg.exe count 0 (whole machine; any nonzero row would be named before action)
