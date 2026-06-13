const inspectBtn = document.getElementById("startInspect");

chrome.storage.local.get("isInspecting", (res) => {
  const current = res.isInspecting || false;
  inspectBtn.textContent = current ? "Stop Inspecting" : "Start Inspecting";
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
    inspectBtn.textContent = newState ? "Stop Inspecting" : "Start Inspecting";

    chrome.tabs.sendMessage(tab.id, {
      type: "TOGGLE_INSPECT_MODE",
      payload: newState,
    }).catch(() => {
      // Content script not running — page was open before the extension loaded
      showStatus("Reload the page, then try again.");
      chrome.storage.local.set({ isInspecting: !newState });
      inspectBtn.textContent = !newState ? "Stop Inspecting" : "Start Inspecting";
    });
  });
});
