/**
 * PromptCraft – Content Script
 * Detects AI chatbot input fields and injects the Refine Prompt button.
 */

(function () {
  "use strict";

  // ─── Constants ────────────────────────────────────────────────────────────

  const BUTTON_ID = "promptcraft-refine-btn";
  const MODAL_ID = "promptcraft-modal";
  const OVERLAY_ID = "promptcraft-overlay";
  const DEFAULT_PROMPT_TYPE = "refactor";
  const PROMPT_TYPE_INSTRUCTIONS = {
    refactor: `You are an expert prompt engineer. Rewrite the following prompt to be clearer, more specific, and more effective for AI systems. Keep the same core intent. Return ONLY the improved prompt — no explanation, no preamble, no quotes.`,
    detailed: `You are an expert prompt engineer. Rewrite the following prompt to maintain intent while adding helpful detail and clarity, making it more descriptive and informative for AI systems. Keep the original goal intact. Return ONLY the improved prompt — no explanation, no preamble, no quotes.`,
    deep: `You are an expert prompt engineer. Rewrite the following prompt into a fully detailed, deeply descriptive prompt with strong context, explicit instructions, and polished structure for best AI understanding. Keep the original goal intact. Return ONLY the improved prompt — no explanation, no preamble, no quotes.`,
  };

  // Site-specific selectors for the prompt input field
  const INPUT_SELECTORS = [
    "#prompt-textarea",                          // ChatGPT
    "textarea[data-id='root']",                  // ChatGPT legacy
    "div.ProseMirror[contenteditable='true']",   // Claude
    "rich-textarea div[contenteditable='true']", // Gemini
    "textarea.stretch",                          // Perplexity
    "textarea[placeholder*='Message']",          // Generic
    "textarea[placeholder*='Ask']",              // Generic
    "textarea[placeholder*='Type']",             // Generic
    "div[contenteditable='true'][role='textbox']",// Generic rich text
    "#userInput",                                // Poe
    "textarea",                                  // Broad fallback
  ];

  // ─── State ────────────────────────────────────────────────────────────────

  let activeInput = null;
  let refineButton = null;
  let debounceTimer = null;
  let isProcessing = false;
  let currentRefinedPrompt = "";

  // ─── Utility ──────────────────────────────────────────────────────────────

  function getInputText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value.trim();
    return (el.innerText || el.textContent || "").trim();
  }

  function setInputText(el, text) {
    if (!el) return;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, text);
      } else {
        el.value = text;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      el.focus();
      // Select all and replace for contenteditable
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("insertText", false, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function buildPromptPayload(prompt, type) {
    const instruction = PROMPT_TYPE_INSTRUCTIONS[type] || PROMPT_TYPE_INSTRUCTIONS[DEFAULT_PROMPT_TYPE];
    return `${instruction}\n\nOriginal prompt:\n${prompt}\n\nImproved prompt:`;
  }

  function positionButtonNearInput(input) {
    if (!refineButton || !input) return;

    const rect = input.getBoundingClientRect();
    const buttonRect = refineButton.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const buttonWidth = buttonRect.width || 150;
    const buttonHeight = buttonRect.height || 42;

    // Prefer placing the button above the input field to avoid covering the prompt text.
    let top = rect.top + scrollY - buttonHeight - 10;
    let left = rect.right + scrollX - buttonWidth;

    // If there isn't enough room above, place it below the input instead.
    if (top < scrollY + 8) {
      top = rect.bottom + scrollY + 10;
    }

    // Keep the button within the viewport horizontally.
    if (left < scrollX + 8) {
      left = Math.max(scrollX + 8, rect.left + scrollX);
    }
    if (left + buttonWidth > scrollX + viewportWidth - 8) {
      left = Math.max(scrollX + 8, rect.left + scrollX);
    }

    refineButton.style.top = `${top}px`;
    refineButton.style.left = `${left}px`;
  }

  // ─── Refine Button ────────────────────────────────────────────────────────

  function createRefineButton() {
    if (document.getElementById(BUTTON_ID)) return document.getElementById(BUTTON_ID);

    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.className = "promptcraft-btn";
    btn.title = "Refine this prompt with AI";

    // Safe DOM construction — no innerHTML
    const iconSpan = document.createElement("span");
    iconSpan.className = "promptcraft-btn-icon";
    iconSpan.textContent = "✦";

    const textSpan = document.createElement("span");
    textSpan.className = "promptcraft-btn-text";
    textSpan.textContent = "Refine Prompt";

    btn.appendChild(iconSpan);
    btn.appendChild(textSpan);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isProcessing) handleRefine();
    });

    document.body.appendChild(btn);
    return btn;
  }

  function showButton(input) {
    if (!refineButton) refineButton = createRefineButton();
    activeInput = input;
    positionButtonNearInput(input);
    refineButton.classList.add("promptcraft-btn--visible");
  }

  function hideButton() {
    if (refineButton) {
      refineButton.classList.remove("promptcraft-btn--visible");
    }
  }

  function setButtonLoading(loading) {
    if (!refineButton) return;
    isProcessing = loading;
    if (loading) {
      refineButton.classList.add("promptcraft-btn--loading");
      refineButton.querySelector(".promptcraft-btn-icon").textContent = "";
      refineButton.querySelector(".promptcraft-btn-text").textContent = "Refining…";
    } else {
      refineButton.classList.remove("promptcraft-btn--loading");
      refineButton.querySelector(".promptcraft-btn-icon").textContent = "✦";
      refineButton.querySelector(".promptcraft-btn-text").textContent = "Refine Prompt";
    }
  }

  // ─── Modal ────────────────────────────────────────────────────────────────

  function showRefinedModal(original, refined) {
    closeModal(); // remove any existing

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "promptcraft-overlay";

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "promptcraft-modal";

    // ── Header ──
    const header = document.createElement("div");
    header.className = "pc-modal-header";

    const titleDiv = document.createElement("div");
    titleDiv.className = "pc-modal-title";
    const titleIcon = document.createElement("span");
    titleIcon.className = "pc-modal-icon";
    titleIcon.textContent = "✦";
    titleDiv.appendChild(titleIcon);
    titleDiv.appendChild(document.createTextNode(" PromptCraft"));

    const closeBtn = document.createElement("button");
    closeBtn.className = "pc-close-btn";
    closeBtn.id = "pc-close-btn";
    closeBtn.title = "Close";
    closeBtn.textContent = "✕";

    header.appendChild(titleDiv);
    header.appendChild(closeBtn);

    // ── Body ──
    const body = document.createElement("div");
    body.className = "pc-modal-body";

    // Original section
    const origSection = document.createElement("div");
    origSection.className = "pc-section";
    const origLabel = document.createElement("div");
    origLabel.className = "pc-section-label";
    origLabel.textContent = "Original Prompt";
    const origBox = document.createElement("div");
    origBox.className = "pc-text-box pc-original";
    origBox.textContent = original; // safe: textContent, not innerHTML
    origSection.appendChild(origLabel);
    origSection.appendChild(origBox);

    // Divider
    const divider = document.createElement("div");
    divider.className = "pc-arrow-divider";
    const line1 = document.createElement("div"); line1.className = "pc-arrow-line";
    const arrowLabel = document.createElement("div"); arrowLabel.className = "pc-arrow-label";
    arrowLabel.textContent = "AI Refined";
    const line2 = document.createElement("div"); line2.className = "pc-arrow-line";
    divider.appendChild(line1); divider.appendChild(arrowLabel); divider.appendChild(line2);

    // Refined section
    const refSection = document.createElement("div");
    refSection.className = "pc-section";
    const refLabel = document.createElement("div");
    refLabel.className = "pc-section-label";
    refLabel.textContent = "Refined Prompt";
    const refTextarea = document.createElement("textarea");
    refTextarea.className = "pc-text-box pc-refined";
    refTextarea.id = "pc-refined-text";
    refTextarea.value = refined; // safe: .value assignment
    refSection.appendChild(refLabel);
    refSection.appendChild(refTextarea);

    body.appendChild(origSection);
    body.appendChild(divider);
    body.appendChild(refSection);

    // ── Footer ──
    const footer = document.createElement("div");
    footer.className = "pc-modal-footer";

    const discardBtn = document.createElement("button");
    discardBtn.className = "pc-btn pc-btn-secondary";
    discardBtn.id = "pc-discard-btn";
    discardBtn.textContent = "Discard";

    const insertBtn = document.createElement("button");
    insertBtn.className = "pc-btn pc-btn-primary";
    insertBtn.id = "pc-insert-btn";
    insertBtn.textContent = "✦ Use Refined Prompt";

    footer.appendChild(discardBtn);
    footer.appendChild(insertBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add("promptcraft-overlay--visible");
      modal.classList.add("promptcraft-modal--visible");
    });

    // Wire up buttons
    closeBtn.addEventListener("click", closeModal);
    discardBtn.addEventListener("click", closeModal);
    insertBtn.addEventListener("click", () => {
      const refinedText = refTextarea.value.trim();
      if (activeInput && refinedText) {
        setInputText(activeInput, refinedText);
        closeModal();
        if (refineButton) {
          refineButton.querySelector(".promptcraft-btn-icon").textContent = "✓";
          refineButton.querySelector(".promptcraft-btn-text").textContent = "Applied!";
          refineButton.classList.add("promptcraft-btn--success");
          setTimeout(() => {
            refineButton.querySelector(".promptcraft-btn-icon").textContent = "✦";
            refineButton.querySelector(".promptcraft-btn-text").textContent = "Refine Prompt";
            refineButton.classList.remove("promptcraft-btn--success");
          }, 2000);
        }
      }
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    document.addEventListener("keydown", handleEscKey);
  }

  function handleEscKey(e) {
    if (e.key === "Escape") closeModal();
  }

  function closeModal() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      overlay.classList.remove("promptcraft-overlay--visible");
      setTimeout(() => overlay.remove(), 300);
    }
    document.removeEventListener("keydown", handleEscKey);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Gemini API – Auto-discovery + Smart Fallback ────────────────────────

  // Fallback list used if the /models endpoint fails
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

  // In-memory cache so we don't re-discover on every click
  let _cachedModels = null;
  let _lastWorkingModel = null;

  /**
   * Fetch the live list of models from the API, filtered to
   * generateContent-capable flash/pro models, ordered by preference.
   */
  async function discoverModels(apiKey) {
    // Return cached list if available
    if (_cachedModels) return _cachedModels;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=50`,
        { method: "GET", headers: { "Content-Type": "application/json" } }
      );

      if (!res.ok) throw new Error(`List models HTTP ${res.status}`);
      const data = await res.json();

      const available = (data.models || [])
        .filter(m =>
          Array.isArray(m.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes("generateContent") &&
          // Only lightweight flash/lite models (not vision-only or embed)
          /gemini.*(flash|pro)/i.test(m.name) &&
          !/embed|vision|aqa/i.test(m.name)
        )
        .map(m => m.name.replace("models/", ""))
        // Prefer flash-lite → flash → pro (faster & cheaper for prompt refining)
        .sort((a, b) => {
          const score = (n) => {
            if (/lite/i.test(n)) return 0;
            if (/flash/i.test(n)) return 1;
            return 2;
          };
          return score(a) - score(b);
        });

      console.log("[PromptCraft] Discovered models:", available);

      // Put last working model first for faster resolution
      if (_lastWorkingModel && available.includes(_lastWorkingModel)) {
        const idx = available.indexOf(_lastWorkingModel);
        available.splice(idx, 1);
        available.unshift(_lastWorkingModel);
      }

      _cachedModels = available.length > 0 ? available : FALLBACK_MODELS;
    } catch (e) {
      console.warn("[PromptCraft] Model discovery failed, using fallback list:", e.message);
      _cachedModels = FALLBACK_MODELS;
    }

    return _cachedModels;
  }

  async function callGeminiAPIWithModel(prompt, apiKey, model, promptType) {
    const fullPrompt = buildPromptPayload(prompt, promptType);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
        })
      }
    );

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const status = res.status;
      const msg = errData?.error?.message || `HTTP ${status}`;
      // These statuses mean "try the next model"
      if (status === 400 || status === 404 || status === 429 || status === 503) {
        throw new Error(`RETRY:${status}:${msg}`);
      }
      throw new Error(msg); // 401 invalid key etc — no point retrying
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty response from Gemini");
    return text.trim();
  }

  async function callGeminiAPI(prompt, apiKey, promptType) {
    // Step 1: get ordered model list (live or cached)
    const models = await discoverModels(apiKey);
    let lastError = null;
    let attemptCount = 0;

    for (const model of models) {
      attemptCount++;
      // Update button label to show which model is being tried
      if (attemptCount > 1 && refineButton) {
        const shortName = model.replace(/gemini-/i, "").replace(/-preview.*/, "…");
        refineButton.querySelector(".promptcraft-btn-text").textContent =
          `Trying ${shortName}…`;
      }

      try {
        const result = await callGeminiAPIWithModel(prompt, apiKey, model, promptType);

        // ✅ Success — remember this model for next time
        _lastWorkingModel = model;
        // Bust the cache so it re-sorts with this model first next call
        _cachedModels = null;
        // Persist working model so popup can display it
        chrome.storage.sync.set({ lastWorkingModel: model });

        if (attemptCount > 1) {
          console.log(`[PromptCraft] ✓ Switched to working model: ${model}`);
          showToast(`✦ Switched to ${model}`, "info");
        }

        return result;
      } catch (err) {
        lastError = err;
        if (err.message.startsWith("RETRY:")) {
          const [, status, detail] = err.message.split(":");
          console.warn(`[PromptCraft] Model "${model}" failed (HTTP ${status}): ${detail} — trying next…`);
          // Invalidate cache so next call re-discovers
          _cachedModels = null;
          continue;
        }
        // Non-retriable (e.g. 401 bad API key) — stop immediately
        throw err;
      }
    }

    // All models failed
    const raw = (lastError?.message || "").replace(/^RETRY:\d+:/, "");
    if (/quota|RESOURCE_EXHAUSTED|429/i.test(raw)) {
      throw new Error("All models quota exceeded. Please generate a new API key at aistudio.google.com/app/apikey");
    }
    throw new Error(`All ${models.length} models failed. Last error: ${raw}`);
  }

  // ─── Main Handler ─────────────────────────────────────────────────────────

  async function handleRefine() {
    if (!activeInput) return;

    const prompt = getInputText(activeInput);
    if (!prompt || prompt.length < 3) {
      showToast("Please type a prompt first!", "warning");
      return;
    }

    // Get API key and prompt type from storage
    chrome.storage.sync.get(["geminiApiKey", "promptType"], async (result) => {
      const apiKey = result.geminiApiKey;
      const promptType = result.promptType || DEFAULT_PROMPT_TYPE;
      if (!apiKey) {
        showToast("⚙ Set your Gemini API key in the extension popup.", "error");
        return;
      }

      setButtonLoading(true);
      try {
        const refined = await callGeminiAPI(prompt, apiKey, promptType);
        showRefinedModal(prompt, refined);
      } catch (err) {
        console.error("[PromptCraft] API Error:", err);
        showToast(`Error: ${err.message}`, "error");
      } finally {
        setButtonLoading(false);
      }
    });
  }

  // ─── Toast Notifications ──────────────────────────────────────────────────

  function showToast(message, type = "info") {
    const existing = document.getElementById("promptcraft-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "promptcraft-toast";
    toast.className = `promptcraft-toast promptcraft-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("promptcraft-toast--visible"));
    setTimeout(() => {
      toast.classList.remove("promptcraft-toast--visible");
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }

  // ─── Input Detection ──────────────────────────────────────────────────────

  function findInputElement(target) {
    // Walk up DOM to find a matching input
    let el = target;
    while (el && el !== document.body) {
      if (
        el.tagName === "TEXTAREA" ||
        (el.isContentEditable && el.getAttribute("contenteditable") === "true") ||
        (el.tagName === "INPUT" && el.type === "text")
      ) {
        // Verify it looks like an AI prompt area (non-trivial size)
        const rect = el.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 20) return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function handleInputEvent(e) {
    const input = findInputElement(e.target);
    if (!input) return;

    clearTimeout(debounceTimer);
    const text = getInputText(input);

    if (text.length > 5) {
      debounceTimer = setTimeout(() => {
        showButton(input);
      }, 600); // show button after 600ms of no typing
    } else {
      hideButton();
    }
  }

  function handleFocusOut(e) {
    // Delay hide to allow button click to register
    setTimeout(() => {
      const focused = document.activeElement;
      if (
        focused &&
        (focused.id === BUTTON_ID || focused.closest(`#${MODAL_ID}`) || focused.closest(`#${OVERLAY_ID}`))
      ) {
        return;
      }
      if (!document.getElementById(OVERLAY_ID)) {
        hideButton();
      }
    }, 200);
  }

  // ─── Scroll / Resize Tracking ─────────────────────────────────────────────

  function updateButtonPosition() {
    if (activeInput && refineButton?.classList.contains("promptcraft-btn--visible")) {
      positionButtonNearInput(activeInput);
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    document.addEventListener("input", handleInputEvent, true);
    document.addEventListener("keyup", handleInputEvent, true);
    document.addEventListener("focusout", handleFocusOut, true);
    window.addEventListener("scroll", updateButtonPosition, { passive: true });
    window.addEventListener("resize", updateButtonPosition, { passive: true });

    // Re-check on DOM mutations (for SPAs that reload chat areas)
    const observer = new MutationObserver(() => {
      if (activeInput && !document.contains(activeInput)) {
        activeInput = null;
        hideButton();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
