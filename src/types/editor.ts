export type MediaType = 'video' | 'audio' | 'image' | 'title' | 'matte' | 'adjustment' | 'nested';

export type TrackType = 'video' | 'audio';

export type ToolMode = 'select' | 'ripple' | 'roll' | 'slip' | 'slide' | 'razor' | 'text' | 'hand';

export type WorkspaceMode = 'Assembly' | 'Editing' | 'Color' | 'Audio' | 'Effects' | 'Captions';

export type BinTab = 'project' | 'effects' | 'transitions' | 'titles';

export type InspectorTab = 'motion' | 'color' | 'audio' | 'graphics' | 'ai' | 'review';

export type MonitorInteractionMode = 'none' | 'chroma-eyedropper' | 'chroma-add-color' | 'chroma-region';

export type TransitionType =
  | 'none'
  | 'cross-dissolve'
  | 'dip-to-black'
  | 'dip-to-white'
  | 'slide-left'
  | 'wipe-right'
  | 'zoom-in'
  | 'morph-cut';

export type BlendMode = 'source-over' | 'screen' | 'multiply' | 'overlay' | 'lighten' | 'darken';

export type ClipLabelColor = 'blue' | 'teal' | 'violet' | 'amber' | 'rose' | 'forest';

export type KeyframeEasing = 'linear' | 'ease-in' | 'ease-out' | 'bezier';

export interface Keyframe {
  id: string;
  time: number; // seconds relative to clip start
  value: number;
  easing: KeyframeEasing;
}

export type KeyframeProperty =
  | 'transform.x'
  | 'transform.y'
  | 'transform.scale'
  | 'transform.rotation'
  | 'transform.opacity'
  | 'audio.volume'
  | 'color.exposure';

export interface MediaBinFolder {
  id: string;
  name: string;
}

export interface MediaAsset {
  id: string;
  name: string;
  type: MediaType;
  src: string;
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
  waveform?: number[];
  thumbnailUrl?: string;
  matteColor?: string;
  motionPreset?: 'none' | 'slow-zoom-in' | 'slow-pan-right' | 'slow-pan-left' | 'subtle-drift';
  isSample?: boolean;
  binId?: string;
  label?: ClipLabelColor;
  proxyEnabled?: boolean;
  tags?: string[];
  notes?: string;
  multicamGroup?: string;
  nestedClips?: TimelineClip[];
  defaultColorGrade?: Partial<ColorGradeConfig>;
  defaultTransform?: Partial<TransformConfig>;
}

export interface TransformConfig {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  anchorX: number;
  anchorY: number;
  flipH: boolean;
  blendMode: BlendMode;
}

export interface ColorWheelValue {
  x: number; // -1..1
  y: number; // -1..1
  luma: number; // -50..50
}

export interface ColorGradeConfig {
  presetId: string;
  customLutName?: string;
  customLutData?: { size: number; table: Float32Array };
  exposure: number; // -100..100
  contrast: number; // -100..100
  highlights: number; // -100..100
  shadows: number; // -100..100
  saturation: number; // -100..100
  vibrance: number; // -100..100
  temperature: number; // -100..100
  tint: number; // -100..100
  hue: number; // -180..180
  blur: number; // 0..30 px
  vignette: number; // 0..100
  grain: number; // 0..100
  wheels: {
    shadows: ColorWheelValue;
    midtones: ColorWheelValue;
    highlights: ColorWheelValue;
  };
  hslSecondary?: {
    enabled: boolean;
    targetHue: number; // 0..360
    hueRange: number; // 10..90
    satShift: number; // -100..100
    lumaShift: number; // -50..50
  };
  curvePoints?: number[]; // 5-point RGB luma curve [0, 0.25, 0.5, 0.75, 1]
}

export interface VfxConfig {
  directionalBlurAngle: number;
  directionalBlurAmount: number; // 0..30
  motionBlur: number; // 0..100
  sharpen: number; // 0..100
  glow: number; // 0..100
  chromaticAberration: number; // 0..20 px
  lensDistortion: number; // -50..50
  stabilize: boolean;
  frameBlending: boolean;
  dropShadow: {
    enabled: boolean;
    offsetX: number;
    offsetY: number;
    blur: number;
    color: string;
  };
  chromaKey: {
    enabled: boolean;
    color: string;
    additionalColors?: string[];
    similarity: number; // 5..85
    smoothness: number; // 0..40
    spillReduction: number; // 0..100
    invert?: boolean;
    mattePreview?: boolean;
    region?: {
      enabled: boolean;
      x: number; // 0..100 (% left)
      y: number; // 0..100 (% top)
      width: number; // 1..100 (% width)
      height: number; // 1..100 (% height)
      feather: number; // 0..25 (%)
    };
  };
  lumaKey: {
    enabled: boolean;
    threshold: number; // 0..100
    cutoffMode: 'dark' | 'bright';
  };
  mask: {
    enabled: boolean;
    shape: 'rectangle' | 'ellipse';
    x: number; // -50..50 (% of frame)
    y: number;
    width: number; // 10..100 (%)
    height: number; // 10..100 (%)
    feather: number; // 0..60 px
    expansion: number; // -30..30 %
    inverted: boolean;
  };
}

