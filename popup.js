const inspectBtn = document.getElementById("startInspect");
const statusText = document.getElementById("statusText");

// Single place that renders inspection state, so the button label, the status
// row and the body state class can never drift apart.
function renderState(isInspecting) {
  document.body.classList.toggle("is-active", isInspecting);
  inspectBtn.textContent = isInspecting ? "Stop Inspecting" : "Start Inspecting";
  statusText.textContent = isInspecting
    ? "Inspecting this page"
    : "Inspection off";
}

chrome.storage.local.get("isInspecting", (res) => {
  renderState(res.isInspecting || false);
});

function showStatus(msg) {
  const el = document.getElementById("tw-status-msg");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 3000);
}

inspectBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.startsWith("http")) {
    showStatus("TailwindSight can't run on this page. Open a website first.");
    return;
  }

  chrome.storage.local.get("isInspecting", (res) => {
    const newState = !res.isInspecting;

    chrome.storage.local.set({ isInspecting: newState });
    renderState(newState);

    chrome.tabs.sendMessage(tab.id, {
      type: "TOGGLE_INSPECT_MODE",
      payload: newState,
    }).catch(() => {
      // Content script not running — page was open before the extension loaded
      showStatus("Reload the page, then try again.");
      chrome.storage.local.set({ isInspecting: !newState });
      renderState(!newState);
    });
  });
});
