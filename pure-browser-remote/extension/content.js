// Pure Browser Remote - In-Tab DOM Event Injection Script
(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__pureBrowserRemoteInjected) return;
  window.__pureBrowserRemoteInjected = true;

  // Remote Cursor Overlay Elements & State
  let cursorEl = null;
  let cursorHideTimeout = null;
  let showRemoteCursor = true;
  let lastTargetInput = null;

  // Load persisted remote cursor visibility preference
  try {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['pbr_show_remote_cursor'], (res) => {
        if (res && res.pbr_show_remote_cursor !== undefined) {
          showRemoteCursor = !!res.pbr_show_remote_cursor;
          if (!showRemoteCursor && cursorEl) {
            cursorEl.style.display = 'none';
          }
        }
      });
    }
  } catch (e) {}

  // Synchronize dynamic preference changes across tabs
  try {
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.pbr_show_remote_cursor !== undefined) {
          showRemoteCursor = !!changes.pbr_show_remote_cursor.newValue;
          if (!showRemoteCursor) {
            if (cursorEl) cursorEl.style.display = 'none';
            cleanupRipples();
          }
        }
      });
    }
  } catch (e) {}

  function ensureStyles() {
    if (document.getElementById('__pbr_cursor_styles__')) return;
    const style = document.createElement('style');
    style.id = '__pbr_cursor_styles__';
    style.textContent = `
      @keyframes __pbr_ripple_anim {
        0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0.85; }
        100% { transform: translate(-50%, -50%) scale(2.0); opacity: 0; }
      }
      .__pbr_ripple {
        position: fixed !important;
        width: 16px !important;
        height: 16px !important;
        border-radius: 50% !important;
        border: 2px solid #38bdf8 !important;
        background: rgba(56, 189, 248, 0.25) !important;
        pointer-events: none !important;
        user-select: none !important;
        z-index: 2147483647 !important;
        animation: __pbr_ripple_anim 0.32s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important;
      }
      #__pure_remote_cursor__ {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        pointer-events: none !important;
        user-select: none !important;
        z-index: 2147483647 !important;
        transform: translate(-3px, -3px) !important;
        transition: opacity 0.2s ease-out !important;
        display: none;
        will-change: transform, left, top;
      }
      .__pbr_cursor_arrow {
        width: 20px;
        height: 20px;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
      }
      .__pbr_cursor_badge {
        position: absolute;
        left: 18px;
        top: 14px;
        background: rgba(15, 23, 42, 0.9);
        color: #93c5fd;
        border: 1px solid rgba(59, 130, 246, 0.5);
        border-radius: 4px;
        padding: 1px 5px;
        font-size: 9px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-weight: 600;
        white-space: nowrap;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
        pointer-events: none !important;
        user-select: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function cleanupRipples() {
    try {
      const ripples = document.querySelectorAll('.__pbr_ripple');
      ripples.forEach((r) => r.remove());
    } catch (e) {}
  }

  function createRemoteCursor() {
    ensureStyles();
    if (cursorEl && document.contains(cursorEl)) return cursorEl;

    const old = document.getElementById('__pure_remote_cursor__');
    if (old) old.remove();

    cursorEl = document.createElement('div');
    cursorEl.id = '__pure_remote_cursor__';
    cursorEl.innerHTML = `
      <svg class="__pbr_cursor_arrow" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 3L10.07 20.97L13.58 13.58L20.97 10.07L3 3Z" fill="#2563eb" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div class="__pbr_cursor_badge">Remote</div>
    `;

    (document.body || document.documentElement).appendChild(cursorEl);
    return cursorEl;
  }

  function updateRemoteCursor(clientX, clientY) {
    if (!showRemoteCursor) {
      if (cursorEl) cursorEl.style.display = 'none';
      return;
    }
    const cursor = createRemoteCursor();
    cursor.style.display = 'block';
    cursor.style.opacity = '1';
    cursor.style.left = `${clientX}px`;
    cursor.style.top = `${clientY}px`;

    clearTimeout(cursorHideTimeout);
    cursorHideTimeout = setTimeout(() => {
      if (cursorEl) cursorEl.style.opacity = '0';
    }, 1500);
  }

  function createClickRipple(clientX, clientY) {
    if (!showRemoteCursor) return;
    ensureStyles();
    cleanupRipples();

    const ripple = document.createElement('div');
    ripple.className = '__pbr_ripple';
    ripple.style.left = `${clientX}px`;
    ripple.style.top = `${clientY}px`;

    const removeSelf = () => {
      try { ripple.remove(); } catch (e) {}
    };

    ripple.addEventListener('animationend', removeSelf, { once: true });
    setTimeout(removeSelf, 350);

    (document.body || document.documentElement).appendChild(ripple);
  }

  function isInputElement(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    return tag === 'INPUT' ||
           tag === 'TEXTAREA' ||
           el.isContentEditable ||
           el.getAttribute?.('contenteditable') === 'true' ||
           el.getAttribute?.('role') === 'textbox' ||
           el.getAttribute?.('role') === 'searchbox';
  }

  function updateLastTargetInput(el) {
    if (!el) return;
    const candidate = el.closest?.('input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"]') || (isInputElement(el) ? el : null);
    if (candidate) {
      lastTargetInput = candidate;
    }
  }

  // Find the exact input element to type into
  function resolveTargetInputElement(explicitTarget, clientX, clientY) {
    // 1. Direct hit or closest input ancestor
    if (explicitTarget) {
      if (isInputElement(explicitTarget)) return explicitTarget;
      const inside = explicitTarget.closest?.('input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"]');
      if (inside) return inside;
    }

    // 2. Currently focused document element
    if (document.activeElement && isInputElement(document.activeElement)) {
      return document.activeElement;
    }

    // 3. Element under cursor coordinates if provided
    if (clientX !== undefined && clientY !== undefined) {
      const atPoint = document.elementFromPoint(clientX, clientY);
      if (atPoint) {
        if (isInputElement(atPoint)) return atPoint;
        const insidePoint = atPoint.closest?.('input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"]');
        if (insidePoint) return insidePoint;
      }
    }

    // 4. Last interacted input
    if (lastTargetInput && document.contains(lastTargetInput) && isInputElement(lastTargetInput)) {
      return lastTargetInput;
    }

    // 5. Look for any visible search bar or text input on the page
    const pageInputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), [contenteditable="true"]'));
    const visible = pageInputs.find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top <= window.innerHeight;
    });
    if (visible) return visible;

    return explicitTarget || document.body;
  }

  // Find scrollable container under point
  function getScrollableContainer(target) {
    let el = target;
    while (el && el !== document.documentElement && el !== document.body) {
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      const isScrollable = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
      if (isScrollable) return el;
      el = el.parentElement;
    }
    return window;
  }

  // Submit form or click search button
  function triggerFormSubmit(target) {
    if (!target) return;
    const form = target.closest?.('form');
    if (form) {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
        if (submitBtn) submitBtn.click();
        else form.submit();
      }
    } else {
      const parent = target.parentElement;
      const searchBtn = parent?.querySelector?.('button, [role="button"]');
      if (searchBtn && searchBtn !== target) {
        searchBtn.click();
      }
    }
  }

  // Insert text into input/textarea with React/Vue/Angular property descriptor synchronization
  function insertTextIntoElement(target, text, submitAfter = false) {
    if (!target) return;
    target.focus();
    updateLastTargetInput(target);

    // Flash subtle focus outline for visual feedback
    const prevOutline = target.style.outline;
    target.style.outline = '2px solid #3b82f6';
    setTimeout(() => {
      try { target.style.outline = prevOutline; } catch (e) {}
    }, 450);

    const tag = (target.tagName || '').toUpperCase();

    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const isTextArea = tag === 'TEXTAREA';
      const prototype = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

      let start = target.selectionStart;
      let end = target.selectionEnd;
      if (start === null || end === null || isNaN(start)) {
        start = end = (target.value || '').length;
      }

      const currentVal = target.value || '';
      const updatedVal = currentVal.substring(0, start) + text + currentVal.substring(end);

      // Call native setter so React/Vue/Angular tracker updates internal state
      if (descriptor && descriptor.set) {
        descriptor.set.call(target, updatedVal);
      } else {
        target.value = updatedVal;
      }

      try {
        target.selectionStart = target.selectionEnd = start + text.length;
      } catch (e) {}

      // Dispatch full input event chain
      target.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));

      target.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));

      target.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    } else if (target.isContentEditable || target.getAttribute?.('contenteditable') === 'true') {
      target.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));

      let execSuccess = false;
      try {
        execSuccess = document.execCommand('insertText', false, text);
      } catch (e) {}

      if (!execSuccess) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const node = document.createTextNode(text);
          range.insertNode(node);
          range.setStartAfter(node);
          range.setEndAfter(node);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          target.textContent += text;
        }
      }

      target.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));
    }

    if (submitAfter) {
      setTimeout(() => triggerFormSubmit(target), 80);
    }
  }

  // Listen for remote input simulation commands from host.js / background.js
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) return;

    if (msg.action === 'toggle_cursor') {
      showRemoteCursor = !!msg.show;
      if (!showRemoteCursor) {
        if (cursorEl) cursorEl.style.display = 'none';
        cleanupRipples();
      }
      sendResponse({ status: 'ok', show: showRemoteCursor });
      return;
    }

    if (msg.action === 'simulate_input') {
      const { type, x, y, button, double, dx, dy, key, code, modifiers, text, submit } = msg;

      const clientX = x !== undefined ? Math.round(x * window.innerWidth) : 0;
      const clientY = y !== undefined ? Math.round(y * window.innerHeight) : 0;

      // Update visual remote pointer
      if (type === 'mousemove' || type === 'mousedown' || type === 'click') {
        updateRemoteCursor(clientX, clientY);
      }

      const rawTarget = (clientX || clientY) ? document.elementFromPoint(clientX, clientY) : null;
      const target = rawTarget || document.activeElement || document.body;

      if (rawTarget) {
        updateLastTargetInput(rawTarget);
      }

      switch (type) {
        case 'mousemove': {
          const evt = new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
            screenX: clientX,
            screenY: clientY
          });
          target.dispatchEvent(evt);
          break;
        }

        case 'mousedown': {
          updateLastTargetInput(target);
          if (typeof target.focus === 'function') target.focus();
          const evt = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
            button: button === 'right' ? 2 : button === 'middle' ? 1 : 0
          });
          target.dispatchEvent(evt);
          break;
        }

        case 'mouseup': {
          const evt = new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
            button: button === 'right' ? 2 : button === 'middle' ? 1 : 0
          });
          target.dispatchEvent(evt);
          break;
        }

        case 'click': {
          createClickRipple(clientX, clientY);
          updateLastTargetInput(target);

          if (typeof target.focus === 'function') {
            target.focus();
          }

          const clickEvt = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
            detail: double ? 2 : 1,
            button: button === 'right' ? 2 : button === 'middle' ? 1 : 0
          });
          target.dispatchEvent(clickEvt);

          if (double) {
            const dblEvt = new MouseEvent('dblclick', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX,
              clientY
            });
            target.dispatchEvent(dblEvt);
          }

          const anchor = target.closest?.('a');
          if (anchor && anchor.href) {
            anchor.click();
          } else if (target.tagName === 'BUTTON' || target.getAttribute?.('role') === 'button') {
            target.click();
          }
          break;
        }

        case 'scroll': {
          const wheelEvt = new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
            deltaX: dx || 0,
            deltaY: dy || 0,
            deltaMode: 0
          });
          target.dispatchEvent(wheelEvt);

          const scrollTarget = getScrollableContainer(target);
          if (scrollTarget === window || scrollTarget === document.documentElement || scrollTarget === document.body) {
            window.scrollBy({ left: dx || 0, top: dy || 0, behavior: 'smooth' });
            if (dy) {
              document.documentElement.scrollTop += dy;
              document.body.scrollTop += dy;
            }
          } else {
            scrollTarget.scrollBy({ left: dx || 0, top: dy || 0, behavior: 'smooth' });
            if (dy) scrollTarget.scrollTop += dy;
            if (dx) scrollTarget.scrollLeft += dx;
          }
          break;
        }

        case 'scroll_top': {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
          break;
        }

        case 'scroll_bottom': {
          const maxScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
          window.scrollTo({ top: maxScroll, behavior: 'smooth' });
          document.documentElement.scrollTop = maxScroll;
          document.body.scrollTop = maxScroll;
          break;
        }

        case 'keydown': {
          const activeInput = resolveTargetInputElement(target, clientX, clientY);
          const kEvt = new KeyboardEvent('keydown', {
            key: key || '',
            code: code || '',
            bubbles: true,
            cancelable: true,
            ctrlKey: modifiers?.ctrl,
            shiftKey: modifiers?.shift,
            altKey: modifiers?.alt,
            metaKey: modifiers?.meta
          });
          activeInput.dispatchEvent(kEvt);

          if (isInputElement(activeInput)) {
            if (key === 'Backspace') {
              const start = activeInput.selectionStart;
              const end = activeInput.selectionEnd;
              const currentVal = activeInput.value || '';
              let updatedVal = currentVal;
              let newPos = start;

              if (start !== end && start !== null && end !== null) {
                updatedVal = currentVal.substring(0, start) + currentVal.substring(end);
                newPos = start;
              } else if (start > 0) {
                updatedVal = currentVal.substring(0, start - 1) + currentVal.substring(start);
                newPos = start - 1;
              }

              const isTextArea = activeInput.tagName === 'TEXTAREA';
              const prototype = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
              const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

              if (descriptor && descriptor.set) {
                descriptor.set.call(activeInput, updatedVal);
              } else {
                activeInput.value = updatedVal;
              }

              try { activeInput.selectionStart = activeInput.selectionEnd = newPos; } catch (e) {}

              activeInput.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'deleteContentBackward'
              }));
              activeInput.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (key === 'Enter') {
              triggerFormSubmit(activeInput);
            }
          } else {
            // Scroll keys when no input focused
            if (key === 'ArrowDown') window.scrollBy({ top: 150, behavior: 'smooth' });
            else if (key === 'ArrowUp') window.scrollBy({ top: -150, behavior: 'smooth' });
            else if (key === 'PageDown' || (key === ' ' && !modifiers?.shift)) window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
            else if (key === 'PageUp' || (key === ' ' && modifiers?.shift)) window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
            else if (key === 'Home') window.scrollTo({ top: 0, behavior: 'smooth' });
            else if (key === 'End') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          }
          break;
        }

        case 'keyup': {
          const activeInput = resolveTargetInputElement(target, clientX, clientY);
          const kEvt = new KeyboardEvent('keyup', {
            key: key || '',
            code: code || '',
            bubbles: true,
            cancelable: true,
            ctrlKey: modifiers?.ctrl,
            shiftKey: modifiers?.shift,
            altKey: modifiers?.alt,
            metaKey: modifiers?.meta
          });
          activeInput.dispatchEvent(kEvt);
          break;
        }

        case 'type': {
          const targetInput = resolveTargetInputElement(target, clientX, clientY);
          insertTextIntoElement(targetInput, text || '', !!submit);
          break;
        }

        default:
          break;
      }

      sendResponse({ status: 'ok', handled: type });
    }
    return true;
  });

})();
