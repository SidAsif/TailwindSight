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

function removeHighlight() {
  if (highlightBox) {
    highlightBox.remove();
    highlightBox = null;
  }
}

function removePanel() {
  if (panelEl) {
    panelEl.style.display = "none";
    window.__tw_selectedEl = null;
  }
}

function isInsidePanel(el) {
  return el.closest("#tw-inspector-panel") !== null;
}

function saveState(el) {
  if (!el) return;
  undoStack.push(el.getAttribute("class") || "");
  redoStack = [];
}

function validateTailwindClass(className) {
  // Remove leading/trailing whitespace
  className = className.trim();

  // Empty class is invalid
  if (!className) return false;

  // Remove ! prefix if present (important modifier)
  const classWithoutImportant = className.replace(/^!/, "");

  // Check for opacity modifier (e.g., text-gray-600/90)
  const parts = classWithoutImportant.split("/");
  let baseClass = parts[0];

  // Handle responsive/state prefixes (e.g., md:text-4xl, hover:bg-blue-500, dark:text-white)
  // Multiple prefixes are allowed: md:hover:text-4xl
  const prefixPattern = /^([a-z0-9]+:)+/;
  const coreClass = baseClass.replace(prefixPattern, "");

  // Check if core class exists in tailwindClasses
  if (tailwindClasses.includes(coreClass)) {
    return true;
  }

  // Check if base class (without prefixes) exists
  if (tailwindClasses.includes(baseClass)) {
    return true;
  }

  // Check for arbitrary values (e.g., text-[#123456], w-[100px], md:w-[100px])
  if (coreClass.includes("[") && coreClass.includes("]")) {
    // Extract the prefix before the bracket
    const prefix = coreClass.split("[")[0];
    // Check if any tailwind class starts with this prefix
    return tailwindClasses.some((cls) => cls.startsWith(prefix));
  }

  // Check if the full class (with opacity) exists
  if (tailwindClasses.includes(classWithoutImportant)) {
    return true;
  }

  return false;
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
    border: "2px solid #6366f1",
    borderRadius: "4px",
    boxShadow: "0 0 0 2px rgba(99, 102, 241, 0.2)",
    pointerEvents: "none",
    zIndex: "99998",
    background: "rgba(99, 102, 241, 0.05)",
    transition: "all 0.15s ease",
  });

  document.body.appendChild(highlightBox);
}

