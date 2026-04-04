/**
 * PromptCraft – Popup Script (v1.1.0)
 * Security hardened + live model auto-detection.
 */

(function () {
  "use strict";

  const saveBtn     = document.getElementById("save-btn");
  const clearBtn    = document.getElementById("clear-btn");
  const apiInput    = document.getElementById("api-key-input");
  const saveLabel   = document.getElementById("save-label");
  const statusBadge = document.getElementById("status-badge");
  const badgeLabel  = document.getElementById("badge-label");
  const toggleBtn   = document.getElementById("toggle-visibility");
  const detectBtn   = document.getElementById("detect-btn");
  const detectLabel = document.getElementById("detect-label");
  const modelDot    = document.getElementById("model-dot");
  const modelName   = document.getElementById("model-name");
  const footerModel = document.getElementById("footer-model");
  const promptTypeInputs = document.querySelectorAll('input[name="prompt-type"]');
  const PROMPT_TYPE_DEFAULT = "refactor";

  // ─── Sanitization & validation ────────────────────────────────────────────
  function sanitizeApiKey(raw) {
    return raw.replace(/[^\x20-\x7E]/g, "").trim();
  }
  function isValidKeyFormat(key) {
    return /^AIza[A-Za-z0-9_\-]{35,}$/.test(key);
  }

  // ─── Model detection ──────────────────────────────────────────────────────
  const FALLBACK_MODELS = [
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.5-flash-preview-04-17",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b-latest",
    "gemini-1.5-pro-latest",
  ];

  async function fetchAvailableModels(apiKey) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=50`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.models || [])
      .filter(m =>
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes("generateContent") &&
        /gemini.*(flash|pro)/i.test(m.name) &&
        !/embed|vision|aqa/i.test(m.name)
      )
      .map(m => m.name.replace("models/", ""))
      .sort((a, b) => {
        const score = n => /lite/i.test(n) ? 0 : /flash/i.test(n) ? 1 : 2;
        return score(a) - score(b);
      });
  }

  async function pingModel(apiKey, model) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "hi" }] }],
          generationConfig: { maxOutputTokens: 5 }
        })
      }
    );
    return res.ok;
  }

  async function autoDetectModel(apiKey) {
    setModelUI("detecting", "Fetching model list…");

    let models;
    try {
      models = await fetchAvailableModels(apiKey);
      if (models.length === 0) throw new Error("Empty list");
    } catch (e) {
      setModelUI("detecting", "Using fallback list…");
      models = FALLBACK_MODELS;
    }

    for (const m of models) {
      setModelUI("detecting", `Testing ${m}…`);
      try {
        const ok = await pingModel(apiKey, m);
        if (ok) {
          setModelUI("ok", m);
          chrome.storage.sync.set({ lastWorkingModel: m });
          return m;
        }
      } catch (_) { /* try next */ }
    }

    setModelUI("err", "No working model found");
    return null;
  }

  function setModelUI(state, label) {
    modelDot.className = "model-dot";
    modelName.className = "model-name";

    if (state === "ok") {
      modelDot.classList.add("dot-ok");
      modelName.classList.add("name-ok");
    } else if (state === "err") {
      modelDot.classList.add("dot-err");
      modelName.classList.add("name-err");
    } else {
      modelDot.classList.add("dot-spin");
    }

    modelName.textContent = label;
    if (footerModel) footerModel.textContent = state === "ok" ? label : "—";
  }

  // ─── Load saved state ─────────────────────────────────────────────────────
  chrome.storage.sync.get(["geminiApiKey", "lastWorkingModel", "promptType"], (result) => {
    if (chrome.runtime.lastError) return;
    if (result.geminiApiKey) {
      apiInput.value = result.geminiApiKey;
      apiInput.classList.add("is-valid");
      setActiveStatus(true);
    }
    if (result.lastWorkingModel) {
      setModelUI("ok", result.lastWorkingModel);
    }
    if (result.promptType) {
      const matching = document.querySelector(`input[name="prompt-type"][value="${result.promptType}"]`);
      if (matching) matching.checked = true;
    }
  });

  // ─── Save ─────────────────────────────────────────────────────────────────
  saveBtn.addEventListener("click", () => {
    const key = sanitizeApiKey(apiInput.value);
    if (!key) { shake(apiInput); showInlineError("Please enter your API key."); return; }
    if (!isValidKeyFormat(key)) {
      shake(apiInput);
      showInlineError("Invalid format. Must start with 'AIza' + 35 chars.");
      return;
    }
    chrome.storage.sync.set({ geminiApiKey: key }, () => {
      if (chrome.runtime.lastError) { showInlineError("Save failed. Try again."); return; }
      apiInput.classList.add("is-valid");
      saveBtn.classList.add("btn--success");
      saveLabel.textContent = "✓ Saved!";
      setActiveStatus(true);
      // Auto-detect after saving
      autoDetectModel(key);
      setTimeout(() => {
        saveBtn.classList.remove("btn--success");
        saveLabel.textContent = "Save API Key";
      }, 2200);
    });
  });

  // ─── Clear ────────────────────────────────────────────────────────────────
  clearBtn.addEventListener("click", () => {
    chrome.storage.sync.remove(["geminiApiKey", "lastWorkingModel"], () => {
      if (chrome.runtime.lastError) return;
      apiInput.value = "";
      apiInput.classList.remove("is-valid");
      setActiveStatus(false);
      setModelUI("idle", "Not tested yet");
      removeInlineError();
    });
  });

  // ─── Detect button ────────────────────────────────────────────────────────
  detectBtn.addEventListener("click", async () => {
    const key = sanitizeApiKey(apiInput.value);
    if (!key || !isValidKeyFormat(key)) {
      showInlineError("Save a valid API key first.");
      shake(apiInput);
      return;
    }
    detectBtn.disabled = true;
    detectLabel.textContent = "⟳ Detecting…";
    await autoDetectModel(key);
    detectBtn.disabled = false;
    detectLabel.textContent = "⟳ Auto-detect best model";
  });

  // ─── Toggle visibility ────────────────────────────────────────────────────
  let isVisible = false;
  toggleBtn.addEventListener("click", () => {
    isVisible = !isVisible;
    apiInput.type = isVisible ? "text" : "password";
    const svg = toggleBtn.querySelector("svg");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (isVisible) {
      svg.appendChild(makeSvgEl("path", { d: "M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" }));
      svg.appendChild(makeSvgEl("path", { d: "M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" }));
      svg.appendChild(makeSvgEl("line", { x1:"1", y1:"1", x2:"23", y2:"23" }));
    } else {
      svg.appendChild(makeSvgEl("path", { d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" }));
      svg.appendChild(makeSvgEl("circle", { cx:"12", cy:"12", r:"3" }));
    }
  });

  function makeSvgEl(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  apiInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveBtn.click(); });

  promptTypeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      chrome.storage.sync.set({ promptType: input.value });
    });
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function setActiveStatus(active) {
    statusBadge.classList.toggle("is-active", active);
    badgeLabel.textContent = active ? "Active" : "Not configured";
  }

  function shake(el) {
    el.style.animation = "none";
    void el.offsetHeight;
    el.style.animation = "pc-shake 0.4s ease";
    setTimeout(() => { el.style.animation = ""; }, 400);
  }

  function showInlineError(msg) {
    removeInlineError();
    const err = document.createElement("div");
    err.id = "inline-error";
    err.className = "inline-error";
    err.textContent = msg;
    apiInput.closest(".input-group").appendChild(err);
    setTimeout(removeInlineError, 3500);
  }

  function removeInlineError() {
    document.getElementById("inline-error")?.remove();
  }

  const raf = document.createElement("style");
  raf.textContent = [
    "@keyframes pc-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-5px)}40%{transform:translateX(5px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}",
    "@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}"
  ].join("");
  document.head.appendChild(raf);
})();
