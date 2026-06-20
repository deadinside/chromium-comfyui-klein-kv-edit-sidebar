// Clicking the toolbar icon opens the side panel.
chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(err => console.error("KV Edit: setPanelBehavior failed", err));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "send-to-klein-kv",
    title: "Send to Klein KV Edit",
    contexts: ["image"]
  });
  chrome.contextMenus.create({
    id: "send-video-to-klein-kv",
    title: "Send video to Klein KV Edit (pick a frame)",
    contexts: ["video"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // ⭐ Opening the side panel MUST be synchronous — user gesture still active
  if (chrome.sidePanel && chrome.sidePanel.open) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }

  if (info.menuItemId === "send-video-to-klein-kv") {
    // Videos can't be uploaded — hand the source URL to the sidebar, which
    // fetches it, lets the user scrub, and captures a frame as the image.
    chrome.storage.local.set({
      kvedit_video_url: info.srcUrl,
      kvedit_video_page: info.pageUrl || ""
    });
    chrome.runtime.sendMessage({ type: "KVEDIT_VIDEO_READY" });
    return;
  }

  if (info.menuItemId !== "send-to-klein-kv") return;

  // ⭐ Now do async work AFTER opening the sidebar
  (async () => {
    try {
      const blob = await fetch(info.srcUrl).then(r => r.blob());

      const form = new FormData();
      form.append("image", blob, "context_image.png");

      const { comfyUrl } = await chrome.storage.sync.get("comfyUrl");
      const baseUrl = comfyUrl || "http://127.0.0.1:8188";

      const uploadRes = await fetch(`${baseUrl}/upload/image`, {
        method: "POST",
        body: form
      }).then(r => r.json());

      const filename = uploadRes.name;

      await chrome.storage.local.set({
        kvedit_input_image: filename,
        kvedit_source_preview: info.srcUrl
      });

      // ⭐ Notify sidebar to refresh
      chrome.runtime.sendMessage({ type: "KVEDIT_IMAGE_READY" });

    } catch (err) {
      console.error("KV Edit: Failed to fetch image:", err);

      await chrome.storage.local.set({
        kvedit_error: {
          type: "fetch_failed",
          message: err?.message || "Unknown error"
        }
      });

      chrome.runtime.sendMessage({ type: "KVEDIT_ERROR" });
    }
  })();
});