function createPanel() {
  if (document.getElementById("tw-inspector-panel")) return;

  const panelHtml = `
<div id="tw-inspector-panel" style="display:none; position:absolute; z-index:99999;">
  <div class="tw-panel">
    <div class="tw-header">
      <span id="tw-class-count">ClassList</span>
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

<!-- Copy HTML -->
<button id="tw-copy-html" title="Copy Element HTML" style="background:none;border:none;color:white;font-size:16px;cursor:pointer;">
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" width="20" height="20" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
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
     <div class="tw-filter-wrap">
       <svg class="tw-filter-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
         <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
       </svg>
       <input id="tw-filter-input" type="text" placeholder="Filter classes..." />
     </div>
     <ul id="tw-class-list"></ul>
     <div id="tw-filter-empty">No classes match</div>
     <div class="tw-legend">
       <span><span class="tw-status-dot tw-dot-active"></span> Active</span>
       <span><span class="tw-status-dot tw-dot-inactive"></span> Inactive / Overridden</span>
     </div>
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
      .writeText(window.__tw_selectedEl?.getAttribute("class") || "")
      .then(() => showToast("Classes copied!"))
      .catch(() => showToast("Copy failed", 2000, "error"));
  });

  document.getElementById("tw-copy-html").addEventListener("click", () => {
    navigator.clipboard
      .writeText(window.__tw_selectedEl?.outerHTML || "")
      .then(() => showToast("HTML copied!"))
      .catch(() => showToast("Copy failed", 2000, "error"));
  });

  document.getElementById("tw-undo").addEventListener("click", () => {
    if (!window.__tw_selectedEl || undoStack.length === 0) return;
    redoStack.push(window.__tw_selectedEl.getAttribute("class") || "");
    window.__tw_selectedEl.setAttribute("class", undoStack.pop());
    updatePanel(window.__tw_selectedEl);
  });

  document.getElementById("tw-redo").addEventListener("click", () => {
    if (!window.__tw_selectedEl || redoStack.length === 0) return;
    undoStack.push(window.__tw_selectedEl.getAttribute("class") || "");
    window.__tw_selectedEl.setAttribute("class", redoStack.pop());
    updatePanel(window.__tw_selectedEl);
  });

  document.getElementById("tw-add-btn").addEventListener("click", () => {
    const input = document.getElementById("tw-add-input");
    const newClass = input.value.trim();
    if (!newClass || !window.__tw_selectedEl) return;

    // Validate Tailwind class (support opacity modifiers, important, and arbitrary values)
    const isValidClass = validateTailwindClass(newClass);

    if (!isValidClass) {
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

    // Hide error if valid class (including opacity modifiers, etc.)
    if (validateTailwindClass(query)) {
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
      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // Prevent input from losing focus
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
    setTimeout(() => (suggestionBox.style.display = "none"), 200);
  });

  document.getElementById("tw-filter-input").addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase().trim();
    let visible = 0;
    document.querySelectorAll("#tw-class-list li").forEach((li) => {
      const matches = query === "" || (li.dataset.cls || "").includes(query);
      li.style.display = matches ? "" : "none";
      if (matches) visible++;
    });
    const emptyEl = document.getElementById("tw-filter-empty");
    if (emptyEl) emptyEl.style.display = visible === 0 && query !== "" ? "block" : "none";
  });
}

function showToast(message = "Done!", duration = 1500, type = "success") {
  const isError = type === "error";

  const icon = isError
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linecap="round" width="13" height="13">
        <path d="M18 6L6 18M6 6l12 12"/>
       </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#a3e635" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
        <path d="M5 13l4 4L19 7"/>
       </svg>`;

  const toast = document.createElement("div");
  toast.innerHTML = `
    <span style="display:flex;align-items:center;flex-shrink:0;">${icon}</span>
    <span>${message}</span>
  `;

  Object.assign(toast.style, {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%) translateY(6px)",
    background: "#111827",
    color: "#f1f5f9",
    padding: "9px 14px",
    borderRadius: "8px",
    fontSize: "12.5px",
    fontFamily: "Inter, sans-serif",
    fontWeight: "500",
    letterSpacing: "0.01em",
    zIndex: "2147483647",
    opacity: "0",
    transition: "opacity 0.15s ease, transform 0.15s ease",
    boxShadow: "0 2px 12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  });

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  }, 10);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(6px)";
    setTimeout(() => toast.remove(), 150);
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
  const classList = (el.getAttribute("class") || "").trim().split(/\s+/).filter(cls => cls);

  const countEl = document.getElementById("tw-class-count");
  if (countEl) countEl.textContent = `ClassList (${classList.length})`;

  const list = document.getElementById("tw-class-list");
  list.innerHTML = "";

  // Get computed styles to check if classes are actually applied
  const computedStyle = window.getComputedStyle(el);

  // Find conflicting classes (later ones override earlier ones)
  const conflicts = findConflictingClasses(classList);

  classList.forEach((cls, index) => {
    const li = document.createElement("li");

    // Check if this class is overridden by a later conflicting class
    const isOverridden = conflicts[index];

    // Check if this class is likely having an effect
    const isActive = !isOverridden && isClassActive(cls, el, computedStyle);

    li.dataset.cls = cls;
    li.innerHTML = `
      <span class="tw-cls-label${isActive ? '' : ' tw-cls-inactive'}">
        <span class="tw-status-dot ${isActive ? 'tw-dot-active' : 'tw-dot-inactive'}" title="${isActive ? 'Active' : 'Overridden or inactive'}"></span>
        <span class="tw-cls-name">${cls}</span>
      </span>
      <button class="tw-remove-btn" data-remove="${cls}" title="Remove ${cls}">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="12" height="12">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>`;

    list.appendChild(li);
  });

  list.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const clsToRemove = e.target.closest("button[data-remove]").dataset.remove;
      saveState(el);
      el.classList.remove(clsToRemove);
      updatePanel(el);
    });
  });

  // Reapply active filter after re-render
  const filterInput = document.getElementById("tw-filter-input");
  if (filterInput && filterInput.value.trim()) {
    const query = filterInput.value.toLowerCase().trim();
    let visible = 0;
    list.querySelectorAll("li").forEach((li) => {
      const matches = (li.dataset.cls || "").includes(query);
      li.style.display = matches ? "" : "none";
      if (matches) visible++;
    });
    const emptyEl = document.getElementById("tw-filter-empty");
    if (emptyEl) emptyEl.style.display = visible === 0 ? "block" : "none";
  }
}

