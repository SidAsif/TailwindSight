let panelEl;
window.__tw_selectedEl = null;
let lastHovered = null;
let inspectEnabled = false;
let highlightBox;
let undoStack = [];
let redoStack = [];

let tailwindClasses = [];

fetch(chrome.runtime.getURL("tailwind-classes.json"))
  .then((res) => res.json())
  .then((data) => {
    tailwindClasses = data;
    console.log("Loaded Tailwind classes:", data.length);
  })
  .catch((err) => console.error("Failed to load classes JSON", err));

// On load, check stored state
chrome.storage.local.get("isInspecting", (result) => {
  inspectEnabled = result.isInspecting || false;
  console.log("Initial Inspect Mode:", inspectEnabled);
  // Optionally start UI here if inspectEnabled is true
});

// Handle toggle messages
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TOGGLE_INSPECT_MODE") {
    inspectEnabled = message.payload;
    console.log("Tailwind Inspector Enabled:", inspectEnabled);
    if (!inspectEnabled) {
      removeHighlight();
      removePanel();
    }
  }
});

function isInsidePanel(el) {
  return el.closest("#tw-inspector-panel") !== null;
}

function saveState(el) {
  if (!el) return;
  undoStack.push(el.className);
  redoStack = [];
}

function highlightElement(el) {
  if (!el) return;
  if (highlightBox) highlightBox.remove();

  const rect = el.getBoundingClientRect();

  highlightBox = document.createElement("div");
  Object.assign(highlightBox.style, {
    position: "absolute",
    top: `${rect.top + window.scrollY}px`,
    left: `${rect.left + window.scrollX}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    border: "2px solid #3b82f6",
    borderRadius: "4px",
    boxShadow: "0 0 0 2px rgba(59,130,246,0.4)",
    pointerEvents: "none",
    zIndex: "99998",
  });

  document.body.appendChild(highlightBox);
}

function createPanel() {
  if (document.getElementById("tw-inspector-panel")) return;

  const panelHtml = `
<div id="tw-inspector-panel" style="display:none; position:absolute; z-index:99999;">
  <div class="tw-panel">
    <div class="tw-header">
      <span>ClassList</span>
        <div class="tw-actions" style="display: flex; flex-direction: row; gap: 8px; align-items: center;">
       <!-- Undo -->
<button id="tw-undo" title="Undo" style="background:none;border:none;color:white;font-size:16px;cursor:pointer;">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" width="20" height="20" viewBox="0 0 24 24">
    <path d="M9 14H4v-5" />
    <path d="M20 20a9 9 0 0 0-16-6.7L4 9" />
  </svg>
</button>

<!-- Redo -->
<button id="tw-redo" title="Redo" style="background:none;border:none;color:white;font-size:16px;cursor:pointer;">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" width="20" height="20" viewBox="0 0 24 24">
    <path d="M15 14h5v-5" />
    <path d="M4 20a9 9 0 0 1 16-6.7L20 9" />
  </svg>
</button>

<!-- Copy -->
<button id="tw-copy" title="Copy" style="background:none;border:none;color:white;font-size:16px;cursor:pointer;">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" width="20" height="20" viewBox="0 0 24 24">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
</button>

<!-- Close -->
<button id="tw-close" title="Close" style="background:none;border:none;color:white;font-size:16px;cursor:pointer;">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" width="20" height="20" viewBox="0 0 24 24">
    <path d="M18 6 6 18" />
    <path d="M6 6l12 12" />
  </svg>
</button>

        </div>
      </div>
     <ul id="tw-class-list"></ul>
   <div style="position:relative;">
      <input id="tw-add-input" type="text" placeholder="Add new class" />
      <ul id="tw-suggestions"></ul>
    </div>
<div id="tw-error-box"></div>
    <button id="tw-add-btn">Add Class</button>
    </div>
  </div>`;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = panelHtml;
  document.body.appendChild(wrapper);
  panelEl = document.getElementById("tw-inspector-panel");

  // Event handlers inside panel
  document.getElementById("tw-close").addEventListener("click", () => {
    panelEl.style.display = "none";
    window.__tw_selectedEl = null;
    if (highlightBox) highlightBox.remove();
  });

  document.getElementById("tw-copy").addEventListener("click", () => {
    navigator.clipboard
      .writeText(window.__tw_selectedEl?.className || "")
      .then(() => showToast("✅ Class copied!"))
      .catch(() => showToast("❌ Copy failed", 2000));
  });

  document.getElementById("tw-undo").addEventListener("click", () => {
    if (!window.__tw_selectedEl || undoStack.length === 0) return;
    redoStack.push(window.__tw_selectedEl.className);
    window.__tw_selectedEl.className = undoStack.pop();
    updatePanel(window.__tw_selectedEl);
  });

  document.getElementById("tw-redo").addEventListener("click", () => {
    if (!window.__tw_selectedEl || redoStack.length === 0) return;
    undoStack.push(window.__tw_selectedEl.className);
    window.__tw_selectedEl.className = redoStack.pop();
    updatePanel(window.__tw_selectedEl);
  });

  document.getElementById("tw-add-btn").addEventListener("click", () => {
    const input = document.getElementById("tw-add-input");
    const newClass = input.value.trim();
    if (!newClass || !window.__tw_selectedEl) return;

    if (!tailwindClasses.includes(newClass)) {
      showError("❌ Invalid Tailwind class");
      return;
    }

    saveState(window.__tw_selectedEl);
    window.__tw_selectedEl.classList.add(newClass);
    input.value = "";
    hideError();
    updatePanel(window.__tw_selectedEl);
  });

  const input = document.getElementById("tw-add-input");
  const suggestionBox = document.getElementById("tw-suggestions");

  input.addEventListener("input", () => {
    const query = input.value.trim();
    suggestionBox.innerHTML = "";

    if (tailwindClasses.includes(query)) {
      hideError();
    }

    if (!query) return (suggestionBox.style.display = "none");

    const matches = tailwindClasses
      .filter((cls) => cls.startsWith(query))
      .slice(0, 10);

    if (matches.length === 0) return (suggestionBox.style.display = "none");

    matches.forEach((match) => {
      const li = document.createElement("li");
      li.textContent = match;
      li.style.padding = "6px";
      li.style.cursor = "pointer";
      li.style.borderBottom = "1px solid #334155";

      li.addEventListener("mouseover", () => (li.style.background = "#334155"));
      li.addEventListener(
        "mouseout",
        () => (li.style.background = "transparent")
      );
      li.addEventListener("click", () => {
        saveState(window.__tw_selectedEl);
        window.__tw_selectedEl.classList.add(match);
        input.value = "";
        suggestionBox.style.display = "none";
        updatePanel(window.__tw_selectedEl);
        hideError();
      });

      suggestionBox.appendChild(li);
    });

    suggestionBox.style.display = "block";
  });

  input.addEventListener("blur", () => {
    setTimeout(() => (suggestionBox.style.display = "none"), 100);
  });
}

function showToast(message = "Copied!", duration = 1500) {
  const toast = document.createElement("div");
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed",
    top: "10px",
    right: "10px",
    background: "#22c55e",
    color: "white",
    padding: "8px 14px",
    borderRadius: "6px",
    fontSize: "14px",
    fontFamily: "sans-serif",
    zIndex: 99999,
    opacity: "0",
    transition: "opacity 0.2s ease",
  });

  document.body.appendChild(toast);
  setTimeout(() => (toast.style.opacity = "1"), 10);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function showError(message) {
  const errorBox = document.getElementById("tw-error-box");
  if (errorBox) errorBox.textContent = message;
}

function hideError() {
  const errorBox = document.getElementById("tw-error-box");
  if (errorBox) errorBox.textContent = "";
}

function updatePanel(el) {
  const classList = el.className.trim().split(/\s+/);
  const list = document.getElementById("tw-class-list");
  list.innerHTML = "";

  classList.forEach((cls) => {
    const li = document.createElement("li");
    li.innerHTML = `${cls}
      <button data-remove="${cls}" style="color:#f87171; float:right; border:none; background:none;">x</button>`;
    list.appendChild(li);
  });

  list.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const clsToRemove = e.target.dataset.remove;
      saveState(el);
      el.classList.remove(clsToRemove);
      updatePanel(el);
    });
  });
}

document.addEventListener("click", (e) => {
  if (!inspectEnabled) return;

  const el = e.target;
  if (!el || isInsidePanel(el)) return;
  if (lastHovered === el) return;
  lastHovered = el;

  if (!el.className) return;

  window.__tw_selectedEl = el;
  highlightElement(el);

  if (!panelEl) createPanel();

  updatePanel(el);

  const rect = el.getBoundingClientRect();
  const panelWidth = 270;
  const panelHeight = 220;

  let left = rect.left + window.scrollX + rect.width / 2 - panelWidth / 2 + 45;
  let top = rect.top + window.scrollY + rect.height / 2 - panelHeight / 2 + 35;

  if (left < 0) left = 10;
  if (top < 0) top = 10;
  if (left + panelWidth > window.innerWidth) {
    left = window.innerWidth - panelWidth - 10;
  }

  panelEl.style.left = `${left}px`;
  panelEl.style.top = `${top}px`;
  panelEl.style.display = "block";
});
