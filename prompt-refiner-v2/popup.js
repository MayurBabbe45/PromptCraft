/**
 * PromptCraft – Popup Script (v1.1.0)
 * Security hardened: input sanitization, safe storage, no hardcoded secrets.
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

  // ─── Input sanitization ───────────────────────────────────────────────────
  // Strip non-printable ASCII — prevents injection of control characters
  function sanitizeApiKey(raw) {
    return raw.replace(/[^\x20-\x7E]/g, "").trim();
  }

  // Gemini keys are "AIza" + 35+ alphanumeric/dash chars
  function isValidKeyFormat(key) {
    return /^AIza[A-Za-z0-9_\-]{35,}$/.test(key);
  }

  // ─── Load saved key on open ───────────────────────────────────────────────
  chrome.storage.sync.get(["geminiApiKey"], (result) => {
    if (chrome.runtime.lastError) return;
    if (result.geminiApiKey) {
      apiInput.value = result.geminiApiKey;
      apiInput.classList.add("is-valid");
      setActiveStatus(true);
    }
  });

  // ─── Save ─────────────────────────────────────────────────────────────────
  saveBtn.addEventListener("click", () => {
    const key = sanitizeApiKey(apiInput.value);

    if (!key) {
      shake(apiInput);
      showInlineError("Please enter your Gemini API key.");
      return;
    }

    if (!isValidKeyFormat(key)) {
      shake(apiInput);
      showInlineError("Invalid format. Key must start with 'AIza' followed by 35+ characters.");
      return;
    }

    // Only the key string is stored — no metadata, no user data
    chrome.storage.sync.set({ geminiApiKey: key }, () => {
      if (chrome.runtime.lastError) {
        showInlineError("Save failed. Try again.");
        return;
      }
      apiInput.classList.add("is-valid");
      saveBtn.classList.add("btn--success");
      saveLabel.textContent = "✓ Saved!";
      setActiveStatus(true);

      setTimeout(() => {
        saveBtn.classList.remove("btn--success");
        saveLabel.textContent = "Save API Key";
      }, 2200);
    });
  });

  // ─── Clear ────────────────────────────────────────────────────────────────
  clearBtn.addEventListener("click", () => {
    chrome.storage.sync.remove(["geminiApiKey"], () => {
      if (chrome.runtime.lastError) return;
      apiInput.value = "";
      apiInput.classList.remove("is-valid");
      setActiveStatus(false);
      removeInlineError();
    });
  });

  // ─── Toggle key visibility ────────────────────────────────────────────────
  let isVisible = false;
  toggleBtn.addEventListener("click", () => {
    isVisible = !isVisible;
    apiInput.type = isVisible ? "text" : "password";

    // Safe SVG update via DOM API — no innerHTML
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

  // ─── Enter key ────────────────────────────────────────────────────────────
  apiInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveBtn.click();
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
    err.textContent = msg; // safe: textContent, not innerHTML
    apiInput.closest(".input-group").appendChild(err);
    setTimeout(removeInlineError, 3500);
  }

  function removeInlineError() {
    document.getElementById("inline-error")?.remove();
  }

  // ─── Inject keyframe animations ───────────────────────────────────────────
  // Must be injected this way because CSP blocks inline <style> with 'unsafe-inline'
  // These are non-sensitive presentational keyframes only
  const raf = document.createElement("style");
  raf.textContent = [
    "@keyframes pc-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-5px)}40%{transform:translateX(5px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}",
    "@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}"
  ].join("");
  document.head.appendChild(raf);
})();