export interface AudioConfig {
  volume: number; // 0..200 (%)
  pan: number; // -100..100
  fadeIn: number;
  fadeOut: number;
  muted: boolean;
  essentialCategory?: 'dialogue' | 'music' | 'sfx' | 'ambience';
  enhanceSpeech: boolean;
  autoDuckMusic: boolean;
  normalizePeak: boolean;
  eqLow: number; // -12..12 dB
  eqMid: number; // -12..12 dB
  eqHigh: number; // -12..12 dB
  compressor: number; // 0..100%
  reverb: number; // 0..100%
  delay: number; // 0..100%
  noiseReduction: number; // 0..100%
}

export interface TextConfig {
  text: string;
  subtitle?: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: '400' | '500' | '600' | '700';
  color: string;
  gradientEnabled?: boolean;
  gradientEndColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  shadowEnabled?: boolean;
  bgColor: string;
  bgOpacity: number;
  align: 'left' | 'center' | 'right';
  letterSpacing: number;
  layout: 'center-title' | 'lower-third' | 'caption' | 'editorial-card' | 'shape-rect' | 'shape-circle';
  animation?: 'none' | 'fade-up' | 'typewriter' | 'scale-pop' | 'slide-in';
}

export interface TransitionConfig {
  type: TransitionType;
  duration: number;
}

export interface ClipMarker {
  id: string;
  time: number; // relative to timeline
  label: string;
  color: ClipLabelColor;
  notes?: string;
}

export interface TimelineClip {
  id: string;
  assetId: string;
  trackId: string;
  name: string;
  type: MediaType;
  start: number;
  duration: number;
  inPoint: number;
  speed: number;
  reversed: boolean;
  disabled: boolean;
  freezeFrame?: boolean;
  label?: ClipLabelColor;
  groupId?: string;
  linkedClipId?: string;
  multicamAngles?: string[]; // asset IDs for multicam switching
  activeAngleIndex?: number;
  transform: TransformConfig;
  color: ColorGradeConfig;
  vfx: VfxConfig;
  audio: AudioConfig;
  text?: TextConfig;
  transitionIn: TransitionConfig;
  transitionOut: TransitionConfig;
  keyframes?: Partial<Record<KeyframeProperty, Keyframe[]>>;
}

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  visible: boolean;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  targeted?: boolean;
  height: number;
  gain?: number; // 0..150%
  pan?: number; // -100..100
}

export interface SequenceSettings {
  name: string;
  width: number;
  height: number;
  fps: number;
  aspectPreset: '16:9-hd' | '16:9-4k' | '9:16-vertical' | '1:1-square' | '4:5-social';
  colorSpace: 'Rec.709' | 'Rec.2100 HLG' | 'S-Log3';
  hdrMode: boolean;
  proxyMode: boolean;
}

export interface CaptionSegment {
  id: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
  hasFiller?: boolean;
}

export interface ReviewComment {
  id: string;
  time: number;
  author: string;
  text: string;
  resolved: boolean;
  createdAt: string;
}

export interface ProjectVersion {
  id: string;
  name: string;
  createdAt: string;
  tracks: Track[];
  clips: TimelineClip[];
}

export type ExportDestination = 'download' | 'youtube' | 'youtube-shorts' | 'tiktok';

export interface ExportSettings {
  filename: string;
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
  bitrateMode: 'vbr' | 'cbr';
  range: 'entire' | 'in-out';
  format: 'mp4-h264' | 'webm-vp9' | 'webm-vp8' | 'wav-audio' | 'png-frame' | 'srt-captions' | 'edl-cmx3600' | 'xml-fcpxml';
  destination?: ExportDestination;
  publishTitle?: string;
  publishDescription?: string;
  hashtags?: string;
  privacyStatus?: 'public' | 'unlisted' | 'private';
  presetLabel?: string;
}

export interface RenderQueueJob {
  id: string;
  settings: ExportSettings;
  status: 'queued' | 'rendering' | 'done' | 'error';
  progress: number;
  downloadUrl?: string;
  error?: string;
}

export interface EditorSnapshot {
  tracks: Track[];
  clips: TimelineClip[];
  markers: ClipMarker[];
  captions: CaptionSegment[];
}
