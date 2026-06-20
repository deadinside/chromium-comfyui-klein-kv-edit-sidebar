import {
  loadWorkflow, buildPromptPayload, runComfyWorkflow,
  setComfyUrl, getClientId, uploadImage, viewUrl, interrupt
} from "./comfy.js";

document.addEventListener("DOMContentLoaded", async () => {
  const $ = (id) => document.getElementById(id);

  // elements
  const dropZone   = $("dropZone");
  const preview    = $("imagePreview");
  const dropHint   = $("dropHint");
  const imageMeta  = $("imageMeta");
  const clearImage = $("clearImage");

  const promptEl   = $("prompt");
  const builderPanel = $("builderPanel");
  const toggleBuilder = $("toggleBuilder");

  const loraSelect = $("loraSelect");
  const loraStrength = $("loraStrength");
  const loraStrengthVal = $("loraStrengthVal");
  const loraStrengthRow = $("loraStrengthRow");

  const seedEl   = $("seed");
  const seedLock = $("seedLock");
  const randomSeed = $("randomSeed");

  const generateBtn = $("generate");
  const cancelBtn   = $("cancel");
  const progressWrap = $("progressWrap");
  const progressFill = $("progressFill");
  const progressStage = $("progressStage");
  const progressPct = $("progressPct");

  const resultWrap = $("resultWrap");
  const resultPreview = $("resultPreview");
  const openResult = $("openResult");
  const useResult = $("useResult");

  // video frame picker
  const videoPanel = $("videoPanel");
  const videoEl = $("videoEl");
  const videoLoading = $("videoLoading");
  const playPause = $("playPause");
  const videoScrub = $("videoScrub");
  const videoTime = $("videoTime");
  const captureFrame = $("captureFrame");
  const closeVideo = $("closeVideo");
  const stepBack = $("stepBack");
  const stepFwd = $("stepFwd");
  let videoObjectUrl = null;

  let comfyBase = "http://127.0.0.1:8188";
  let currentRun = null; // AbortController while generating
  let lastResultUrl = null;

  /* ---- init ------------------------------------------------ */
  const { comfyUrl } = await chrome.storage.sync.get(["comfyUrl"]);
  comfyBase = (comfyUrl || comfyBase).replace(/\/+$/, "");
  setComfyUrl(comfyBase);

  await window.loraScanner.load();
  await window.promptBuilder.load();
  window.promptBuilder.renderTabs();
  window.promptBuilder.renderActiveTab();

  await restoreControls();
  loadImageFromStorage();
  loadVideoFromStorage();

  /* ---- toast ----------------------------------------------- */
  let toastTimer = null;
  function toast(message, bad = false) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      document.body.appendChild(el);
    }
    el.className = "toast" + (bad ? " bad" : "");
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 3200);
  }

  /* ---- restore persisted control state --------------------- */
  async function restoreControls() {
    const local = await chrome.storage.local.get([
      "kvedit_last_lora", "kvedit_last_lora_strength",
      "kvedit_seed", "kvedit_seed_locked"
    ]);

    if (local.kvedit_last_lora &&
        [...loraSelect.options].some(o => o.value === local.kvedit_last_lora)) {
      loraSelect.value = local.kvedit_last_lora;
    }
    const str = typeof local.kvedit_last_lora_strength === "number"
      ? local.kvedit_last_lora_strength : 1;
    loraStrength.value = str;
    syncStrengthUI();

    if (local.kvedit_seed_locked) {
      seedLock.checked = true;
      if (local.kvedit_seed) seedEl.value = local.kvedit_seed;
    }
  }

  function syncStrengthUI() {
    loraStrengthVal.textContent = Number(loraStrength.value).toFixed(2);
    const none = !loraSelect.value;
    loraStrengthRow.classList.toggle("hidden", none);
    loraStrengthVal.classList.toggle("hidden", none);
  }

  /* ---- image ----------------------------------------------- */
  function showImage(src) {
    preview.src = src;
    preview.classList.remove("hidden");
    dropHint.classList.add("hidden");
    dropZone.classList.add("has-image");
    clearImage.classList.remove("hidden");
  }

  function showNoImage() {
    preview.classList.add("hidden");
    preview.removeAttribute("src");
    dropHint.classList.remove("hidden");
    dropZone.classList.remove("has-image");
    clearImage.classList.add("hidden");
    imageMeta.classList.add("hidden");
    imageMeta.textContent = "";
  }

  preview.onload = () => {
    if (preview.naturalWidth) {
      imageMeta.textContent = `${preview.naturalWidth} × ${preview.naturalHeight}px`;
      imageMeta.classList.remove("hidden");
    }
  };

  function loadImageFromStorage() {
    chrome.storage.local.get(
      ["kvedit_input_image", "kvedit_source_preview"],
      data => {
        const filename = data.kvedit_input_image;
        const previewUrl = data.kvedit_source_preview;
        if (!filename && !previewUrl) return showNoImage();

        if (filename) showImage(viewUrl(filename, "input"));
        else if (previewUrl) showImage(previewUrl);
      }
    );
  }

  async function ingestBlob(blob, name = "kvedit_input.png") {
    if (!blob || !blob.type.startsWith("image/")) {
      toast("That doesn't look like an image.", true);
      return;
    }
    try {
      dropZone.classList.add("dragover");
      const localUrl = URL.createObjectURL(blob);
      showImage(localUrl);
      const res = await uploadImage(blob, name);
      await chrome.storage.local.set({
        kvedit_input_image: res.name,
        kvedit_source_preview: ""
      });
      // swap to the canonical ComfyUI view once uploaded
      showImage(viewUrl(res.name, "input"));
      URL.revokeObjectURL(localUrl);
      toast("Image uploaded.");
    } catch (err) {
      console.error(err);
      toast("Upload failed — is ComfyUI running?", true);
      loadImageFromStorage();
    } finally {
      dropZone.classList.remove("dragover");
    }
  }

  // drag & drop
  ["dragenter", "dragover"].forEach(ev =>
    dropZone.addEventListener(ev, e => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    })
  );
  ["dragleave", "dragend"].forEach(ev =>
    dropZone.addEventListener(ev, () => dropZone.classList.remove("dragover"))
  );
  dropZone.addEventListener("drop", async e => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file) return ingestBlob(file, file.name);
    // dragged image URL from another page
    const url = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain");
    if (url) {
      try {
        const blob = await fetch(url).then(r => r.blob());
        ingestBlob(blob);
      } catch { toast("Couldn't fetch that image.", true); }
    }
  });

  // paste
  document.addEventListener("paste", e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
    if (item) ingestBlob(item.getAsFile());
  });

  clearImage.onclick = async () => {
    await chrome.storage.local.remove(["kvedit_input_image", "kvedit_source_preview"]);
    showNoImage();
  };

  // background.js pushes new right-click images / videos here
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.kvedit_input_image || changes.kvedit_source_preview) loadImageFromStorage();
    if (changes.kvedit_video_url) loadVideoFromStorage();
  });

  /* ---- video frame picker ---------------------------------- */
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  function teardownVideo() {
    try { videoEl.pause(); } catch (_) {}
    videoEl.removeAttribute("src");
    videoEl.load();
    if (videoObjectUrl) { URL.revokeObjectURL(videoObjectUrl); videoObjectUrl = null; }
  }

  function loadVideoFromStorage() {
    chrome.storage.local.get(["kvedit_video_url"], async ({ kvedit_video_url: url }) => {
      if (!url) { videoPanel.classList.add("hidden"); return; }

      videoPanel.classList.remove("hidden");
      videoLoading.classList.remove("hidden");
      videoLoading.textContent = "Loading video…";
      teardownVideo();
      videoPanel.scrollIntoView({ behavior: "smooth", block: "start" });

      // blob: URLs from streaming players (e.g. MSE/YouTube) can't be re-fetched.
      if (url.startsWith("blob:")) {
        videoLoading.textContent = "This video uses a protected stream that can't be loaded here.";
        return;
      }

      try {
        // Extension page fetch bypasses page CORS (host_permissions: <all_urls>),
        // and a blob: object URL keeps the canvas untainted for frame capture.
        const blob = await fetch(url).then(r => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.blob();
        });
        videoObjectUrl = URL.createObjectURL(blob);
        videoEl.src = videoObjectUrl;
      } catch (err) {
        console.warn("Video fetch failed, trying direct source:", err);
        // Fallback: play directly (capture may fail if the host blocks CORS).
        videoEl.crossOrigin = "anonymous";
        videoEl.src = url;
      }
    });
  }

  videoEl.addEventListener("loadeddata", () => {
    videoLoading.classList.add("hidden");
    updateVideoTime();
  });
  videoEl.addEventListener("error", () => {
    videoLoading.classList.remove("hidden");
    videoLoading.textContent = "Couldn't load this video (format or CORS).";
  });

  function updateVideoTime() {
    const d = videoEl.duration || 0;
    const t = videoEl.currentTime || 0;
    videoTime.textContent = `${fmtTime(t)} / ${fmtTime(d)}`;
    if (d) videoScrub.value = Math.round((t / d) * 1000);
  }

  videoEl.addEventListener("timeupdate", updateVideoTime);
  videoEl.addEventListener("play",  () => { playPause.textContent = "❚❚"; });
  videoEl.addEventListener("pause", () => { playPause.textContent = "▶"; });
  videoEl.addEventListener("ended", () => { playPause.textContent = "▶"; });

  playPause.onclick = () => { videoEl.paused ? videoEl.play() : videoEl.pause(); };

  videoScrub.oninput = () => {
    const d = videoEl.duration || 0;
    if (d) {
      videoEl.currentTime = (Number(videoScrub.value) / 1000) * d;
      videoTime.textContent = `${fmtTime(videoEl.currentTime)} / ${fmtTime(d)}`;
    }
  };

  const FRAME = 1 / 30; // ~one frame nudge
  stepBack.onclick = () => { videoEl.pause(); videoEl.currentTime = Math.max(0, videoEl.currentTime - FRAME); };
  stepFwd.onclick  = () => { videoEl.pause(); videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + FRAME); };

  captureFrame.onclick = async () => {
    if (!videoEl.videoWidth) return toast("Video not ready yet.", true);
    videoEl.pause();
    try {
      const canvas = document.createElement("canvas");
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      canvas.getContext("2d").drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((res, rej) =>
        canvas.toBlob(b => b ? res(b) : rej(new Error("toBlob failed")), "image/png")
      );
      await ingestBlob(blob, "kvedit_frame.png");
      toast("Frame captured → source image.");
    } catch (err) {
      console.error(err);
      // SecurityError → tainted canvas (cross-origin video without CORS)
      toast("Couldn't capture this frame (cross-origin video).", true);
    }
  };

  closeVideo.onclick = async () => {
    teardownVideo();
    videoPanel.classList.add("hidden");
    await chrome.storage.local.remove(["kvedit_video_url", "kvedit_video_page"]);
  };

  /* ---- prompt + builder ------------------------------------ */
  toggleBuilder.onclick = () => {
    const hidden = builderPanel.classList.toggle("hidden");
    toggleBuilder.textContent = hidden ? "Builder" : "Hide builder";
  };

  $("clearPrompt").onclick = () => { promptEl.value = ""; promptEl.focus(); };

  $("editMode").onchange = () => {
    window.promptBuilder.renderTabs();
    window.promptBuilder.renderActiveTab();
  };
  $("addTab").onclick = () => window.promptBuilder.addTab();

  $("applyBuilder").onclick = () => {
    const combined = window.promptBuilder.getCombined();
    if (!combined) return toast("No fragments enabled.");
    promptEl.value = promptEl.value.trim()
      ? `${promptEl.value.trim()}, ${combined}`
      : combined;
    toast("Inserted into prompt.");
  };

  /* ---- lora + seed ----------------------------------------- */
  loraSelect.onchange = () => {
    chrome.storage.local.set({ kvedit_last_lora: loraSelect.value });
    syncStrengthUI();
  };
  loraStrength.oninput = () => {
    loraStrengthVal.textContent = Number(loraStrength.value).toFixed(2);
  };
  loraStrength.onchange = () => {
    chrome.storage.local.set({ kvedit_last_lora_strength: Number(loraStrength.value) });
  };

  randomSeed.onclick = () => {
    seedEl.value = Math.floor(Math.random() * 1e15);
    persistSeed();
  };
  seedLock.onchange = persistSeed;
  seedEl.onchange = persistSeed;
  function persistSeed() {
    chrome.storage.local.set({
      kvedit_seed_locked: seedLock.checked,
      kvedit_seed: seedEl.value
    });
  }

  /* ---- generate -------------------------------------------- */
  function setBusy(busy) {
    generateBtn.disabled = busy;
    generateBtn.classList.toggle("busy", busy);
    generateBtn.querySelector(".generate-label").textContent = busy ? "Generating…" : "Generate";
    cancelBtn.classList.toggle("hidden", !busy);
    progressWrap.classList.toggle("hidden", !busy);
    if (busy) setProgress(null, "Queuing…");
  }

  function setProgress(ratio, stage) {
    if (stage) progressStage.textContent = stage;
    if (ratio == null) {
      progressFill.classList.add("indeterminate");
      progressFill.style.width = "";
      progressPct.textContent = "";
    } else {
      progressFill.classList.remove("indeterminate");
      const pct = Math.round(ratio * 100);
      progressFill.style.width = pct + "%";
      progressPct.textContent = pct + "%";
    }
  }

  generateBtn.onclick = async () => {
    const prompt = promptEl.value.trim();
    if (!prompt) return toast("Enter a prompt first.", true);

    const { kvedit_input_image: filename } =
      await chrome.storage.local.get(["kvedit_input_image"]);
    if (!filename) return toast("No image loaded — right-click or drop one in.", true);

    // seed
    let seed;
    if (seedLock.checked && seedEl.value.trim()) {
      seed = parseInt(seedEl.value.trim(), 10);
    } else {
      seed = Math.floor(Math.random() * 1e15);
      seedEl.value = seed; // surface it so the user can lock to reproduce
    }

    const loraName = loraSelect.value || "";
    const strength = Number(loraStrength.value);

    setBusy(true);
    resultWrap.classList.add("hidden");
    const controller = new AbortController();
    currentRun = controller;

    try {
      const [workflow, clientId] = await Promise.all([loadWorkflow(), getClientId()]);
      const payload = buildPromptPayload(workflow, {
        uploadedFilename: filename,
        prompt,
        loraName,
        loraStrength: strength,
        seed
      });

      const result = await runComfyWorkflow(payload, {
        clientId,
        signal: controller.signal,
        onStage: (label) => { if (label) progressStage.textContent = label; },
        onProgress: ({ ratio }) => setProgress(ratio, "Generating…")
      });

      if (result?.url) {
        lastResultUrl = result.url;
        resultPreview.src = result.url + (result.url.includes("?") ? "&" : "?") + "t=" + Date.now();
        resultWrap.classList.remove("hidden");
        window.open(result.url, "_blank");
        toast("Done.");
      }
    } catch (err) {
      if (err?.name === "AbortError") toast("Generation cancelled.");
      else { console.error(err); toast(err.message || "Generation failed.", true); }
    } finally {
      currentRun = null;
      setBusy(false);
    }
  };

  cancelBtn.onclick = () => {
    interrupt();
    currentRun?.abort();
  };

  /* ---- result actions -------------------------------------- */
  openResult.onclick = () => { if (lastResultUrl) window.open(lastResultUrl, "_blank"); };
  useResult.onclick = async () => {
    if (!lastResultUrl) return;
    try {
      const blob = await fetch(lastResultUrl).then(r => r.blob());
      await ingestBlob(blob, "kvedit_reuse.png");
    } catch { toast("Couldn't reuse that result.", true); }
  };

  /* ---- options --------------------------------------------- */
  $("openOptions").onclick = () => chrome.runtime.openOptionsPage();
});
