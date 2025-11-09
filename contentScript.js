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
  undoStack.push(el.className);
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
     <div style="font-size:10px; color:#64748b; margin-bottom:8px; display:flex; gap:12px;">
       <span><span style="color:#22c55e;">●</span> Active</span>
       <span><span style="color:#64748b;">○</span> Inactive</span>
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
}

function showToast(message = "Copied!", duration = 1500) {
  const toast = document.createElement("div");
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    background: "#18181b",
    color: "#f1f5f9",
    padding: "10px 16px",
    borderRadius: "8px",
    fontSize: "13px",
    fontFamily: "Inter, sans-serif",
    fontWeight: "500",
    zIndex: 99999,
    opacity: "0",
    transform: "translateY(-10px)",
    transition: "all 0.2s ease",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
    border: "1px solid #334155",
  });

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  }, 10);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    setTimeout(() => toast.remove(), 200);
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
  const classList = el.className.trim().split(/\s+/).filter(cls => cls);
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

    // Add status dot indicator
    const statusDot = isActive
      ? '<span style="color:#22c55e; font-weight:700; font-size:12px;">●</span>'
      : '<span style="color:#64748b; font-weight:700; font-size:12px;">○</span>';

    li.innerHTML = `
      <span style="flex:1; display:flex; align-items:center; gap:8px;">
        <span style="color:#e2e8f0;">${cls}</span>
        ${statusDot}
      </span>
      <button data-remove="${cls}">x</button>`;

    li.style.display = "flex";
    li.style.justifyContent = "space-between";
    li.style.alignItems = "center";

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
