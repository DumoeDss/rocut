/** Wrap only the native element ref, never reimplement Sequence/trim/rate/loop
 * timing. The upstream rendering component still owns seek and delayRender.
 */
export const REMOTION_MEDIA_WRAPPER = String.raw`
import React from 'react';
export const Html5Video = React.forwardRef((props, ref) => {
  const {durations, setDurations} = React.useContext(NativeDurationsContext);
  // A fresh page may start beyond trimAfter: upstream would unmount the video
  // before learning its duration, so its native loop could never initialize.
  // Preload only metadata and feed the original context; do not warm up the
  // author's composition at frame zero or reimplement loop/time arithmetic.
  React.useLayoutEffect(() => {
    if (durations[props.src] !== undefined) return;
    const handle = nativeDelayRender('Rocut native video metadata');
    const controller = new AbortController(), video = document.createElement('video');
    video.muted = true; video.preload = 'metadata'; video.src = props.src;
    const media = window.rocutRemotionAudio?.analysisOnly ? window.rocutRemotionAudio : window.rocutMedia;
    media.metadata(video, controller.signal).then(duration => {
      setDurations({type:'got-duration',src:props.src,durationInSeconds:duration});
      nativeContinueRender(handle);
    }).catch(error => { if (!controller.signal.aborted) nativeCancelRender(error); });
    return () => {
      controller.abort(); video.removeAttribute('src'); video.load();
      nativeContinueRender(handle);
    };
  }, [props.src, setDurations]);
  const attach = React.useCallback(video => {
    if (window.rocutRemotionAudio?.enabled) window.rocutRemotionAudio.registerElement(video);
    if (!window.rocutRemotionAudio?.analysisOnly) window.rocutMedia.registerNative(video);
    if (typeof ref === 'function') ref(video);
    else if (ref) ref.current = video;
  }, [ref]);
  if (typeof props.src !== 'string') throw Error('Native Html5Video requires a string src');
  if (!props.muted && !window.rocutRemotionAudio?.enabled) throw Error('HTML video must be explicitly muted; use Rocut audio tracks');
  if (durations[props.src] === undefined) return null;
  return React.createElement(NativeHtml5Video, {...props, ref:attach});
});
export const Video = Html5Video;
const AnalyzedAudio = React.forwardRef((props, ref) => {
  const {durations, setDurations} = React.useContext(NativeDurationsContext);
  React.useLayoutEffect(() => {
    if (durations[props.src] !== undefined) return;
    const handle = nativeDelayRender('Rocut native audio metadata');
    const controller = new AbortController(), audio = document.createElement('audio');
    audio.muted = true; audio.preload = 'metadata'; audio.src = props.src;
    window.rocutRemotionAudio.metadata(audio, controller.signal).then(duration => {
      setDurations({type:'got-duration',src:props.src,durationInSeconds:duration});
      nativeContinueRender(handle);
    }).catch(error => { if (!controller.signal.aborted) nativeCancelRender(error); });
    return () => { controller.abort(); audio.removeAttribute('src'); audio.load(); nativeContinueRender(handle); };
  }, [props.src, setDurations]);
  const attach = React.useCallback(audio => {
    window.rocutRemotionAudio.registerElement(audio);
    if (typeof ref === 'function') ref(audio);
    else if (ref) ref.current = audio;
  }, [ref]);
  if (typeof props.src !== 'string') throw Error('Native Html5Audio requires a string src');
  if (durations[props.src] === undefined) return null;
  return React.createElement(NativeHtml5Audio, {...props, ref:attach});
});
export const Html5Audio = React.forwardRef((props, ref) => React.createElement(
  window.rocutRemotionAudio?.enabled ? AnalyzedAudio : NativeHtml5Audio, {...props, ref}
));
export const Audio = Html5Audio;
export function OffthreadVideo(props) {
  if (window.rocutRemotionAudio?.analysisOnly) return React.createElement(NativeOffthreadVideo, props);
  if (!window.rocutOffthread?.available) throw Error('Remotion OffthreadVideo requires the native frame bridge on this backend');
  if (!props.muted && !window.rocutRemotionAudio?.enabled) throw Error('OffthreadVideo must be explicitly muted; use Rocut audio tracks');
  return React.createElement(NativeOffthreadVideo, props);
}
`;
