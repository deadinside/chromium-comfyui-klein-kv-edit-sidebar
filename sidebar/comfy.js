// comfy.js — ComfyUI client for Klein KV Edit
// Handles: workflow loading, payload injection, image upload,
// real-time progress via WebSocket, interrupt, and result retrieval.

let COMFY_URL = "http://127.0.0.1:8188";

export function getComfyUrl() {
  return COMFY_URL;
}

export function setComfyUrl(url) {
  COMFY_URL = (url || COMFY_URL).replace(/\/+$/, "");
}

// Stable per-install client id so ComfyUI routes WS progress back to us.
export async function getClientId() {
  const { kvedit_client_id } = await chrome.storage.local.get("kvedit_client_id");
  if (kvedit_client_id) return kvedit_client_id;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ kvedit_client_id: id });
  return id;
}

// Load the KV workflow JSON bundled with the extension.
export async function loadWorkflow() {
  const res = await fetch(chrome.runtime.getURL("KleinKVEdit_i2i_Plugin.json"));
  return await res.json();
}

// Upload a Blob/File to ComfyUI's input folder. Returns { name, subfolder, type }.
export async function uploadImage(blob, filename = "kvedit_input.png") {
  const form = new FormData();
  form.append("image", blob, filename);
  form.append("overwrite", "true");

  const res = await fetch(`${COMFY_URL}/upload/image`, {
    method: "POST",
    body: form
  });
  if (!res.ok) throw new Error("Upload failed: HTTP " + res.status);
  return await res.json();
}

// Build a /view URL for an input or output image.
export function viewUrl(filename, type = "output", subfolder = "") {
  const params = new URLSearchParams({ filename, type });
  if (subfolder) params.set("subfolder", subfolder);
  return `${COMFY_URL}/view?${params.toString()}`;
}

// Inject UI values into the workflow graph.
export function buildPromptPayload(workflow, ui) {
  const wf = structuredClone(workflow);

  // 1. Uploaded filename → LoadImage (76)
  if (wf["76"]?.class_type === "LoadImage") {
    wf["76"].inputs.image = ui.uploadedFilename;
  }

  // 2. Positive prompt → CLIPTextEncode (135)
  if (wf["135"]?.class_type === "CLIPTextEncode") {
    wf["135"].inputs.text = ui.prompt;
  }

  // 3. LoRA → LoraLoaderModelOnly (693) OR bypass
  if (wf["693"]?.class_type === "LoraLoaderModelOnly") {
    if (ui.loraName) {
      wf["693"].inputs.lora_name = ui.loraName;
      wf["693"].inputs.strength_model =
        typeof ui.loraStrength === "number" ? ui.loraStrength : 1;
      // Route model through LoRA
      wf["139"].inputs.model = ["693", 0];
    } else {
      // Bypass: route model directly from UNETLoader (126)
      wf["693"].inputs.strength_model = 0;
      wf["139"].inputs.model = ["126", 0];
    }
  }

  // 4. Seed → RandomNoise (125)
  if (wf["125"]?.class_type === "RandomNoise") {
    wf["125"].inputs.noise_seed =
      typeof ui.seed === "number" ? ui.seed : Math.floor(Math.random() * 1e15);
  }

  return { prompt: wf };
}

export async function interrupt() {
  try {
    await fetch(`${COMFY_URL}/interrupt`, { method: "POST" });
  } catch (_) {
    /* best-effort */
  }
}

