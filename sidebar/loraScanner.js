// loraScanner.js — populate the LoRA dropdown from ComfyUI and
// restore the last-used selection.

window.loraScanner = {
  async load() {
    const select = document.getElementById("loraSelect");
    const current = select.value;
    select.innerHTML = '<option value="">None (base model)</option>';

    const { comfyUrl } = await chrome.storage.sync.get(["comfyUrl"]);
    const { kvedit_last_lora } = await chrome.storage.local.get(["kvedit_last_lora"]);

    if (!comfyUrl) {
      console.warn("KV Edit: No ComfyUI URL set.");
      return;
    }

    const base = comfyUrl.replace(/\/+$/, "");
    try {
      const res = await fetch(`${base}/models/loras`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const loras = await res.json(); // array of strings

      loras.forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
      });

      // Restore selection: prefer what was already chosen this session,
      // otherwise the persisted last-used LoRA.
      const want = current || kvedit_last_lora || "";
      if (want && loras.includes(want)) select.value = want;

    } catch (e) {
      console.error("KV Edit: Failed to load LoRAs", e);
    }
  }
};
