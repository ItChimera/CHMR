import {
  AudioConfig,
  CaptionSegment,
  ClipMarker,
  ColorGradeConfig,
  MediaAsset,
  MediaBinFolder,
  ReviewComment,
  TimelineClip,
  Track,
  TransformConfig,
  TransitionType,
  VfxConfig,
} from '../types/editor';

export interface ColorPreset {
  id: string;
  name: string;
  subtitle: string;
  swatch: [string, string, string];
  grade: Partial<ColorGradeConfig>;
}

export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: 'natural',
    name: 'Rec.709 Natural',
    subtitle: 'Balanced neutral baseline',
    swatch: ['#334155', '#64748B', '#E2E8F0'],
    grade: { exposure: 0, contrast: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, highlights: 0, shadows: 0 },
  },
  {
    id: 'teal-orange',
    name: 'Teal & Amber',
    subtitle: 'Cinema blockbuster grade',
    swatch: ['#0F766E', '#1E293B', '#D97706'],
    grade: { exposure: 4, contrast: 18, saturation: 14, vibrance: 18, temperature: 16, hue: -8 },
  },
  {
    id: 'noir',
    name: 'Silver Noir',
    subtitle: 'High-contrast monochrome',
    swatch: ['#09090B', '#3F3F46', '#F4F4F5'],
    grade: { exposure: -4, contrast: 38, saturation: -100, temperature: 0, hue: 0 },
  },
  {
    id: 'kodak',
    name: 'Warm 2383 Print',
    subtitle: 'Golden film emulsion',
    swatch: ['#78350F', '#B45309', '#FDE68A'],
    grade: { exposure: 6, contrast: 12, saturation: 18, temperature: 28, hue: 4 },
  },
  {
    id: 'nordic-cool',
    name: 'Nordic Slate',
    subtitle: 'Crisp cool shadows',
    swatch: ['#0F172A', '#1E3A8A', '#93C5FD'],
    grade: { exposure: -2, contrast: 15, saturation: -18, temperature: -26, hue: 6 },
  },
  {
    id: 'bleach-bypass',
    name: 'Bleach Bypass',
    subtitle: 'Desaturated gritty punch',
    swatch: ['#18181B', '#52525B', '#A1A1AA'],
    grade: { exposure: -6, contrast: 42, saturation: -48, temperature: -6, hue: 0 },
  },
  {
    id: 'hdr-cinema',
    name: 'HDR Wide Gamut',
    subtitle: 'Expanded highlight & shadow rolloff',
    swatch: ['#0284C7', '#0F172A', '#F59E0B'],
    grade: { exposure: 5, contrast: 22, highlights: -24, shadows: 22, vibrance: 26 },
  },
  {
    id: 'log-to-709',
    name: 'Log-to-Rec.709',
    subtitle: 'Standard camera log normalization',
    swatch: ['#475569', '#1E293B', '#CBD5E1'],
    grade: { exposure: 2, contrast: 28, saturation: 22, shadows: -12, highlights: -10 },
  },
];

export interface VideoEffectDef {
  id: string;
  name: string;
  category: 'Blur & Sharpen' | 'Color' | 'Keying' | 'Distort & Optics' | 'Stylize' | 'Time & Stabilize';
  description: string;
  apply: (clip: TimelineClip) => Partial<TimelineClip>;
}

