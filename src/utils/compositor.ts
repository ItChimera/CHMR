import {
  CaptionSegment,
  ColorGradeConfig,
  MediaAsset,
  SequenceSettings,
  TimelineClip,
  Track,
  VfxConfig,
} from '../types/editor';
import { sampleCubeLut } from './cubeLut';
import { evaluateKeyframedValue } from './keyframes';
import { clamp } from './timecode';

export interface MediaElementCache {
  images: Map<string, HTMLImageElement>;
  videos: Map<string, HTMLVideoElement>;
  scratchCanvas?: HTMLCanvasElement;
}

export function createMediaCache(): MediaElementCache {
  return {
    images: new Map(),
    videos: new Map(),
  };
}

export function getOrLoadImage(cache: MediaElementCache, asset: MediaAsset): HTMLImageElement | null {
  const existing = cache.images.get(asset.id);
  if (existing) {
    return existing.complete && existing.naturalWidth > 0 ? existing : null;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = asset.src;
  cache.images.set(asset.id, img);
  return null;
}

export function getOrLoadVideo(cache: MediaElementCache, key: string, src: string): HTMLVideoElement {
  let video = cache.videos.get(key);
  if (!video) {
    video = document.createElement('video');
    video.src = src;
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.muted = true;
    video.preload = 'auto';
    cache.videos.set(key, video);
  }
  return video;
}

export function syncVideoElementsForTime(
  cache: MediaElementCache,
  clips: TimelineClip[],
  assetsMap: Map<string, MediaAsset>,
  timelineTime: number,
  isPlaying: boolean
) {
  const activeClipIds = new Set<string>();

  for (const clip of clips) {
    if (clip.disabled || clip.type !== 'video') continue;
    const asset = assetsMap.get(clip.assetId);
    if (!asset) continue;

    const inRange = timelineTime >= clip.start - 0.1 && timelineTime <= clip.start + clip.duration + 0.05;
    if (!inRange) continue;

    activeClipIds.add(clip.id);
    const video = getOrLoadVideo(cache, clip.id, asset.src);
    const elapsed = clip.freezeFrame ? 0 : clamp(timelineTime - clip.start, 0, clip.duration);
    const rawLocal = clip.reversed
      ? Math.max(0, clip.inPoint + (clip.duration - elapsed) * clip.speed)
      : clip.inPoint + elapsed * clip.speed;
    const localTime = asset.duration > 0 ? clamp(rawLocal, 0, Math.max(0, asset.duration - 0.02)) : rawLocal;

    if (isPlaying && !clip.reversed && !clip.freezeFrame) {
      video.playbackRate = clamp(clip.speed, 0.25, 4);
      if (Math.abs(video.currentTime - localTime) > 0.22) {
        try {
          video.currentTime = localTime;
        } catch {
          // ignore
        }
      }
      if (video.paused && timelineTime >= clip.start && timelineTime < clip.start + clip.duration) {
        video.play().catch(() => {});
      }
    } else {
      if (!video.paused) video.pause();
      if (Math.abs(video.currentTime - localTime) > 0.03) {
        try {
          video.currentTime = localTime;
        } catch {
          // ignore
        }
      }
    }
  }

  for (const [key, video] of cache.videos.entries()) {
    if (!activeClipIds.has(key) && !video.paused) {
      video.pause();
    }
  }
}

export function renderSequenceFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  timelineTime: number,
  tracks: Track[],
  clips: TimelineClip[],
  assetsMap: Map<string, MediaAsset>,
  cache: MediaElementCache,
  sequence: SequenceSettings,
  options: {
    showSafeMargins?: boolean;
    captions?: CaptionSegment[];
    multicamGrid?: boolean;
    activeMulticamClip?: TimelineClip | null;
    skipChromaKeyClipId?: string | null;
    allowKeyHelpers?: boolean;
    checkerboardBg?: boolean;
    isExport?: boolean;
  } = {}
) {
  ctx.save();
  if (options.checkerboardBg && !options.isExport) {
    drawCheckerboardBg(ctx, width, height);
  } else {
    ctx.fillStyle = '#070709';
    ctx.fillRect(0, 0, width, height);
  }

  // Multicam 2x2 Angle Switcher View
  if (options.multicamGrid && options.activeMulticamClip?.multicamAngles?.length) {
    const angles = options.activeMulticamClip.multicamAngles.slice(0, 4);
    const halfW = width / 2;
    const halfH = height / 2;
    angles.forEach((assetId, idx) => {
      const gx = (idx % 2) * halfW;
      const gy = Math.floor(idx / 2) * halfH;
      const angleAsset = assetsMap.get(assetId);
      ctx.save();
      ctx.beginPath();
      ctx.rect(gx, gy, halfW, halfH);
      ctx.clip();
      ctx.translate(gx + halfW / 2, gy + halfH / 2);
      if (angleAsset) {
        const img = getOrLoadImage(cache, angleAsset);
        if (img) {
          drawMediaWithMotion(ctx, img, img.naturalWidth, img.naturalHeight, halfW, halfH, angleAsset.motionPreset, 0.35);
        }
      }
      ctx.restore();

      const isActive = (options.activeMulticamClip?.activeAngleIndex || 0) === idx;
      ctx.strokeStyle = isActive ? '#EF4444' : '#27272E';
      ctx.lineWidth = isActive ? 4 : 1.5;
      ctx.strokeRect(gx + 2, gy + 2, halfW - 4, halfH - 4);

      ctx.fillStyle = isActive ? '#EF4444' : 'rgba(15,15,20,0.78)';
      ctx.fillRect(gx + 10, gy + 10, 68, 22);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.fillText(`CAM ${idx + 1}`, gx + 20, gy + 25);
    });
    ctx.restore();
    return;
  }

  const videoTracks = tracks
    .filter((t) => t.type === 'video' && t.visible)
    .slice()
    .reverse();

  const scaleToCanvas = Math.min(width / sequence.width, height / sequence.height);

  for (const track of videoTracks) {
    const activeClips = clips.filter(
      (c) =>
        c.trackId === track.id &&
        !c.disabled &&
        c.type !== 'audio' &&
        timelineTime >= c.start &&
        timelineTime < c.start + c.duration
    );

    for (const clip of activeClips) {
      // Adjustment Layer applies color grade & effects over already-rendered canvas below
      if (clip.type === 'adjustment') {
        applyPostGradeOverlay(ctx, width, height, clip.color, clip.vfx, timelineTime);
        continue;
      }

      // Nested sequence renders inner clips recursively
      const baseAsset = assetsMap.get(clip.assetId);
      if (clip.type === 'nested' && baseAsset?.nestedClips?.length) {
        const localTime = (timelineTime - clip.start) * clip.speed + clip.inPoint;
        const innerTracks: Track[] = [
          { id: 'V2', name: 'V2', type: 'video', visible: true, muted: false, solo: false, locked: false, height: 50 },
          { id: 'V1', name: 'V1', type: 'video', visible: true, muted: false, solo: false, locked: false, height: 50 },
        ];
        renderSequenceFrame(ctx, width, height, localTime, innerTracks, baseAsset.nestedClips, assetsMap, cache, sequence);
        continue;
      }

      // Multicam active angle override
      const resolvedAssetId =
        clip.multicamAngles && clip.activeAngleIndex !== undefined
          ? clip.multicamAngles[clip.activeAngleIndex] || clip.assetId
          : clip.assetId;
      const asset = assetsMap.get(resolvedAssetId);

      const elapsed = timelineTime - clip.start;
      const localProgress = clamp(elapsed / Math.max(0.001, clip.duration), 0, 1);
      const remaining = clip.start + clip.duration - timelineTime;

      // Keyframed parameters
      const kfX = evaluateKeyframedValue(clip, 'transform.x', elapsed, clip.transform.x);
      const kfY = evaluateKeyframedValue(clip, 'transform.y', elapsed, clip.transform.y);
      const kfScale = evaluateKeyframedValue(clip, 'transform.scale', elapsed, clip.transform.scale);
      const kfRotation = evaluateKeyframedValue(clip, 'transform.rotation', elapsed, clip.transform.rotation);
      const kfOpacity = evaluateKeyframedValue(clip, 'transform.opacity', elapsed, clip.transform.opacity);
      const kfExposure = evaluateKeyframedValue(clip, 'color.exposure', elapsed, clip.color.exposure);

      // Transitions
      let transOpacity = 1;
      let transOffsetX = 0;
      let transScale = 1;
      let wipeFraction: number | null = null;
      let dipColor: string | null = null;
      let dipAmount = 0;

      if (clip.transitionIn.type !== 'none' && clip.transitionIn.duration > 0 && elapsed < clip.transitionIn.duration) {
        const p = clamp(elapsed / clip.transitionIn.duration, 0, 1);
        const eased = p * (2 - p);
        switch (clip.transitionIn.type) {
          case 'cross-dissolve':
          case 'morph-cut':
            transOpacity *= eased;
            break;
          case 'dip-to-black':
            dipColor = '#000000';
            dipAmount = 1 - eased;
            break;
          case 'dip-to-white':
            dipColor = '#FFFFFF';
            dipAmount = 1 - eased;
            break;
          case 'slide-left':
            transOffsetX = (1 - eased) * width * 0.65;
            transOpacity *= Math.min(1, eased * 1.4);
            break;
          case 'wipe-right':
            wipeFraction = eased;
            break;
          case 'zoom-in':
            transScale *= 1.35 - 0.35 * eased;
            transOpacity *= eased;
            break;
        }
      }

      if (clip.transitionOut.type !== 'none' && clip.transitionOut.duration > 0 && remaining < clip.transitionOut.duration) {
        const p = clamp(remaining / clip.transitionOut.duration, 0, 1);
        const eased = p * (2 - p);
        switch (clip.transitionOut.type) {
          case 'cross-dissolve':
          case 'morph-cut':
            transOpacity *= eased;
            break;
          case 'dip-to-black':
            dipColor = '#000000';
            dipAmount = Math.max(dipAmount, 1 - eased);
            break;
          case 'dip-to-white':
            dipColor = '#FFFFFF';
            dipAmount = Math.max(dipAmount, 1 - eased);
            break;
          case 'slide-left':
            transOffsetX = -(1 - eased) * width * 0.65;
            transOpacity *= Math.min(1, eased * 1.4);
            break;
          case 'wipe-right':
            wipeFraction = eased;
            break;
          case 'zoom-in':
            transScale *= 1 + (1 - eased) * 0.3;
            transOpacity *= eased;
            break;
        }
      }

      ctx.save();

      if (wipeFraction !== null) {
        ctx.beginPath();
        ctx.rect(0, 0, width * wipeFraction, height);
        ctx.clip();
      }

      // Shape Masking
      if (clip.vfx?.mask?.enabled) {
        const m = clip.vfx.mask;
        const mw = (width * clamp(m.width + m.expansion, 4, 130)) / 100;
        const mh = (height * clamp(m.height + m.expansion, 4, 130)) / 100;
        const mx = width / 2 + (width * m.x) / 100;
        const my = height / 2 + (height * m.y) / 100;

        ctx.beginPath();
        if (m.inverted) {
          ctx.rect(0, 0, width, height);
        }
        if (m.shape === 'ellipse') {
          ctx.ellipse(mx, my, mw / 2, mh / 2, 0, 0, Math.PI * 2, m.inverted);
        } else {
          if (m.inverted) {
            ctx.rect(mx + mw / 2, my - mh / 2, -mw, mh);
          } else {
            ctx.rect(mx - mw / 2, my - mh / 2, mw, mh);
          }
        }
        ctx.clip(m.inverted ? 'evenodd' : 'nonzero');
      }

      ctx.globalAlpha = clamp((kfOpacity / 100) * transOpacity, 0, 1);
      ctx.globalCompositeOperation = clip.transform.blendMode || 'source-over';

      // Drop Shadow
      if (clip.vfx?.dropShadow?.enabled) {
        ctx.shadowColor = clip.vfx.dropShadow.color;
        ctx.shadowBlur = clip.vfx.dropShadow.blur * scaleToCanvas;
        ctx.shadowOffsetX = clip.vfx.dropShadow.offsetX * scaleToCanvas;
        ctx.shadowOffsetY = clip.vfx.dropShadow.offsetY * scaleToCanvas;
      }

      ctx.translate(
        width / 2 + kfX * scaleToCanvas + transOffsetX,
        height / 2 + kfY * scaleToCanvas
      );
      ctx.rotate((kfRotation * Math.PI) / 180);
      const scaleFactor = (kfScale / 100) * transScale;
      ctx.scale(clip.transform.flipH ? -scaleFactor : scaleFactor, scaleFactor);

      // CSS Filter Pipeline
      const brightnessPct = clamp(100 + kfExposure + (clip.color.highlights || 0) * 0.25 + (clip.color.shadows || 0) * 0.25, 0, 260);
      const contrastPct = clamp(100 + clip.color.contrast + ((clip.vfx?.sharpen || 0) * 0.18), 0, 260);
      const saturatePct = clamp(100 + clip.color.saturation + (clip.color.vibrance || 0) * 0.55, 0, 300);
      const hueDeg = clip.color.hue || 0;
      const blurPx = ((clip.color.blur || 0) + (clip.vfx?.directionalBlurAmount || 0) * 0.6 + (clip.vfx?.motionBlur || 0) * 0.08) * scaleToCanvas;

      const colorFilterParts = [
        `brightness(${brightnessPct}%)`,
        `contrast(${contrastPct}%)`,
        `saturate(${saturatePct}%)`,
      ];
      if (hueDeg !== 0) colorFilterParts.push(`hue-rotate(${hueDeg}deg)`);
      const colorFilterStr = colorFilterParts.join(' ');
      const blurFilterStr = blurPx > 0.1 ? `blur(${blurPx.toFixed(1)}px)` : 'none';
      const fullFilterStr = blurPx > 0.1 ? `${colorFilterStr} ${blurFilterStr}` : colorFilterStr;

      const chromaActive = Boolean(clip.vfx?.chromaKey?.enabled) && options.skipChromaKeyClipId !== clip.id;
      const needsPixelProcess =
        chromaActive ||
        clip.vfx?.lumaKey?.enabled ||
        Boolean(clip.color.customLutData) ||
        Boolean(clip.color.hslSecondary?.enabled);

      ctx.filter = fullFilterStr;

      if (clip.type === 'matte') {
        if (needsPixelProcess) {
          ctx.filter = blurFilterStr;
          drawWithPixelEffects(
            ctx,
            cache,
            asset?.matteColor || '#1E293B',
            width,
            height,
            width,
            height,
            clip,
            {
              chromaActive,
              colorFilterStr,
              allowKeyHelpers: Boolean(options.allowKeyHelpers && !options.isExport),
              isExport: Boolean(options.isExport),
            }
          );
        } else {
          ctx.fillStyle = asset?.matteColor || '#1E293B';
          ctx.fillRect(-width / 2, -height / 2, width, height);
        }
      } else if (clip.type === 'title' && clip.text) {
        ctx.filter = blurFilterStr;
        drawTitleGraphic(ctx, width, height, scaleToCanvas, clip, elapsed);
      } else if (clip.type === 'image' && asset) {
        const img = getOrLoadImage(cache, asset);
        if (img) {
          if (needsPixelProcess) {
            ctx.filter = blurFilterStr;
            drawWithPixelEffects(ctx, cache, img, img.naturalWidth, img.naturalHeight, width, height, clip, {
              chromaActive,
              colorFilterStr,
              allowKeyHelpers: Boolean(options.allowKeyHelpers && !options.isExport),
              isExport: Boolean(options.isExport),
            });
          } else {
            drawMediaWithMotion(ctx, img, img.naturalWidth, img.naturalHeight, width, height, asset.motionPreset, clip.freezeFrame ? 0 : localProgress);
          }
        }
      } else if (clip.type === 'video' && asset) {
        const video = getOrLoadVideo(cache, clip.id, asset.src);
        if (video.readyState >= 2 && video.videoWidth > 0) {
          if (needsPixelProcess) {
            ctx.filter = blurFilterStr;
            drawWithPixelEffects(ctx, cache, video, video.videoWidth, video.videoHeight, width, height, clip, {
              chromaActive,
              colorFilterStr,
              allowKeyHelpers: Boolean(options.allowKeyHelpers && !options.isExport),
              isExport: Boolean(options.isExport),
            });
          } else {
            drawMediaWithMotion(ctx, video, video.videoWidth, video.videoHeight, width, height, 'none', localProgress);
          }
        } else {
          ctx.fillStyle = '#18181B';
          ctx.fillRect(-width / 2, -height / 2, width, height);
        }
      }

      ctx.filter = 'none';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Chromatic Aberration RGB Fringe
      if ((clip.vfx?.chromaticAberration || 0) > 0.5 && (clip.type === 'image' || clip.type === 'video')) {
        const shift = clip.vfx.chromaticAberration * scaleToCanvas;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = 'rgba(255, 0, 80, 0.25)';
        ctx.fillRect(-width / 2 - shift, -height / 2, 16, height);
        ctx.fillStyle = 'rgba(0, 210, 255, 0.25)';
        ctx.fillRect(width / 2 - 16 + shift, -height / 2, 16, height);
        ctx.restore();
      }

      // Bloom / Glow Overlay
      if ((clip.vfx?.glow || 0) > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(255, 248, 235, ${((clip.vfx.glow / 100) * 0.22).toFixed(3)})`;
        ctx.fillRect(-width / 2, -height / 2, width, height);
        ctx.restore();
      }

      // Color Wheels & Temperature / Tint
      applyColorWheelsAndTemp(ctx, width, height, clip.color);

      // Vignette
      if (clip.color.vignette > 0) {
        const vAmt = clamp(clip.color.vignette / 100, 0, 1);
        const rad = Math.max(width, height) * 0.72;
        const grad = ctx.createRadialGradient(0, 0, rad * 0.35, 0, 0, rad);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, `rgba(0,0,0,${(vAmt * 0.85).toFixed(3)})`);
        ctx.fillStyle = grad;
        ctx.fillRect(-width / 2, -height / 2, width, height);
      }

      // Film Grain
      if (clip.color.grain > 0) {
        drawFilmGrain(ctx, width, height, clip.color.grain / 100, timelineTime);
      }

      // Dip Transition
      if (dipColor && dipAmount > 0.01) {
        ctx.fillStyle = dipColor;
        ctx.globalAlpha = clamp(dipAmount, 0, 1);
        ctx.fillRect(-width / 2, -height / 2, width, height);
      }

      ctx.restore();
    }
  }

  // Active Captions / Subtitles Track Overlay
  if (options.captions && options.captions.length > 0) {
    const activeCap = options.captions.find((c) => timelineTime >= c.start && timelineTime <= c.end);
    if (activeCap) {
      drawCaptionOverlay(ctx, width, height, scaleToCanvas, activeCap.text);
    }
  }

  // Safe Margins Guide
  if (options.showSafeMargins) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(width * 0.05, height * 0.05, width * 0.9, height * 0.9);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.42)';
    ctx.strokeRect(width * 0.1, height * 0.1, width * 0.8, height * 0.8);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(width / 2 - 12, height / 2);
    ctx.lineTo(width / 2 + 12, height / 2);
    ctx.moveTo(width / 2, height / 2 - 12);
    ctx.lineTo(width / 2, height / 2 + 12);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

function drawCheckerboardBg(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const size = 14;
  ctx.fillStyle = '#121216';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#1B1B22';
  for (let y = 0; y < height; y += size) {
    const offset = (Math.floor(y / size) % 2) * size;
    for (let x = offset; x < width; x += size * 2) {
      ctx.fillRect(x, y, size, size);
    }
  }
}

function drawWithPixelEffects(
  ctx: CanvasRenderingContext2D,
  cache: MediaElementCache,
  source: CanvasImageSource | string,
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
  clip: TimelineClip,
  opts: {
    chromaActive: boolean;
    colorFilterStr: string;
    allowKeyHelpers: boolean;
    isExport: boolean;
  }
) {
  if (!cache.scratchCanvas) {
    cache.scratchCanvas = document.createElement('canvas');
  }
  const sc = cache.scratchCanvas;
  const maxProcW = opts.isExport ? 1280 : 720;
  const procW = Math.max(1, Math.min(maxProcW, canvasW));
  const procH = Math.max(1, Math.round((procW * canvasH) / Math.max(1, canvasW)));
  if (sc.width !== procW || sc.height !== procH) {
    sc.width = procW;
    sc.height = procH;
  }
  const sctx = sc.getContext('2d', { willReadFrequently: true });
  if (!sctx) return;

  sctx.clearRect(0, 0, procW, procH);
  sctx.save();
  sctx.filter = opts.colorFilterStr || 'none';
  if (typeof source === 'string') {
    sctx.fillStyle = source;
    sctx.fillRect(0, 0, procW, procH);
  } else {
    const coverScale = Math.max(procW / Math.max(1, srcW), procH / Math.max(1, srcH));
    const dw = srcW * coverScale;
    const dh = srcH * coverScale;
    sctx.drawImage(source, (procW - dw) / 2, (procH - dh) / 2, dw, dh);
  }
  sctx.restore();

  const imgData = sctx.getImageData(0, 0, procW, procH);
  const d = imgData.data;

  const ck = clip.vfx?.chromaKey;
  const lk = clip.vfx?.lumaKey;
  const lut = clip.color.customLutData;

  const keyEntries = opts.chromaActive && ck
    ? [ck.color, ...(ck.additionalColors || [])].map((hex) => {
        const [kr, kg, kb] = hexToRgb(hex);
        const krN = kr / 255;
        const kgN = kg / 255;
        const kbN = kb / 255;
        const kY = 0.299 * krN + 0.587 * kgN + 0.114 * kbN;
        const kCb = -0.168736 * krN - 0.331264 * kgN + 0.5 * kbN;
        const kCr = 0.5 * krN - 0.418688 * kgN - 0.081312 * kbN;
        const kChroma = Math.hypot(kCb, kCr);
        const denom = Math.max(0.18, kY);
        return {
          kr,
          kg,
          kb,
          krN,
          kgN,
          kbN,
          kY,
          kCbNorm: kCb / denom,
          kCrNorm: kCr / denom,
          chromaMix: clamp((kChroma - 0.03) / 0.1, 0, 1),
          kDiffR: krN - kY,
          kDiffG: kgN - kY,
          kDiffB: kbN - kY,
        };
      })
    : [];

  const thresh = (ck?.similarity ?? 32) / 100;
  const smooth = Math.max(0.015, (ck?.smoothness ?? 12) / 100);
  const spillFactor = (ck?.spillReduction ?? 0) / 100;
  const invertKey = Boolean(ck?.invert);
  const showMatte = Boolean(ck?.mattePreview && opts.allowKeyHelpers && !opts.isExport);
  const region = ck?.region?.enabled ? ck.region : null;
  const rx = region ? region.x : 0;
  const ry = region ? region.y : 0;
  const rx2 = region ? region.x + region.width : 100;
  const ry2 = region ? region.y + region.height : 100;
  const rFeather = region ? Math.max(0, region.feather) : 0;

  for (let py = 0; py < procH; py++) {
    const ny = (py / procH) * 100;
    for (let px = 0; px < procW; px++) {
      const i = (py * procW + px) * 4;
      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];

      if (lut) {
        const [lr, lg, lb] = sampleCubeLut(lut, r / 255, g / 255, b / 255);
        r = clamp(Math.round(lr * 255), 0, 255);
        g = clamp(Math.round(lg * 255), 0, 255);
        b = clamp(Math.round(lb * 255), 0, 255);
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
      }

      if (opts.chromaActive && ck && keyEntries.length > 0) {
        let regionMask = 1;
        if (region) {
          const nx = (px / procW) * 100;
          if (nx < rx || nx > rx2 || ny < ry || ny > ry2) {
            regionMask = 0;
          } else if (rFeather > 0.1) {
            const edgeDist = Math.min(nx - rx, rx2 - nx, ny - ry, ry2 - ny);
            regionMask = clamp(edgeDist / rFeather, 0, 1);
          }
        }

        if (regionMask > 0.001) {
          const rN = r / 255;
          const gN = g / 255;
          const bN = b / 255;
          const pY = 0.299 * rN + 0.587 * gN + 0.114 * bN;
          const pCb = -0.168736 * rN - 0.331264 * gN + 0.5 * bN;
          const pCr = 0.5 * rN - 0.418688 * gN - 0.081312 * bN;
          const pDenom = Math.max(0.18, pY);
          const pCbNorm = pCb / pDenom;
          const pCrNorm = pCr / pDenom;

          let minDist = Infinity;
          let matched = keyEntries[0];

          for (let k = 0; k < keyEntries.length; k++) {
            const entry = keyEntries[k];
            const dr = rN - entry.krN;
            const dg = gN - entry.kgN;
            const db = bN - entry.kbN;
            const rgbDist = Math.hypot(dr, dg, db) / 1.73205;
            const normChromaDist =
              Math.hypot(pCbNorm - entry.kCbNorm, pCrNorm - entry.kCrNorm) * 0.55 +
              Math.abs(pY - entry.kY) * 0.28;
            const dist = rgbDist * (1 - entry.chromaMix) + normChromaDist * entry.chromaMix;
            if (dist < minDist) {
              minDist = dist;
              matched = entry;
            }
          }

          let keyAlpha = 1;
          if (minDist <= thresh) {
            keyAlpha = 0;
          } else if (minDist < thresh + smooth) {
            const t = (minDist - thresh) / smooth;
            keyAlpha = t * t * (3 - 2 * t);
          }

          if (invertKey) {
            keyAlpha = 1 - keyAlpha;
          }

          const finalKeyAlpha = 1 - regionMask * (1 - keyAlpha);
          const origAlpha = d[i + 3];
          const outAlpha = Math.round(origAlpha * finalKeyAlpha);

          if (showMatte) {
            d[i] = outAlpha;
            d[i + 1] = outAlpha;
            d[i + 2] = outAlpha;
            d[i + 3] = 255;
            continue;
          }

          d[i + 3] = outAlpha;

          // Universal hue-aware spill suppression on remaining foreground edges
          if (spillFactor > 0 && !invertKey && outAlpha > 0 && minDist < thresh + smooth * 3.0) {
            const spillZone = clamp(1 - (minDist - thresh) / Math.max(0.12, smooth * 3.0), 0, 1);
            const strength = spillZone * spillFactor * regionMask;
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            // Remove chroma component aligned with key color's chroma direction
            const pDiffR = rN - pY;
            const pDiffG = gN - pY;
            const pDiffB = bN - pY;
            const dot = pDiffR * matched.kDiffR + pDiffG * matched.kDiffG + pDiffB * matched.kDiffB;
            const kMagSq =
              matched.kDiffR * matched.kDiffR +
              matched.kDiffG * matched.kDiffG +
              matched.kDiffB * matched.kDiffB;
            if (dot > 0 && kMagSq > 0.001) {
              const proj = clamp(dot / kMagSq, 0, 1.4) * strength;
              d[i] = clamp(Math.round(r - matched.kDiffR * 255 * proj), 0, 255);
              d[i + 1] = clamp(Math.round(g - matched.kDiffG * 255 * proj), 0, 255);
              d[i + 2] = clamp(Math.round(b - matched.kDiffB * 255 * proj), 0, 255);
            } else {
              d[i] = clamp(Math.round(r + (lum - r) * strength * 0.6), 0, 255);
              d[i + 1] = clamp(Math.round(g + (lum - g) * strength * 0.6), 0, 255);
              d[i + 2] = clamp(Math.round(b + (lum - b) * strength * 0.6), 0, 255);
            }
          }
        } else if (showMatte) {
          d[i] = 255;
          d[i + 1] = 255;
          d[i + 2] = 255;
          d[i + 3] = 255;
          continue;
        }
      }

      if (lk?.enabled) {
        const luma = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 2.55;
        if (lk.cutoffMode === 'dark' && luma < lk.threshold) {
          d[i + 3] = 0;
        } else if (lk.cutoffMode === 'bright' && luma > lk.threshold) {
          d[i + 3] = 0;
        }
      }
    }
  }

  sctx.putImageData(imgData, 0, 0);
  ctx.drawImage(sc, -canvasW / 2, -canvasH / 2, canvasW, canvasH);
}

function applyPostGradeOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: ColorGradeConfig,
  vfx: VfxConfig,
  timelineTime: number
) {
  ctx.save();
  if (color.exposure !== 0) {
    ctx.globalCompositeOperation = color.exposure > 0 ? 'screen' : 'multiply';
    const amt = Math.min(0.45, Math.abs(color.exposure) / 150);
    ctx.fillStyle = color.exposure > 0 ? `rgba(255,255,255,${amt})` : `rgba(0,0,0,${amt})`;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.translate(width / 2, height / 2);
  applyColorWheelsAndTemp(ctx, width, height, color);
  if (color.vignette > 0) {
    const vAmt = clamp(color.vignette / 100, 0, 1);
    const rad = Math.max(width, height) * 0.72;
    const grad = ctx.createRadialGradient(0, 0, rad * 0.35, 0, 0, rad);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${(vAmt * 0.85).toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(-width / 2, -height / 2, width, height);
  }
  if (color.grain > 0) drawFilmGrain(ctx, width, height, color.grain / 100, timelineTime);
  if ((vfx?.glow || 0) > 0) {
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(255,248,235,${((vfx.glow / 100) * 0.2).toFixed(3)})`;
    ctx.fillRect(-width / 2, -height / 2, width, height);
  }
  ctx.restore();
}

function applyColorWheelsAndTemp(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: ColorGradeConfig
) {
  if (color.temperature !== 0) {
    const tempAmt = Math.abs(color.temperature) / 100;
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle =
      color.temperature > 0
        ? `rgba(255, 162, 66, ${(tempAmt * 0.45).toFixed(3)})`
        : `rgba(74, 158, 255, ${(tempAmt * 0.45).toFixed(3)})`;
    ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.restore();
  }

  if (color.tint && color.tint !== 0) {
    const tintAmt = Math.abs(color.tint) / 100;
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle =
      color.tint > 0
        ? `rgba(217, 70, 239, ${(tintAmt * 0.3).toFixed(3)})`
        : `rgba(34, 197, 94, ${(tintAmt * 0.3).toFixed(3)})`;
    ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.restore();
  }

  const wheels = color.wheels;
  if (wheels) {
    const wheelList = [
      { w: wheels.shadows, mode: 'multiply' as GlobalCompositeOperation, alpha: 0.28 },
      { w: wheels.midtones, mode: 'soft-light' as GlobalCompositeOperation, alpha: 0.32 },
      { w: wheels.highlights, mode: 'screen' as GlobalCompositeOperation, alpha: 0.25 },
    ];
    for (const item of wheelList) {
      if (Math.abs(item.w.x) > 0.03 || Math.abs(item.w.y) > 0.03) {
        const r = clamp(Math.round(128 + item.w.x * 127), 0, 255);
        const g = clamp(Math.round(128 - item.w.y * 127), 0, 255);
        const b = clamp(Math.round(128 - item.w.x * 127), 0, 255);
        ctx.save();
        ctx.globalCompositeOperation = item.mode;
        ctx.fillStyle = `rgba(${r},${g},${b},${item.alpha})`;
        ctx.fillRect(-width / 2, -height / 2, width, height);
        ctx.restore();
      }
    }
  }
}

function drawMediaWithMotion(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
  motionPreset: MediaAsset['motionPreset'],
  progress: number
) {
  if (!srcW || !srcH) return;
  const coverScale = Math.max(canvasW / srcW, canvasH / srcH);
  let extraScale = 1;
  let panX = 0;
  let panY = 0;

  if (motionPreset === 'slow-zoom-in') {
    extraScale = 1 + 0.08 * progress;
  } else if (motionPreset === 'slow-pan-right') {
    extraScale = 1.08;
    panX = (progress - 0.5) * -canvasW * 0.05;
  } else if (motionPreset === 'slow-pan-left') {
    extraScale = 1.08;
    panX = (progress - 0.5) * canvasW * 0.05;
  } else if (motionPreset === 'subtle-drift') {
    extraScale = 1.06 + 0.03 * progress;
    panY = (progress - 0.5) * -canvasH * 0.03;
  }

  const drawW = srcW * coverScale * extraScale;
  const drawH = srcH * coverScale * extraScale;

  ctx.drawImage(source, -drawW / 2 + panX, -drawH / 2 + panY, drawW, drawH);
}

function drawTitleGraphic(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scaleToCanvas: number,
  clip: TimelineClip,
  elapsed: number
) {
  const cfg = clip.text;
  if (!cfg) return;

  // Entrance Animation Offset
  const animP = clamp(elapsed / 0.55, 0, 1);
  const eased = animP * (2 - animP);
  let animY = 0;
  let animScale = 1;
  let visibleChars = cfg.text.length;

  if (cfg.animation === 'fade-up') {
    animY = (1 - eased) * 28 * scaleToCanvas;
    ctx.globalAlpha *= eased;
  } else if (cfg.animation === 'scale-pop') {
    animScale = 0.82 + 0.18 * eased;
    ctx.globalAlpha *= eased;
  } else if (cfg.animation === 'slide-in') {
    ctx.translate(-(1 - eased) * 60 * scaleToCanvas, 0);
    ctx.globalAlpha *= eased;
  } else if (cfg.animation === 'typewriter') {
    visibleChars = Math.max(1, Math.round(cfg.text.length * clamp(elapsed / 1.2, 0, 1)));
  }

  ctx.save();
  ctx.translate(0, animY);
  ctx.scale(animScale, animScale);

  // Vector Shape Layouts
  if (cfg.layout === 'shape-rect') {
    const rw = width * 0.42;
    const rh = height * 0.24;
    if (cfg.gradientEnabled && cfg.gradientEndColor) {
      const grad = ctx.createLinearGradient(-rw / 2, 0, rw / 2, 0);
      grad.addColorStop(0, cfg.color);
      grad.addColorStop(1, cfg.gradientEndColor);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = cfg.color;
    }
    ctx.fillRect(-rw / 2, -rh / 2, rw, rh);
    if ((cfg.strokeWidth || 0) > 0) {
      ctx.strokeStyle = cfg.strokeColor || '#FFFFFF';
      ctx.lineWidth = (cfg.strokeWidth || 2) * scaleToCanvas;
      ctx.strokeRect(-rw / 2, -rh / 2, rw, rh);
    }
    ctx.restore();
    return;
  }

  if (cfg.layout === 'shape-circle') {
    const rad = Math.min(width, height) * 0.18;
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, Math.PI * 2);
    if (cfg.gradientEnabled && cfg.gradientEndColor) {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
      grad.addColorStop(0, cfg.color);
      grad.addColorStop(1, cfg.gradientEndColor);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = cfg.color;
    }
    ctx.fill();
    if ((cfg.strokeWidth || 0) > 0) {
      ctx.strokeStyle = cfg.strokeColor || '#FFFFFF';
      ctx.lineWidth = (cfg.strokeWidth || 2) * scaleToCanvas;
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  const displayStr = cfg.text.slice(0, visibleChars);
  const fontSize = Math.max(12, cfg.fontSize * scaleToCanvas);
  const subSize = Math.max(10, fontSize * 0.34);
  ctx.font = `${cfg.fontWeight} ${fontSize}px "${cfg.fontFamily}", sans-serif`;
  ctx.textBaseline = 'middle';

  const lines = displayStr.split('\n');
  const lineHeight = fontSize * 1.18;

  if (cfg.layout === 'lower-third') {
    const padX = 28 * scaleToCanvas;
    const padY = 20 * scaleToCanvas;
    const anchorX = -width * 0.42;
    const anchorY = height * 0.3;

    const textWidth = Math.max(
      ctx.measureText(displayStr).width,
      cfg.subtitle ? cfg.subtitle.length * subSize * 0.65 : 0
    );
    const boxW = textWidth + padX * 2.2;
    const boxH = lineHeight + (cfg.subtitle ? subSize * 1.6 : 0) + padY * 1.6;

    if (cfg.bgOpacity > 0) {
      ctx.fillStyle = hexToRgba(cfg.bgColor, cfg.bgOpacity / 100);
      ctx.fillRect(anchorX, anchorY - boxH / 2, boxW, boxH);
      ctx.fillStyle = '#3B82F6';
      ctx.fillRect(anchorX, anchorY - boxH / 2, 5 * scaleToCanvas, boxH);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = cfg.color;
    drawTrackedText(ctx, displayStr, anchorX + padX, anchorY - (cfg.subtitle ? subSize * 0.6 : 0), cfg.letterSpacing * scaleToCanvas, cfg.strokeColor, (cfg.strokeWidth || 0) * scaleToCanvas);

    if (cfg.subtitle) {
      ctx.font = `500 ${subSize}px "JetBrains Mono", monospace`;
      ctx.fillStyle = 'rgba(226, 232, 240, 0.82)';
      drawTrackedText(ctx, cfg.subtitle, anchorX + padX, anchorY + lineHeight * 0.5, (cfg.letterSpacing * 0.5 + 1) * scaleToCanvas);
    }
    ctx.restore();
    return;
  }

  if (cfg.layout === 'caption') {
    const anchorY = height * 0.36;
    const textWidth = ctx.measureText(displayStr).width;
    const padX = 26 * scaleToCanvas;
    const padY = 14 * scaleToCanvas;
    if (cfg.bgOpacity > 0) {
      ctx.fillStyle = hexToRgba(cfg.bgColor, cfg.bgOpacity / 100);
      ctx.fillRect(-textWidth / 2 - padX, anchorY - fontSize / 2 - padY, textWidth + padX * 2, fontSize + padY * 2);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = cfg.color;
    ctx.fillText(displayStr, 0, anchorY);
    ctx.restore();
    return;
  }

  const totalHeight = lines.length * lineHeight;
  const startY = -totalHeight / 2 + lineHeight / 2 - (cfg.subtitle ? subSize * 0.8 : 0);

  if (cfg.bgOpacity > 0) {
    ctx.fillStyle = hexToRgba(cfg.bgColor, cfg.bgOpacity / 100);
    ctx.fillRect(-width * 0.35, -totalHeight * 0.85, width * 0.7, totalHeight * 1.7 + (cfg.subtitle ? subSize * 2 : 0));
  }

  ctx.textAlign = cfg.align;
  const xPos = cfg.align === 'left' ? -width * 0.38 : cfg.align === 'right' ? width * 0.38 : 0;

  if (cfg.gradientEnabled && cfg.gradientEndColor) {
    const grad = ctx.createLinearGradient(-width * 0.3, 0, width * 0.3, 0);
    grad.addColorStop(0, cfg.color);
    grad.addColorStop(1, cfg.gradientEndColor);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = cfg.color;
  }

  if (cfg.shadowEnabled !== false) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 18 * scaleToCanvas;
  }

  lines.forEach((line, idx) => {
    drawTrackedText(ctx, line, xPos, startY + idx * lineHeight, cfg.letterSpacing * scaleToCanvas, cfg.strokeColor, (cfg.strokeWidth || 0) * scaleToCanvas);
  });

  if (cfg.subtitle) {
    ctx.font = `500 ${subSize}px "JetBrains Mono", monospace`;
    ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
    drawTrackedText(ctx, cfg.subtitle, xPos, startY + lines.length * lineHeight + subSize * 0.35, 3 * scaleToCanvas);
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawCaptionOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scaleToCanvas: number,
  text: string
) {
  ctx.save();
  const fontSize = Math.max(14, 34 * scaleToCanvas);
  ctx.font = `500 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = height * 0.86;
  const tw = ctx.measureText(text).width;
  const padX = 22 * scaleToCanvas;
  const padY = 12 * scaleToCanvas;
  ctx.fillStyle = 'rgba(9, 9, 12, 0.82)';
  ctx.fillRect(width / 2 - tw / 2 - padX, y - fontSize / 2 - padY, tw + padX * 2, fontSize + padY * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(text, width / 2, y);
  ctx.restore();
}

function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number,
  strokeColor?: string,
  strokeWidth = 0
) {
  if (!letterSpacing || letterSpacing <= 0.5) {
    if (strokeWidth > 0 && strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.strokeText(text, x, y);
    }
    ctx.fillText(text, x, y);
    return;
  }
  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const totalWidth = widths.reduce((a, b) => a + b, 0) + letterSpacing * Math.max(0, chars.length - 1);

  let cursorX = x;
  if (ctx.textAlign === 'center') cursorX = x - totalWidth / 2;
  else if (ctx.textAlign === 'right') cursorX = x - totalWidth;

  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  for (let i = 0; i < chars.length; i++) {
    if (strokeWidth > 0 && strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.strokeText(chars[i], cursorX, y);
    }
    ctx.fillText(chars[i], cursorX, y);
    cursorX += widths[i] + letterSpacing;
  }
  ctx.textAlign = prevAlign;
}

function drawFilmGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  amount: number,
  seedTime: number
) {
  ctx.save();
  const count = Math.floor(180 * amount);
  let seed = Math.floor(seedTime * 120) * 9301 + 49297;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < count; i++) {
    const gx = (rand() - 0.5) * width;
    const gy = (rand() - 0.5) * height;
    const alpha = rand() * 0.14 * amount;
    ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${alpha.toFixed(3)})` : `rgba(0,0,0,${alpha.toFixed(3)})`;
    ctx.fillRect(gx, gy, 2.5, 2.5);
  }
  ctx.restore();
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}
