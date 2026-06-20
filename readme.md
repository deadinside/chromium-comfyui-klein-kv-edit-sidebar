# Klein KV Edit — Chrome/Edge Extension

A lightweight **image-to-image sidebar** for ComfyUI. Right-click any image (or video) on the
web to send it straight into your Klein KV / Flux2 KV i2i workflow, then iterate with a
fully customizable prompt builder, LoRA control, and live generation progress — all without
leaving the page.

Designed for fast iteration, prompt-driven edits, and LoRA-based style control.

---

## Features

**Send images & videos in**
- Right-click any web image → **Send to Klein KV Edit** → it uploads to ComfyUI and opens the sidebar.
- Right-click a video → **Send video to Klein KV Edit (pick a frame)** → scrub to the exact frame you want and capture it as the source image (videos are never uploaded — a single frame is).
- **Drag, drop, or paste** (Ctrl+V) an image directly into the sidebar.
- Click the **toolbar icon** to open the sidebar any time.

**Video → frame picker**
- Inline player with play/pause, a scrubbable timeline, and single-frame nudge buttons.
- **Capture frame → Source** grabs the current frame and loads it as the image.
- Close (✕) tears the player down when you're done.

**Prompt builder**
- Tabbed, savable, reusable prompt fragments.
- **Edit mode**: rename tabs, add/edit/delete fragments, and **delete tabs with a confirmation warning**.
- Toggle fragments on/off; the enabled ones combine into a live preview you can insert into the prompt.

**Generation controls**
- **LoRA dropdown** auto-scanned from your ComfyUI models, with a **strength slider**. The last-used LoRA and strength are remembered.
- **Seed** field with randomize and a **lock** toggle for reproducible results.
- **Real progress bar** driven by ComfyUI's WebSocket (actual sampler-step progress), with a **Cancel** button.
- **Inline result preview** with *Open* (full size in a new tab) and *↺ Reuse* (feed the result back in as the next source).

**Automatic LoRA bypass**
- If **None** is selected, the workflow is rewired to skip the LoRA node entirely.

---

## Requirements

- **ComfyUI running** (default `http://127.0.0.1:8188`, configurable in Options).
- **Chrome or Microsoft Edge** (uses the MV3 `sidePanel` API).
- **CORS enabled in ComfyUI** — see below.

### Enabling CORS in ComfyUI

The extension talks to ComfyUI directly from the browser (upload, LoRA scan, generation, and
the live-progress WebSocket), so ComfyUI must allow cross-origin requests.

- **Portable / manual launch:** add the flag to your start command:
  ```
  python main.py --enable-cors-header *
  ```
  (in the portable build, add `--enable-cors-header *` to `run_nvidia_gpu.bat` / your launcher args)

- **Desktop app:** enable CORS in **Settings** (server configuration → CORS / allowed origins).

If uploads fail or the progress bar never moves, CORS is the usual culprit.

---

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer Mode**.
4. Click **Load unpacked** and select the extension folder.
5. Open the extension **Options** and set your ComfyUI URL if it isn't the default.
6. (Optional) Pin the toolbar icon for one-click sidebar access.

---

## Usage

1. Right-click a web image (or video), or click the toolbar icon / drag-drop / paste an image.
2. For video: scrub to the frame you want and hit **Capture frame → Source**.
3. Enter your prompt (or build one in the Prompt Builder).
4. Pick a LoRA and strength (or leave as None), set a seed if you want to reproduce.
5. Click **Generate** and watch live progress. The result previews inline and opens in a new tab.

---

## How It Works

**Background service worker**
- Registers the right-click menus and opens the side panel on the user gesture.
- For images: fetches the clicked image and uploads it to ComfyUI (`/upload/image`), storing the filename.
- For videos: hands the source URL to the sidebar (the frame is captured client-side).
- Enables `openPanelOnActionClick` so the toolbar icon opens the panel.

**Sidebar**
- Loads the source image and the bundled workflow JSON.
- Injects prompt, LoRA (or bypass), strength, seed, and filename.
- Submits to `/prompt` with a stable `client_id`, then listens on the **`/ws`** WebSocket for
  step-by-step progress, falling back to polling `/history/{id}` for the final image.
- Captures video frames via an untainted canvas (the video is fetched as a `blob:` object URL,
  which keeps the canvas same-origin so the frame can be exported and uploaded).

**LoRA bypass logic**
- LoRA = None → `139.model = ["126", 0]` (base UNET).
- LoRA selected → `139.model = ["693", 0]` (LoRA wrapper).

---

## Folder Structure

```
/manifest.json
/background.js
/content-script.js
/KleinKVEdit_i2i_Plugin.json
/assets/icon128.png
/options/
    options.html
    options.js
    options.css
/sidebar/
    sidebar.html
    sidebar.js
    sidebar.css
    comfy.js          (workflow, upload, WebSocket progress, interrupt)
    promptBuilder.js  (tabs + savable fragments)
    loraScanner.js    (LoRA list + last-used memory)
```

---

## Known Limitations

- ComfyUI must be running **before** sending images, and **CORS must be enabled**.
- Only supports workflows using the same node IDs as the bundled `KleinKVEdit_i2i_Plugin.json`.
- **Streaming video** (YouTube and other MSE/`blob:` players) can't be loaded for frame capture —
  only direct video files (`.mp4`, `.webm`, etc.) work.
- In Edge, pin the sidebar for persistent visibility.

---

## Roadmap

- Optional negative-prompt support (workflow currently zeroes the negative branch).
- Multi-result history strip.

---

## License

MIT License — free to modify, extend, and integrate into your own tools.