const EFFECT_CATEGORIES: Array<{
  category: VideoEffectDef['category'];
  items: Array<{ id: string; name: string; desc: string; apply: (c: TimelineClip) => Partial<TimelineClip> }>;
}> = [
  {
    category: 'Blur & Sharpen',
    items: [
      { id: 'gaussian-blur', name: 'Gaussian Blur', desc: 'Smooth omnidirectional optical defocus', apply: (c) => ({ color: { ...c.color, blur: Math.min(30, c.color.blur + 6) } }) },
      { id: 'directional-blur', name: 'Directional Blur', desc: 'Linear streaking blur at custom angle', apply: (c) => ({ vfx: { ...c.vfx, directionalBlurAmount: 10, directionalBlurAngle: 0 } }) },
      { id: 'motion-blur', name: 'Pixel Motion Blur', desc: 'Shutter-angle kinetic blur', apply: (c) => ({ vfx: { ...c.vfx, motionBlur: 45 } }) },
      { id: 'unsharp-mask', name: 'Unsharp Mask / Sharpen', desc: 'Crisp edge micro-contrast boost', apply: (c) => ({ vfx: { ...c.vfx, sharpen: Math.min(100, c.vfx.sharpen + 45) } }) },
      { id: 'rack-focus', name: 'Soft Rack Defocus', desc: 'Dreamy shallow-depth blur', apply: (c) => ({ color: { ...c.color, blur: 4 }, vfx: { ...c.vfx, glow: 25 } }) },
    ],
  },
  {
    category: 'Keying',
    items: [
      { id: 'ultra-key-green', name: 'Ultra Key (Green Screen)', desc: 'Chroma key green backdrop removal', apply: (c) => ({ vfx: { ...c.vfx, chromaKey: { ...c.vfx.chromaKey, enabled: true, color: '#00CC44', similarity: 42 } } }) },
      { id: 'ultra-key-blue', name: 'Ultra Key (Blue Screen)', desc: 'Chroma key blue studio backdrop removal', apply: (c) => ({ vfx: { ...c.vfx, chromaKey: { ...c.vfx.chromaKey, enabled: true, color: '#0055FF', similarity: 42 } } }) },
      { id: 'luma-key-dark', name: 'Luma Key (Knockout Blacks)', desc: 'Transparent dark luminance matte', apply: (c) => ({ vfx: { ...c.vfx, lumaKey: { enabled: true, threshold: 20, cutoffMode: 'dark' } } }) },
      { id: 'luma-key-bright', name: 'Luma Key (Knockout Whites)', desc: 'Transparent bright highlight matte', apply: (c) => ({ vfx: { ...c.vfx, lumaKey: { enabled: true, threshold: 82, cutoffMode: 'bright' } } }) },
      { id: 'ellipse-mask', name: 'Ellipse Vignette Mask', desc: 'Feathered oval subject isolation', apply: (c) => ({ vfx: { ...c.vfx, mask: { ...c.vfx.mask, enabled: true, shape: 'ellipse', feather: 24 } } }) },
      { id: 'rect-mask', name: 'Widescreen Split Mask', desc: 'Rectangular crop & mask region', apply: (c) => ({ vfx: { ...c.vfx, mask: { ...c.vfx.mask, enabled: true, shape: 'rectangle', width: 50, x: -25, feather: 4 } } }) },
    ],
  },
  {
    category: 'Stylize',
    items: [
      { id: 'vignette-soft', name: 'Lumetri Vignette', desc: 'Soft darkened frame corners', apply: (c) => ({ color: { ...c.color, vignette: Math.min(100, c.color.vignette + 45) } }) },
      { id: 'film-grain', name: '35mm Film Grain', desc: 'Analog celluloid emulsion texture', apply: (c) => ({ color: { ...c.color, grain: Math.min(100, c.color.grain + 42) } }) },
      { id: 'halation-glow', name: 'Cine Bloom & Glow', desc: 'Luminous highlight halation', apply: (c) => ({ vfx: { ...c.vfx, glow: Math.min(100, c.vfx.glow + 45) } }) },
      { id: 'drop-shadow', name: 'Drop Shadow', desc: 'Soft depth shadow for PiP & titles', apply: (c) => ({ vfx: { ...c.vfx, dropShadow: { ...c.vfx.dropShadow, enabled: true } } }) },
      { id: 'anamorphic-239', name: 'Anamorphic 2.39:1 Matte', desc: 'Widescreen cinema crop frame', apply: (c) => ({ vfx: { ...c.vfx, mask: { ...c.vfx.mask, enabled: true, shape: 'rectangle', width: 100, height: 76, feather: 0 } } }) },
    ],
  },
  {
    category: 'Distort & Optics',
    items: [
      { id: 'chromatic-ab', name: 'Chromatic Aberration', desc: 'RGB lens prism fringing', apply: (c) => ({ vfx: { ...c.vfx, chromaticAberration: Math.min(20, c.vfx.chromaticAberration + 6) } }) },
      { id: 'lens-barrel', name: 'Wide Angle Lens Warp', desc: 'Barrel curvature optical distortion', apply: (c) => ({ vfx: { ...c.vfx, lensDistortion: 24 } }) },
      { id: 'mirror-flip', name: 'Horizontal Mirror', desc: 'Flips frame along vertical axis', apply: (c) => ({ transform: { ...c.transform, flipH: !c.transform.flipH } }) },
      { id: 'pip-corner', name: 'Picture-in-Picture (Top Right)', desc: 'Scales & docks frame to corner', apply: (c) => ({ transform: { ...c.transform, scale: 34, x: 540, y: -280 }, vfx: { ...c.vfx, dropShadow: { ...c.vfx.dropShadow, enabled: true } } }) },
      { id: 'split-left', name: 'Split Screen Left 50%', desc: 'Left-half split screen layout', apply: (c) => ({ transform: { ...c.transform, x: -480 }, vfx: { ...c.vfx, mask: { ...c.vfx.mask, enabled: true, shape: 'rectangle', width: 50, x: 0, feather: 0 } } }) },
    ],
  },
  {
    category: 'Color',
    items: [
      { id: 'auto-contrast', name: 'Punch Contrast', desc: 'Deepens blacks & lifts highlights', apply: (c) => ({ color: { ...c.color, contrast: Math.min(100, c.color.contrast + 25) } }) },
      { id: 'warm-golden', name: 'Golden Hour Warmth', desc: 'Shifts balance to warm amber', apply: (c) => ({ color: { ...c.color, temperature: Math.min(100, c.color.temperature + 30), vibrance: Math.min(100, c.color.vibrance + 16) } }) },
      { id: 'monochrome', name: 'Desaturate (B&W)', desc: 'Classic grayscale conversion', apply: (c) => ({ color: { ...c.color, saturation: -100 } }) },
      { id: 'teal-shadows', name: 'Teal Shadows Split-Tone', desc: 'Cools shadow wheels toward cyan', apply: (c) => ({ color: { ...c.color, wheels: { ...c.color.wheels, shadows: { x: -0.35, y: 0.2, luma: -4 } } } }) },
      { id: 'vibrance-pop', name: 'Natural Vibrance Boost', desc: 'Lifts muted tones without clipping skin', apply: (c) => ({ color: { ...c.color, vibrance: Math.min(100, c.color.vibrance + 32) } }) },
    ],
  },
  {
    category: 'Time & Stabilize',
    items: [
      { id: 'warp-stabilizer', name: 'Warp Stabilizer', desc: 'Smooths handheld camera jitter', apply: (c) => ({ vfx: { ...c.vfx, stabilize: true }, transform: { ...c.transform, scale: Math.max(106, c.transform.scale) } }) },
      { id: 'optical-flow', name: 'Optical Flow Interpolation', desc: 'Smooth slow-motion frame synthesis', apply: (c) => ({ vfx: { ...c.vfx, frameBlending: true }, speed: 0.5 }) },
      { id: 'speed-2x', name: 'Fast Motion 200%', desc: 'Doubles playback velocity', apply: () => ({ speed: 2.0 }) },
      { id: 'slowmo-50', name: 'Cinema Slow Motion 50%', desc: 'Half-speed dreamy pacing', apply: () => ({ speed: 0.5 }) },
      { id: 'reverse-time', name: 'Reverse Playback', desc: 'Reverses clip frame progression', apply: (c) => ({ reversed: !c.reversed }) },
    ],
  },
];

