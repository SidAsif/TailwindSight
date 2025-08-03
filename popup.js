const inspectBtn = document.getElementById("startInspect");

chrome.storage.local.get("isInspecting", (res) => {
  const current = res.isInspecting || false;
  inspectBtn.textContent = current ? "Stop Inspecting" : "Start Inspecting";
});

inspectBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.storage.local.get("isInspecting", (res) => {
    const newState = !res.isInspecting;

    chrome.storage.local.set({ isInspecting: newState });

    inspectBtn.textContent = newState ? "Stop Inspecting" : "Start Inspecting";

    chrome.tabs.sendMessage(tab.id, {
      type: "TOGGLE_INSPECT_MODE",
      payload: newState,
    });
  });
});
