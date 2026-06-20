// promptBuilder.js — tabbed, savable, reusable prompt fragments.

const MAX_ROWS = 40;

let state = {
  tabs: [],
  activeTabId: null,
  presets: {}
};

function isEditMode() {
  return !!document.getElementById("editMode")?.checked;
}

async function loadState() {
  const data = await chrome.storage.sync.get(["promptBuilder"]);
  if (data.promptBuilder) state = data.promptBuilder;

  if (!state.tabs || state.tabs.length === 0) {
    const id = crypto.randomUUID();
    state = { tabs: [{ id, name: "General" }], activeTabId: id, presets: { [id]: [] } };
    saveState();
  }
  if (!state.activeTabId || !state.tabs.some(t => t.id === state.activeTabId)) {
    state.activeTabId = state.tabs[0].id;
  }
}

function saveState() {
  chrome.storage.sync.set({ promptBuilder: state });
}

/* ---- tabs -------------------------------------------------- */
function renderTabs() {
  const tabsEl = document.getElementById("builderTabs");
  const hint = document.getElementById("editHint");
  tabsEl.innerHTML = "";
  const edit = isEditMode();
  if (hint) hint.textContent = edit ? "Rename tabs, edit & reorder fragments" : "";

  state.tabs.forEach(tab => {
    const el = document.createElement("div");
    el.className = "tab" + (tab.id === state.activeTabId ? " active" : "");

    if (edit) {
      const name = document.createElement("input");
      name.className = "tab-name-input";
      name.value = tab.name;
      name.onchange = () => {
        tab.name = name.value.trim() || tab.name;
        name.value = tab.name;
        saveState();
      };
      name.onclick = () => activate(tab.id);

      const del = document.createElement("button");
      del.className = "tab-del";
      del.textContent = "×";
      del.title = "Delete tab";
      del.onclick = (e) => { e.stopPropagation(); deleteTab(tab.id); };

      el.appendChild(name);
      el.appendChild(del);
    } else {
      el.textContent = tab.name;
      el.onclick = () => activate(tab.id);
    }

    tabsEl.appendChild(el);
  });
}

function activate(id) {
  state.activeTabId = id;
  saveState();
  renderTabs();
  renderActiveTab();
}

function addTab() {
  const id = crypto.randomUUID();
  state.tabs.push({ id, name: `Tab ${state.tabs.length + 1}` });
  state.presets[id] = [];
  state.activeTabId = id;
  saveState();
  renderTabs();
  renderActiveTab();
}

function deleteTab(id) {
  if (state.tabs.length <= 1) {
    alert("You can't delete the last tab. Add another first.");
    return;
  }
  const tab = state.tabs.find(t => t.id === id);
  const count = (state.presets[id] || []).length;
  const msg = count
    ? `Delete tab "${tab.name}" and its ${count} saved fragment${count === 1 ? "" : "s"}?\n\nThis cannot be undone.`
    : `Delete tab "${tab.name}"?`;
  if (!confirm(msg)) return;

  state.tabs = state.tabs.filter(t => t.id !== id);
  delete state.presets[id];
  if (state.activeTabId === id) state.activeTabId = state.tabs[0].id;

  saveState();
  renderTabs();
  renderActiveTab();
}

/* ---- fragments --------------------------------------------- */
function renderActiveTab() {
  const content = document.getElementById("builderContent");
  content.innerHTML = "";

  const tabId = state.activeTabId;
  if (!tabId) return;
  const edit = isEditMode();
  const presets = state.presets[tabId] || (state.presets[tabId] = []);

  if (!presets.length && !edit) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = "No fragments yet. Turn on Edit mode to add some.";
    content.appendChild(note);
    updatePreview();
    return;
  }

  const list = document.createElement("div");
  list.className = "frag-list";

  presets.forEach(preset => {
    const frag = document.createElement("div");
    frag.className = "frag" + (!edit && preset.enabled ? " enabled" : "");

    if (!edit) {
      const view = document.createElement("label");
      view.className = "frag-view";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!preset.enabled;
      cb.onchange = () => {
        preset.enabled = cb.checked;
        frag.classList.toggle("enabled", cb.checked);
        saveState();
        updatePreview();
      };

      const textCol = document.createElement("div");
      const name = document.createElement("div");
      name.className = "frag-name";
      name.textContent = preset.nickname || "(unnamed)";
      const text = document.createElement("div");
      text.className = "frag-text";
      text.textContent = preset.prompt || "";
      textCol.appendChild(name);
      if (preset.prompt) textCol.appendChild(text);

      view.appendChild(cb);
      view.appendChild(textCol);
      frag.appendChild(view);
    } else {
      const wrap = document.createElement("div");
      wrap.className = "frag-edit";

      const name = document.createElement("input");
      name.className = "input";
      name.placeholder = "Fragment name";
      name.value = preset.nickname || "";
      name.onchange = () => { preset.nickname = name.value; saveState(); };

      const area = document.createElement("textarea");
      area.className = "textarea";
      area.rows = 2;
      area.placeholder = "Prompt text…";
      area.value = preset.prompt || "";
      area.onchange = () => { preset.prompt = area.value; saveState(); };

      const actions = document.createElement("div");
      actions.className = "frag-edit-actions";
      const del = document.createElement("button");
      del.className = "ghost-btn";
      del.textContent = "Delete";
      del.onclick = () => {
        state.presets[tabId] = presets.filter(p => p.id !== preset.id);
        saveState();
        renderActiveTab();
      };
      actions.appendChild(del);

      wrap.appendChild(name);
      wrap.appendChild(area);
      wrap.appendChild(actions);
      frag.appendChild(wrap);
    }

    list.appendChild(frag);
  });

  content.appendChild(list);

  if (edit && presets.length < MAX_ROWS) {
    const add = document.createElement("button");
    add.className = "add-frag";
    add.textContent = "+ Add fragment";
    add.onclick = () => {
      presets.push({ id: crypto.randomUUID(), nickname: "", prompt: "", enabled: false });
      saveState();
      renderActiveTab();
    };
    content.appendChild(add);
  }

  updatePreview();
}

function getCombinedPrompt() {
  const presets = state.presets[state.activeTabId] || [];
  return presets
    .filter(p => p.enabled && p.prompt)
    .map(p => p.prompt.trim())
    .join(", ");
}

function updatePreview() {
  const el = document.getElementById("builderPreview");
  if (el) el.value = getCombinedPrompt();
}

window.promptBuilder = {
  load: loadState,
  renderTabs,
  renderActiveTab,
  addTab,
  getCombined: getCombinedPrompt
};