// Run a workflow with live progress.
//
// opts:
//   clientId   — string, ties WS progress to this request
//   onProgress — ({ value, max, ratio, node }) => void   (sampler steps)
//   onStage    — (label) => void                          (high-level status)
//   signal     — AbortSignal to cancel
//
// Resolves with { filename, url, subfolder }.
export async function runComfyWorkflow(payload, opts = {}) {
  const { clientId, onProgress, onStage, signal } = opts;
  const SAVE_NODE = "94";

  onStage?.("Queuing…");

  // Open the WebSocket first so we don't miss early messages.
  const wsUrl =
    COMFY_URL.replace(/^http/, "ws") +
    `/ws${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`;

  let ws = null;
  let promptId = null;
  let settled = false;
  let resolveFn, rejectFn;

  const done = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const cleanup = () => {
    if (ws && ws.readyState <= 1) {
      try { ws.close(); } catch (_) {}
    }
    ws = null;
  };

  const finish = (val) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveFn(val);
  };

  const fail = (err) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectFn(err);
  };

  if (signal) {
    if (signal.aborted) {
      fail(new DOMException("Aborted", "AbortError"));
      return done;
    }
    signal.addEventListener("abort", () => {
      interrupt();
      fail(new DOMException("Aborted", "AbortError"));
    });
  }

  // Resolve the saved image from a /history entry.
  const resultFromHistory = (entry) => {
    const out = entry?.outputs?.[SAVE_NODE];
    if (out?.images?.length) {
      const img = out.images[0];
      return {
        filename: img.filename,
        subfolder: img.subfolder || "",
        url: viewUrl(img.filename, "output", img.subfolder || "")
      };
    }
    return null;
  };

  // Fallback poll, in case the WS "executed" message is missed.
  const pollHistory = async () => {
    if (!promptId || settled) return;
    try {
      const history = await fetch(`${COMFY_URL}/history/${promptId}`).then(r => r.json());
      const result = resultFromHistory(history?.[promptId]);
      if (result) finish(result);
    } catch (_) {}
  };

  try {
    ws = new WebSocket(wsUrl);
  } catch (err) {
    // No WS available — fall back to plain polling after we have a promptId.
    ws = null;
  }

  if (ws) {
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return; // binary preview frames
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      const data = msg.data || {};

      // Ignore messages for other prompts once we know our id.
      if (promptId && data.prompt_id && data.prompt_id !== promptId) return;

      switch (msg.type) {
        case "progress": {
          const value = data.value || 0;
          const max = data.max || 1;
          onProgress?.({ value, max, ratio: max ? value / max : 0, node: data.node });
          break;
        }
        case "executing": {
          if (data.node) {
            onStage?.("Generating…");
          } else if (data.node === null && promptId && data.prompt_id === promptId) {
            // Execution finished for our prompt — grab the result.
            pollHistory();
          }
          break;
        }
        case "executed": {
          if (data.node === SAVE_NODE && data.output?.images?.length) {
            const img = data.output.images[0];
            onStage?.("Done");
            finish({
              filename: img.filename,
              subfolder: img.subfolder || "",
              url: viewUrl(img.filename, "output", img.subfolder || "")
            });
          }
          break;
        }
        case "execution_error": {
          fail(new Error(data.exception_message || "ComfyUI execution error"));
          break;
        }
      }
    };

    ws.onerror = () => { /* fall back to polling below */ };

    // Wait briefly for the socket to open before posting the prompt.
    await new Promise((resolve) => {
      if (ws.readyState === WebSocket.OPEN) return resolve();
      ws.onopen = resolve;
      setTimeout(resolve, 1200);
    });
  }

  // Submit the job.
  const body = JSON.stringify({ ...payload, client_id: clientId });
  let promptRes;
  try {
    promptRes = await fetch(`${COMFY_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    }).then(r => r.json());
  } catch (err) {
    fail(new Error("Could not reach ComfyUI at " + COMFY_URL));
    return done;
  }

  if (promptRes?.error || !promptRes?.prompt_id) {
    const detail =
      promptRes?.error?.message ||
      promptRes?.node_errors && JSON.stringify(promptRes.node_errors) ||
      "ComfyUI rejected the workflow";
    fail(new Error(detail));
    return done;
  }

  promptId = promptRes.prompt_id;
  onStage?.("Generating…");

  // Safety-net polling loop in case WS drops or messages are missed.
  const poller = setInterval(() => {
    if (settled) { clearInterval(poller); return; }
    pollHistory();
  }, 1500);

  done.finally(() => clearInterval(poller));

  return done;
}
