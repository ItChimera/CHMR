# CHMR — Non-Linear Video Editor

Browser-based multi-track non-linear video editing workstation with real-time HTML5 Canvas compositing, click-to-pick Chroma Keying, Lumetri-style color grading & 3D LUTs, motion keyframes with interpolation profiles, Web Audio mixing, and local MP4 / WebM / WAV / PNG / SRT / EDL / XML export.

Everything needed for video editing and exporting runs **100% client-side in your browser** — no cloud backend or hosting bill required.

## Host for Free on GitHub Pages (No Cloud Service Needed)

1. Push this repository to GitHub (default branch `main`).
2. Open your repository on GitHub and go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Push any commit (or run the **Deploy CHMR to GitHub Pages** workflow from the **Actions** tab).
5. Your app will be live at `https://<your-username>.github.io/<your-repo-name>/` and can also be installed offline as a PWA.

> **Custom domain / user root site (`username.github.io`):** If hosting at the root domain instead of `/<repo-name>/`, set `VITE_BASE_PATH: /` in `.github/workflows/deploy-pages.yml` (or omit it to use relative `./` asset paths).

## Run Locally (Pure Static / No Server)

```bash
npm install
npm run dev:client
```

To build a static `dist/` folder you can open or host anywhere (GitHub Pages, local file server, etc.):

```bash
npm run build
npm run preview
```

## Optional Local Backend Server

Core video editing, keying, grading, audio mixing, and exporting require **no backend**. If you want to enable optional server-proxied features locally (Gemini AI assistant/transcription/TTS or TikTok OAuth publishing):

1. Copy `.env.example` to `.env` and fill in your optional keys.
2. Run:

```bash
npm run dev
```

## What Works 100% Client-Side on GitHub Pages

- Multi-track timeline editing (Select, Ripple, Roll, Slip, Slide, Razor, Hand tools, snap & beat grid)
- Real-time Canvas compositing, transitions, shape masks, drop shadows, blend modes
- Interactive Chroma Key eyedropper, multi-shade keying, and localized key area drawing
- Motion keyframes (Linear, Ease-In, Ease-Out, Bezier) and Transform Presets
- Color grading (Basic, 3-Way Color Wheels, Auto Color, Color Match, `.cube` 3D LUTs, Batch Processor)
- Web Audio mixer, fades, 3-band EQ, compressor, reverb
- Local export to **MP4 (H.264/AAC via WebCodecs)**, **WebM**, **WAV**, **PNG frame**, **SRT**, **EDL**, and **FCPXML**
- Adjustable / resizable panels in Edit and Metrics modes
- Offline PWA caching