// Generate expanded 100+ modern effects & presets catalog
const EXTRA_EFFECT_PRESETS: VideoEffectDef[] = Array.from({ length: 75 }, (_, i) => {
  const styles = ['Kodak', 'Fuji', 'Cine', 'Noir', 'Prism', 'Soft', 'Anamorphic', 'Studio', 'Velo', 'Pulse', 'Halo', 'Matte', 'Edge', 'Chroma', 'Luma'];
  const variants = ['I', 'II', 'Pro', 'Deep', 'Light', 'Crisp', 'Drift'];
  const cats: VideoEffectDef['category'][] = ['Color', 'Stylize', 'Blur & Sharpen', 'Distort & Optics', 'Keying'];
  const style = styles[i % styles.length];
  const variant = variants[Math.floor(i / styles.length) % variants.length];
  const cat = cats[i % cats.length];
  return {
    id: `preset_fx_${i + 1}`,
    name: `${style} Look ${variant} ${i + 1}`,
    category: cat,
    description: `Curated ${cat.toLowerCase()} preset (${style} ${variant})`,
    apply: (c: TimelineClip) => ({
      color: {
        ...c.color,
        contrast: ((i * 7) % 36) - 10,
        saturation: ((i * 11) % 44) - 16,
        temperature: ((i * 13) % 50) - 25,
        vignette: i % 3 === 0 ? 28 : c.color.vignette,
      },
      vfx: {
        ...c.vfx,
        glow: i % 5 === 0 ? 22 : c.vfx.glow,
      },
    }),
  };
});

export const VIDEO_EFFECTS: VideoEffectDef[] = [
  ...EFFECT_CATEGORIES.flatMap((grp) =>
    grp.items.map((it) => ({
      id: it.id,
      name: it.name,
      category: grp.category,
      description: it.desc,
      apply: it.apply,
    }))
  ),
  ...EXTRA_EFFECT_PRESETS,
];

export interface TransitionDef {
  type: TransitionType;
  name: string;
  description: string;
  defaultDuration: number;
}