function findConflictingClasses(classList) {
  // Returns an array where true means the class at that index is overridden
  const overridden = new Array(classList.length).fill(false);

  // Property groups that conflict with each other
  const propertyGroups = {
    // Font size (text-xl, text-2xl, etc.)
    fontSize: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/,
    // Text color
    textColor: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*text-\w+(-\d+)?(\/\d+)?$/,
    // Background color
    bgColor: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*bg-\w+(-\d+)?(\/\d+)?$/,
    // Display
    display: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*(block|inline|inline-block|flex|inline-flex|grid|hidden)$/,
    // Width
    width: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*w-/,
    // Height
    height: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*h-/,
    // Padding
    padding: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*p-/,
    paddingX: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*px-/,
    paddingY: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*py-/,
    paddingTop: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*pt-/,
    paddingBottom: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*pb-/,
    paddingLeft: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*pl-/,
    paddingRight: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*pr-/,
    // Margin (similar to padding)
    margin: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*m-/,
    marginX: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*mx-/,
    marginY: /^(md:|lg:|xl:|2xl:|sm:|hover:|focus:|dark:|active:|disabled:|group-hover:)*my-/,
  };

  // For each class, check if a later class in the same property group overrides it
  for (let i = 0; i < classList.length; i++) {
    const currentClass = classList[i];

    // Extract prefix (e.g., "md:", "hover:", etc.)
    const currentPrefix = currentClass.match(/^([a-z0-9]+:)*/)?.[0] || '';

    for (let j = i + 1; j < classList.length; j++) {
      const laterClass = classList[j];
      const laterPrefix = laterClass.match(/^([a-z0-9]+:)*/)?.[0] || '';

      // Only check for conflicts if they have the same prefix (same breakpoint/state)
      if (currentPrefix === laterPrefix) {
        // Check each property group
        for (const group of Object.values(propertyGroups)) {
          if (group.test(currentClass) && group.test(laterClass)) {
            // Same property group and same prefix - later one wins
            overridden[i] = true;
            break;
          }
        }
      }
    }
  }

  return overridden;
}

function isClassActive(className, el, computedStyle) {
  // Simple heuristic to check if a class is likely active
  // This checks for common Tailwind patterns

  // Hidden class check
  if (className.includes('hidden') || className.includes('invisible')) {
    return computedStyle.display === 'none' || computedStyle.visibility === 'hidden';
  }

  // Display classes
  if (className.match(/^(block|inline|flex|grid|table)/)) {
    return true; // Display classes are usually active if element is visible
  }

  // Color classes (text, bg, border)
  if (className.match(/^(text|bg|border)-/)) {
    return true; // Color classes are typically active
  }

  // Spacing classes (p, m, gap, space)
  if (className.match(/^(p|m|gap|space)-/)) {
    return true;
  }

  // Size classes
  if (className.match(/^(w|h|min|max)-/)) {
    return true;
  }

  // Responsive classes - assume active (can't easily check)
  if (className.includes(':')) {
    return true; // Show as active since we can't determine responsiveness easily
  }

  // Default: assume active for most Tailwind classes
  return true;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && panelEl && panelEl.style.display !== "none") {
    panelEl.style.display = "none";
    window.__tw_selectedEl = null;
    removeHighlight();
  }
});

document.addEventListener("click", (e) => {
  if (!inspectEnabled) return;

  const el = e.target;
  if (!el || isInsidePanel(el)) return;
  if (lastHovered === el) return;
  lastHovered = el;

  if (!el.getAttribute("class")) return;

  window.__tw_selectedEl = el;
  highlightElement(el);

  if (!panelEl) createPanel();

  const filterInput = document.getElementById("tw-filter-input");
  if (filterInput) filterInput.value = "";

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
