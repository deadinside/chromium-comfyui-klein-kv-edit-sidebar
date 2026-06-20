console.log("KV Edit content script loaded on:", location.href);
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg.type === "FETCH_IMAGE") {
    try {
      const blob = await fetch(msg.url).then(r => r.blob());
      const buffer = await blob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

      sendResponse({ ok: true, base64, type: blob.type });
    } catch (err) {
      sendResponse({ ok: false, error: err.toString() });
    }
  }

  return true; // keep channel open
});
