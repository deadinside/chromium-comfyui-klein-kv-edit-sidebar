document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('comfyUrl');
  const status = document.getElementById('status');

  chrome.storage.sync.get(['comfyUrl'], data => {
    if (data.comfyUrl) input.value = data.comfyUrl;
  });

  document.getElementById('save').onclick = () => {
    chrome.storage.sync.set({ comfyUrl: input.value.trim() }, () => {
      status.textContent = "Saved";
      setTimeout(() => (status.textContent = ""), 1500);
    });
  };
});
