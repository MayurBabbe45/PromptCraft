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

  function positionButtonNearInput(input) {
    if (!refineButton || !input) return;

    const rect = input.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // Place button at bottom-right of the input field
    let top = rect.bottom + scrollY - 44;
    let left = rect.right + scrollX - 148;

    // Boundary checks
    if (left < scrollX + 8) left = scrollX + 8;
    if (top < scrollY + 8) top = scrollY + 8;

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

  // ─── Gemini API ───────────────────────────────────────────────────────────

  // Try models in order until one works
  const GEMINI_MODELS = [
    "gemini-3-flash-preview",
    "gemini-3-flash-preview-0514",
    "gemini-2.5-flash-preview-04-17",
    "gemini-2.5-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash-lite-preview",
  ];

  async function callGeminiAPIWithModel(prompt, apiKey, model) {
    const fullPrompt = `You are an expert prompt engineer. Rewrite the following prompt to be clearer, more specific, and more effective for AI systems. Keep the same intent. Return ONLY the improved prompt with no explanation or preamble.

Original prompt:
${prompt}

Improved prompt:`;

    const requestBody = {
      contents: [{
        parts: [{ text: fullPrompt }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      }
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const status = response.status;
      const errMsg = errData?.error?.message || `HTTP ${status}`;
      // 429 = quota, 404 = model not found — both are retriable with next model
      if (status === 429 || status === 404 || status === 400) {
        throw new Error(`RETRY:${errMsg}`);
      }
      throw new Error(errMsg);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("No response from Gemini API");
    return text.trim();
  }

  async function callGeminiAPI(prompt, apiKey) {
    let lastError = null;
    for (const model of GEMINI_MODELS) {
      try {
        const result = await callGeminiAPIWithModel(prompt, apiKey, model);
        return result;
      } catch (err) {
        lastError = err;
        if (err.message.startsWith("RETRY:")) {
          console.warn(`[PromptCraft] Model ${model} failed: ${err.message.replace("RETRY:","")}`);
          continue;
        }
        throw err;
      }
    }
    const msg = (lastError?.message || "").replace("RETRY:", "");
    if (msg.includes("quota") || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("Quota exceeded. Please get a new API key at aistudio.google.com/app/apikey");
    }
    throw new Error(msg || "All Gemini models failed");
  }

  // ─── Main Handler ─────────────────────────────────────────────────────────

  async function handleRefine() {
    if (!activeInput) return;

    const prompt = getInputText(activeInput);
    if (!prompt || prompt.length < 3) {
      showToast("Please type a prompt first!", "warning");
      return;
    }

    // Get API key from storage
    chrome.storage.sync.get(["geminiApiKey"], async (result) => {
      const apiKey = result.geminiApiKey;
      if (!apiKey) {
        showToast("⚙ Set your Gemini API key in the extension popup.", "error");
        return;
      }

      setButtonLoading(true);
      try {
        const refined = await callGeminiAPI(prompt, apiKey);
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
