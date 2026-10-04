import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';
import { probeCoreInteractions } from './probe-core-interactions.mjs';
import { probeMixedExport } from './probe-mixed-export.mjs';
import { probeExportRecovery } from './probe-export-recovery.mjs';
import { probeEmbeddedLayout } from './probe-embedded-layout.mjs';
import { probeJizuraImport } from './probe-jizura-import.mjs';
import { probeResponsiveMotion } from './probe-responsive-motion.mjs';
import { reloadEditorFrame } from './probe-reload-editor.mjs';
import { probeInstalledPreview } from './probe-installed-preview.mjs';
import { probeVideoFreeze } from './probe-video-freeze.mjs';
import { probeColorAdjustment } from './probe-color-adjustment.mjs';
import { probeTransitionPersistence } from './probe-transition-persistence.mjs';
import { probeVideoSourceLifetime } from './probe-video-source-lifetime.mjs';
import { probeTransitionRender } from './probe-transition-render.mjs';
import { probeMediaImport } from './probe-media-import.mjs';
import { probeAudioFormats } from './probe-audio-formats.mjs';
import { probeMediaMime } from './probe-media-mime.mjs';
import { probeTimelineControls } from './probe-timeline-controls.mjs';

// Run with the Elftia worktree's tsx loader. Never launch a substitute browser.
const hostRoot = resolve(process.env.ELFTIA_WORKTREE ?? '');
assert(process.env.ELFTIA_WORKTREE, 'Set ELFTIA_WORKTREE to the authorized dev worktree');
const sessionId = process.env.ELFTIA_TEST_SESSION;
assert(sessionId, 'Set ELFTIA_TEST_SESSION to an authorized dedicated test session');
await import(pathToFileURL(join(hostRoot, 'packages/elftia-cli/src/proxy.ts')).href);
const { connect } = await import(pathToFileURL(join(hostRoot, 'packages/elftia-cli/src/connect.ts')).href);
const conn = await connect({mode:'attach', port:Number(process.env.ELFTIA_CLI_DEBUG_PORT ?? 9333)});
const evidenceRoot = join(hostRoot, '.tmp-rocut-e2e');
mkdirSync(evidenceRoot, {recursive:true});
const work = mkdtempSync(join(evidenceRoot, 'live-'));
const evidence = {kind:'real-elftia', fixtureSetup:'host preload API, not project-creation UI acceptance', checks:[], errors:[], requests:[]};
const scrub = value => String(value).replace(/(https?:\/\/(?:127\.0\.0\.1|localhost):\d+)\/[^\s/]+/g,'$1/[redacted]');
let phase = 'ownership';
let editor;
let nativeAudioCdp;
const previousViewport = conn.page.viewportSize();
try {
  const ownership = await conn.page.evaluate(async id => {
    const session = await window.native.sessions.chat.get(id);
    return {active:document.querySelector('[data-session-active="true"]')?.getAttribute('data-session-id'), folder:session.projectPath};
  },sessionId);
  assert.equal(ownership.active,sessionId);
  assert.equal(resolve(ownership.folder),join(evidenceRoot,'project'),'Only the dedicated test workspace may be mutated');
  // CDP metrics can stall Electron's realtime audio clock on this host.
  // Use native metrics for audio measurements; fixed metrics remain useful
  // for gesture/layout fixtures. Finally restores the previous host metrics.
  const nativeAudio = ['--audio-formats-only', '--media-mime-only', '--timeline-controls-only'].some(flag=>process.argv.includes(flag));
  if (nativeAudio) {
    nativeAudioCdp = await conn.context.newCDPSession(conn.page);
    await nativeAudioCdp.send('Emulation.clearDeviceMetricsOverride');
  } else await conn.page.setViewportSize({width:1280,height:900});
  evidence.viewportMode = nativeAudio ? 'native-audio' : 'emulated-interactions';
  const frames = conn.page.frames();
  for (const frame of frames) if ((await frame.title().catch(()=>'' )).startsWith('OpenCut editor')) editor=frame;
  assert(editor,'Open Rocut in the authorized Elftia session before this probe');
  const project = await conn.page.evaluate(async ({folder,name}) => {
    const created = await window.native.toolHosts.createProject({toolId:'rocut',workingFolder:folder,name});
    const opened = await window.native.toolHosts.openProject({toolId:'rocut',workingFolder:folder,projectPath:created.path});
    return {path:created.path,url:opened.editorUrl};
  },{folder:ownership.folder,name:'live-'+Date.now()});
  assert(resolve(project.path).startsWith(resolve(ownership.folder)+'/') || resolve(project.path).startsWith(resolve(ownership.folder)+'\\'));
  evidence.projectPath=project.path;
  // Reopen through the real workspace button: host URL/theme ownership must
  // follow the fixture too, not just a navigation of its existing iframe.
  await conn.page.locator('[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]').click();
  await conn.page.locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]').click();
  await expect.poll(async () => {
    for (const frame of conn.page.frames()) {
      if (frame.url() === project.url) { editor=frame; return true; }
    }
    return false;
  }, {timeout:30000}).toBe(true);
  await editor.locator('[aria-label="Media"]').waitFor({timeout:30000});
  assert(await editor.evaluate(()=>isSecureContext && typeof VideoDecoder !== 'undefined'));
  evidence.checks.push({name:'real Elftia iframe loaded with WebCodecs',pass:true});
  const readRecord=()=>editor.evaluate(async()=> (await (await fetch(new URL('api/record',location.href))).json()).record);
  assert.equal((await readRecord()).data.motionTextSequences?.length ?? 0,0);
  // Frame operations use the parent page's real input devices; never dispatch fake events.
  const page = new Proxy(editor, {get(target,key) {
    if (key==='keyboard' || key==='mouse') return conn.page[key];
    if (key==='screenshot') return options=>conn.page.screenshot(options);
    if (key==='reload') return ()=>reloadEditorFrame(target);
    const value=target[key]; return typeof value==='function'?value.bind(target):value;
  }});
  conn.page.on('pageerror',error=>evidence.errors.push(scrub(error.message)));
  if (['--adjustment-only', '--transition-render-only', '--transition-authoring-only', '--transition-image-authoring-only'].some(flag => process.argv.includes(flag))) conn.page.on('console', message => {
    if (message.type() === 'error' && /Failed to render preview frame|Validation Error/.test(message.text())) evidence.errors.push(scrub(message.text()));
  });
  // Safe transaction summaries distinguish a dropped shortcut from stale persistence.
  evidence.recordWrites=[];
  conn.page.on('request',request=>{
    if(request.method()!=='PUT'||!request.url().endsWith('/api/record'))return;
    const data=request.postDataJSON()?.record?.data;
    evidence.recordWrites.push({phase,revision:data?.__opencutTransaction?.revision,sequences:data?.motionTextSequences?.map(s=>({revision:s.revision,beatOverride:s.audioBinding?.beatOverride}))});
  });
  // Electron may handle beforeunload before the CDP acknowledgement returns.
  // Handle it explicitly so Playwright does not create an unhandled auto-dismiss.
  conn.page.on('dialog', dialog=>{
    void dialog.accept().catch(error=>{
      evidence.errors.push(scrub(error.message));
    });
  });
  conn.page.on('response',response=>{if(response.status()>=400 && response.url().includes('/api/')) evidence.requests.push({phase,status:response.status(),url:scrub(response.url())});});
  const audioFixture=join(work,'fixture-tone-a4.wav');
  execFileSync('ffmpeg',['-v','error','-n','-f','lavfi','-i','sine=frequency=440:duration=16','-ar','44100','-ac','1','-c:a','pcm_s16le',audioFixture],{windowsHide:true});
  if (process.argv.includes('--timeline-controls-only')) {
    await probeTimelineControls({page,hostPage:conn.page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--media-mime-only')) {
    await probeMediaMime({page,hostPage:conn.page,work,evidence,reopenAudio:process.argv.includes('--reopen-mime-audio'),preparePlayback:()=>nativeAudioCdp.send('Emulation.clearDeviceMetricsOverride'),onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--audio-formats-only')) {
    await probeAudioFormats({page,hostPage:conn.page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--media-import-only')) {
    await probeMediaImport({page,hostPage:conn.page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--transition-render-only') || process.argv.includes('--transition-authoring-only') || process.argv.includes('--transition-image-authoring-only')) {
    await probeTransitionRender({page,project:project.path,work,evidence,authorUi:!process.argv.includes('--transition-render-only'),mediaKind:process.argv.includes('--transition-image-authoring-only')?'image':'video',onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--source-lifetime-only')) {
    await probeVideoSourceLifetime({page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--transition-persistence-only')) {
    await probeTransitionPersistence({page,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--adjustment-only')) {
    await probeColorAdjustment({page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else if (process.argv.includes('--freeze-only')) {
    await probeVideoFreeze({page,project:project.path,work,evidence,onPhase:next=>{phase=next;console.log('phase:',phase);}});
  } else {
  phase='core interactions';
  await probeCoreInteractions({page,evidence,work,audioFixture,flags:process.argv,onPhase:next=>{
    phase=next; console.log('phase:',phase);
    writeFileSync(join(work,'evidence.json'),JSON.stringify({...evidence,phase},null,2));
  }});
  phase='installed preview'; console.log('phase:',phase);
  await probeInstalledPreview(conn.page,editor,work,evidence);
  if(process.argv.includes('--export-recovery')) {phase='export recovery'; console.log('phase:',phase); await probeExportRecovery(editor,project.path,evidence);}
  if(process.argv.includes('--mixed-export') || process.argv.includes('--export-recovery')) {phase='mixed export'; console.log('phase:',phase); await probeMixedExport(editor,project.path,evidence);}
  if(process.argv.includes('--jizura-import')) {phase='JIZURA import'; console.log('phase:',phase); await probeJizuraImport(conn.page,editor,evidence);}
  if(process.argv.includes('--responsive')) {phase='responsive'; console.log('phase:',phase); await probeResponsiveMotion(conn.page,editor,work,evidence);}
  if(process.argv.includes('--layout')) {phase='embedded layout'; console.log('phase:',phase); await probeEmbeddedLayout(conn.page,editor,work,evidence);}
  }
  assert.equal(evidence.errors.length,0,'Real-host run must not report uncaught page/driver errors');
  const unexpectedRequests=evidence.requests.filter(request=>!(request.status===404 &&
    ['/api/library/graph-editor-presets/user-presets','/api/library/saved-sounds/user-sounds'].some(path=>request.url.endsWith(path))));
  assert.equal(unexpectedRequests.length,0,'Unexpected failed host API requests: '+JSON.stringify(unexpectedRequests));
  await conn.page.screenshot({path:join(work,'complete.png')});
  evidence.passed=true;
} catch(error) {
  evidence.passed=false;
  evidence.failure={phase,message:scrub(error.stack??error)};
  await conn.page.screenshot({path:join(work,'failure.png')}).catch(()=>{});
  console.error('FAILED',phase,scrub(error.message));
  process.exitCode=1;
} finally {
  await nativeAudioCdp?.detach().catch(()=>{});
  if(previousViewport) await conn.page.setViewportSize(previousViewport).catch(()=>{});
  else {
    const cdp=await conn.context.newCDPSession(conn.page);
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.detach();
  }
  writeFileSync(join(work,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({work,passed:evidence.passed,checks:evidence.checks.length,phase}));
  await conn.close();
}
