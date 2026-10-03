mod frame_rate;
mod media_time;
mod timecode;
mod transition;
mod video_time;

pub use transition::{
    ClipTransitionOptions, ClipTransitionPlan, ClipTransitionSample, ClipTransitionWindow,
    TransitionClip, TransitionPlanError, TransitionSource, plan_clip_transition,
};

pub use video_time::{
    VideoFreezeFrameOptions, VideoSourceTimeOptions, plan_video_freeze_frame,
    resolve_video_source_time,
};

pub use frame_rate::FrameRate;
pub use media_time::{
    FloorToFrameOptions, IsFrameAlignedOptions, LastFrameTimeOptions, MediaTime,
    MediaTimeAddOptions, MediaTimeClampOptions, MediaTimeFromFrameOptions,
    MediaTimeFromSecondsOptions, MediaTimeMaxOptions, MediaTimeMinOptions, MediaTimeRangeError,
    MediaTimeRangeValidation, MediaTimeSubOptions, MediaTimeToFrameOptions,
    MediaTimeToSecondsOptions, RoundToFrameOptions, SnappedSeekTimeOptions, TICKS_PER_SECOND,
    ValidateMediaTimeRangeOptions, floor_to_frame, is_frame_aligned, last_frame_time,
    media_time_add, media_time_clamp, media_time_from_frame, media_time_from_seconds,
    media_time_max, media_time_min, media_time_sub, media_time_to_frame, media_time_to_seconds,
    round_to_frame, snapped_seek_time, validate_media_time_range,
};
pub use timecode::{
    FormatTimecodeOptions, GuessTimecodeFormatOptions, ParseTimecodeOptions, TimeCodeFormat,
    format_timecode, guess_timecode_format, parse_timecode,
};
