/** Pinned in-memory observation hooks; no native seek/readiness fix. */
export const REMOTION_NATIVE_VIDEO_PATCH_SOURCE = String.raw`
function rocutPatchNativeVideoObservation(native) {
  const start = native.indexOf('var roundTo6Commas = ');
  const end = native.indexOf('\nvar VideoForRendering = ', start);
  if (start < 0 || end < start || native.split('var roundTo6Commas = ').length !== 2 ||
      native.split('\nvar VideoForRendering = ').length !== 2) throw Error('Pinned Remotion native video observer section changed');
  let section = native.slice(start, end);
  const replace = (before, after, count = 1) => {
    if (section.split(before).length !== count + 1) throw Error('Pinned Remotion native video observer seam changed');
    section = section.split(before).join(after);
  };
  const observe = (kind, element, values = '{}', metadata = 'undefined') =>
    'rocutObserveNativeVideo('+JSON.stringify(kind)+','+element+','+values+','+metadata+');';
  replace('  if (isApproximatelyTheSame(element.currentTime, desiredTime)) {',
    '  const rocutObservedCurrentTime = element.currentTime;\n  '+observe('seek-request','element','{currentTime:rocutObservedCurrentTime,target:desiredTime}')+
    '\n  if (isApproximatelyTheSame(rocutObservedCurrentTime, desiredTime)) {\n    '+observe('seek-equal-return','element','{target:desiredTime}'));
  replace('  seek({\n    logLevel,', '  '+observe('seek-command','element','{target:desiredTime}')+'\n  seek({\n    logLevel,');
  replace('      const displayIn = metadata.expectedDisplayTime - now;',
    '      const rocutExpectedDisplayTime = metadata.expectedDisplayTime;\n      const displayIn = rocutExpectedDisplayTime - now;\n      '+
    observe('seek-rvfc','element','{callbackNow:now,expectedDisplayTime:rocutExpectedDisplayTime,displayIn}'));
  replace('        resolve(metadata.mediaTime);',
    '        const rocutPresentedMediaTime = metadata.mediaTime;\n        '+observe('seek-presented-release','element','{mediaTime:rocutPresentedMediaTime}', 'metadata')+
    '\n        resolve(rocutPresentedMediaTime);', 2);
  replace('      setTimeout(() => {', '      '+observe('seek-display-delay','element','{displayIn}')+'\n      setTimeout(() => {');
  replace('    const onDone = () => {\n      resolve();', '    const onDone = () => {\n      '+observe('seeked','element')+'\n      resolve();');
  replace('      cancelSeeked?.();', '      '+observe('seek-cancel','element')+'\n      cancelSeeked?.();');
  replace('  if (Number.isFinite(element.duration) && element.currentTime >= element.duration && desiredTime >= element.duration) {',
    '  if (Number.isFinite(element.duration) && element.currentTime >= element.duration && desiredTime >= element.duration) {\n    '+observe('attempt-duration-return','element','{target:desiredTime,threshold}'));
  replace('    const firstSeek = seekToTime({', '    '+observe('attempt-start','element','{attempt:1,target:desiredTime,threshold}')+'\n    const firstSeek = seekToTime({');
  replace('      const difference = Math.abs(desiredTime - seekedTo);',
    '      const difference = Math.abs(desiredTime - seekedTo);\n      '+observe('attempt-result','element','{attempt:1,target:desiredTime,mediaTime:seekedTo,threshold,difference,withinThreshold:difference <= threshold}'));
  replace('      const newSeek = seekToTime({', '      '+observe('attempt-start','element','{attempt:2,target:desiredTime,threshold}')+'\n      const newSeek = seekToTime({');
  replace('        const newDifference = Math.abs(desiredTime - newTime);',
    '        const newDifference = Math.abs(desiredTime - newTime);\n        '+observe('attempt-result','element','{attempt:2,target:desiredTime,mediaTime:newTime,threshold,difference:newDifference}'));
  replace('        const thirdSeek = seekToTime({', '        '+observe('attempt-start','element','{attempt:3,target:desiredTime,threshold}')+'\n        const thirdSeek = seekToTime({');
  replace('        return thirdSeek.wait.then(() => {\n          resolve();',
    '        return thirdSeek.wait.then((rocutThirdTime) => {\n          '+observe('attempt-result','element','{attempt:3,target:desiredTime,mediaTime:rocutThirdTime,threshold}')+'\n          resolve();');
  replace('      currentCancel();', '      '+observe('attempt-cancel','element')+'\n      currentCancel();');
  replace('    const handle = delayRender2('+String.fromCharCode(96)+'Rendering',
    '    '+observe('effect-target','current','{target:currentTime,frame,absoluteFrame,mediaStartsAt,playbackRate}', 'videoConfig')+'\n    const handle = delayRender2('+String.fromCharCode(96)+'Rendering');
  replace('    if (window.process?.env?.NODE_ENV === "test") {\n      continueRender2(handle);',
    '    '+observe('effect-handle','current','{handle}')+'\n    if (window.process?.env?.NODE_ENV === "test") {\n      '+observe('effect-test-release','current','{handle}')+'\n      continueRender2(handle);');
  replace('      if (current.readyState >= 2) {\n        continueRender2(handle);',
    '      if (current.readyState >= 2) {\n        '+observe('effect-equal-ready-release','current','{handle}')+'\n        continueRender2(handle);');
  replace('      const loadedDataHandler = () => {\n        continueRender2(handle);',
    '      const loadedDataHandler = () => {\n        '+observe('effect-loadeddata-release','current','{handle}')+'\n        continueRender2(handle);');
  replace('        current.removeEventListener("loadeddata", loadedDataHandler);',
    '        '+observe('effect-loadeddata-cleanup','current','{handle}')+'\n        current.removeEventListener("loadeddata", loadedDataHandler);');
  replace('    const endedHandler = () => {\n      continueRender2(handle);',
    '    const endedHandler = () => {\n      '+observe('effect-ended-release','current','{handle}')+'\n      continueRender2(handle);');
  replace('    seek2.prom.then(() => {\n      continueRender2(handle);',
    '    seek2.prom.then(() => {\n      '+observe('effect-seek-success-release','current','{handle}')+'\n      continueRender2(handle);');
  replace('      seek2.cancel();', '      '+observe('effect-cleanup-release','current','{handle}')+'\n      seek2.cancel();');
  const bridge = '\nfunction rocutObserveNativeVideo(kind,element,values,metadata) {try {const descriptor=Object.getOwnPropertyDescriptor(window,"__rocutRemotionNativeVideoObserve");if(descriptor && "value" in descriptor && typeof descriptor.value === "function")descriptor.value(kind,element,values,metadata);}catch{}}\n';
  return native.slice(0,start) + bridge + section + native.slice(end);
}
`;
