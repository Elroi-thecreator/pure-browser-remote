// Pure Browser Remote - In-Tab DOM Event Injection Script
(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__pureBrowserRemoteInjected) return;
  window.__pureBrowserRemoteInjected = true;

  // Remote Cursor Overlay Elements
  let cursorEl = null;
  let cursorHideTimeout = null;
  let showRemoteCursor = true;
  let lastTargetInput = null;

  function createRemoteCursor() {
    if (cursorEl) return cursorEl;

    cursorEl = document.createElement('div');
    cursorEl.id = '__pure_remote_cursor__';
    cursorEl.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: rgba(59, 130, 246, 0.9);
      border: 2px solid #ffffff;
      box-shadow: 0 0 12px rgba(59, 130, 246, 0.8), 0 2px 6px rgba(0,0,0,0.4);
      pointer-events: none;
      z-index: 2147483647;
      transform: translate(-50%, -50%);
      transition: transform 0.04s ease-out, opacity 0.3s ease;
      display: none;
    `;

    const label = document.createElement('div');
    label.style.cssText = `
      position: absolute;
      left: 20px;
      top: -2px;
      background: #1e293b;
      color: #93c5fd;
      border: 1px solid rgba(59, 130, 246, 0.4);
      border-radius: 4px;
      padding: 1px 6px;
      font-size: 10px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-weight: 600;
      white-space: nowrap;
      box-shadow: 0 2px 5px rgba(0,0,0,0.3);
    `;
    label.textContent = 'Remote User';
    cursorEl.appendChild(label);

    document.documentElement.appendChild(cursorEl);
    return cursorEl;
  }

  function updateRemoteCursor(clientX, clientY) {
    if (!showRemoteCursor) return;
    const cursor = createRemoteCursor();
    cursor.style.display = 'block';
    cursor.style.opacity = '1';
    cursor.style.left = `${clientX}px`;
    cursor.style.top = `${clientY}px`;

    clearTimeout(cursorHideTimeout);
    cursorHideTimeout = setTimeout(() => {
      if (cursorEl) cursorEl.style.opacity = '0';
    }, 4000);
  }

  function createClickRipple(clientX, clientY) {
    const ripple = document.createElement('div');
    ripple.style.cssText = `
      position: fixed;
      left: ${clientX}px;
      top: ${clientY}px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: 2px solid #38bdf8;
      background: rgba(56, 189, 248, 0.3);
      pointer-events: none;
      z-index: 2147483647;
      transform: translate(-50%, -50%) scale(1);
      opacity: 1;
      transition: transform 0.4s cubic-bezier(0, 0, 0.2, 1), opacity 0.4s ease-out;
    `;
    document.documentElement.appendChild(ripple);

    requestAnimationFrame(() => {
      ripple.style.transform = 'translate(-50%, -50%) scale(5)';
      ripple.style.opacity = '0';
      setTimeout(() => ripple.remove(), 450);
    });
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
      if (!showRemoteCursor && cursorEl) {
        cursorEl.style.display = 'none';
      }
      sendResponse({ status: 'ok' });
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