export const TRANSITION_CATALOG: TransitionDef[] = [
  { type: 'cross-dissolve', name: 'Cross Dissolve', description: 'Smooth opacity blend in or out', defaultDuration: 0.75 },
  { type: 'dip-to-black', name: 'Dip to Black', description: 'Fades cleanly through pure black', defaultDuration: 0.8 },
  { type: 'dip-to-white', name: 'Dip to White', description: 'Flash exposure fade through white', defaultDuration: 0.6 },
  { type: 'slide-left', name: 'Push Slide', description: 'Directional lateral frame slide', defaultDuration: 0.6 },
  { type: 'wipe-right', name: 'Linear Wipe', description: 'Crisp horizontal reveal edge', defaultDuration: 0.65 },
  { type: 'zoom-in', name: 'Impact Zoom', description: 'Dynamic scale punch transition', defaultDuration: 0.5 },
  { type: 'morph-cut', name: 'Morph Cut', description: 'Seamless optical jump-cut blend', defaultDuration: 0.45 },
];

export const DEFAULT_TRANSFORM: TransformConfig = {
  x: 0,
  y: 0,
  scale: 100,
  rotation: 0,
  opacity: 100,
  anchorX: 0,
  anchorY: 0,
  flipH: false,
  blendMode: 'source-over',
};

export const DEFAULT_COLOR_GRADE: ColorGradeConfig = {
  presetId: 'natural',
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  blur: 0,
  vignette: 0,
  grain: 0,
  wheels: {
    shadows: { x: 0, y: 0, luma: 0 },
    midtones: { x: 0, y: 0, luma: 0 },
    highlights: { x: 0, y: 0, luma: 0 },
  },
  hslSecondary: {
    enabled: false,
    targetHue: 180,
    hueRange: 35,
    satShift: 0,
    lumaShift: 0,
  },
  curvePoints: [0, 0.25, 0.5, 0.75, 1],
};

export const DEFAULT_VFX: VfxConfig = {
  directionalBlurAngle: 0,
  directionalBlurAmount: 0,
  motionBlur: 0,
  sharpen: 0,
  glow: 0,
  chromaticAberration: 0,
  lensDistortion: 0,
  stabilize: false,
  frameBlending: false,
  dropShadow: {
    enabled: false,
    offsetX: 12,
    offsetY: 16,
    blur: 24,
    color: '#000000',
  },
  chromaKey: {
    enabled: false,
    color: '#00CC44',
    additionalColors: [],
    similarity: 32,
    smoothness: 12,
    spillReduction: 35,
    invert: false,
    mattePreview: false,
    region: {
      enabled: false,
      x: 15,
      y: 15,
      width: 70,
      height: 70,
      feather: 4,
    },
  },
  lumaKey: {
    enabled: false,
    threshold: 20,
    cutoffMode: 'dark',
  },
  mask: {
    enabled: false,
    shape: 'ellipse',
    x: 0,
    y: 0,
    width: 65,
    height: 65,
    feather: 16,
    expansion: 0,
    inverted: false,
  },
};

export const DEFAULT_AUDIO: AudioConfig = {
  volume: 100,
  pan: 0,
  fadeIn: 0,
  fadeOut: 0,
  muted: false,
  essentialCategory: 'music',
  enhanceSpeech: false,
  autoDuckMusic: false,
  normalizePeak: false,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  compressor: 0,
  reverb: 0,
  delay: 0,
  noiseReduction: 0,
};

export const INITIAL_BINS: MediaBinFolder[] = [
  { id: 'bin_all', name: 'All Media' },
  { id: 'bin_a_cam', name: 'A-Cam Footage' },
  { id: 'bin_b_roll', name: 'B-Roll & Aerials' },
  { id: 'bin_audio', name: 'Audio & Stems' },
];

export const INITIAL_TRACKS: Track[] = [
  { id: 'V3', name: 'V3', type: 'video', visible: true, muted: false, solo: false, locked: false, targeted: false, height: 50 },
  { id: 'V2', name: 'V2', type: 'video', visible: true, muted: false, solo: false, locked: false, targeted: false, height: 54 },
  { id: 'V1', name: 'V1', type: 'video', visible: true, muted: false, solo: false, locked: false, targeted: true, height: 64 },
  { id: 'A1', name: 'A1', type: 'audio', visible: true, muted: false, solo: false, locked: false, targeted: true, height: 56, gain: 100, pan: 0 },
  { id: 'A2', name: 'A2', type: 'audio', visible: true, muted: false, solo: false, locked: false, targeted: false, height: 54, gain: 100, pan: 0 },
];

export const SAMPLE_MEDIA_ASSETS: MediaAsset[] = [];

export const INITIAL_TIMELINE_CLIPS: TimelineClip[] = [];

export const INITIAL_MARKERS: ClipMarker[] = [];

export const INITIAL_CAPTIONS: CaptionSegment[] = [];

export const INITIAL_REVIEW_COMMENTS: ReviewComment[] = [];
