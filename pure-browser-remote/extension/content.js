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

  // Insert text into input/textarea with full synthetic event pipeline
  function insertTextIntoElement(target, text) {
    if (!target) return;

    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      const before = target.value.substring(0, start);
      const after = target.value.substring(end);

      target.value = before + text + after;
      target.selectionStart = target.selectionEnd = start + text.length;

      // Dispatch React/Vue/Angular compatible events
      target.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: text }));
      target.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    } else if (target.isContentEditable) {
      document.execCommand('insertText', false, text);
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
      const { type, x, y, button, double, dx, dy, key, code, modifiers, text } = msg;

      const clientX = x !== undefined ? Math.round(x * window.innerWidth) : 0;
      const clientY = y !== undefined ? Math.round(y * window.innerHeight) : 0;

      // Update visual remote pointer
      if (type === 'mousemove' || type === 'mousedown' || type === 'click') {
        updateRemoteCursor(clientX, clientY);
      }

      const target = document.elementFromPoint(clientX, clientY) || document.body;

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
          if (typeof target.focus === 'function') target.focus();

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

          // Handle double click
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

          // If link or button was clicked, trigger native click if needed
          const anchor = target.closest('a');
          if (anchor && anchor.href) {
            anchor.click();
          } else if (target.tagName === 'BUTTON' || target.getAttribute('role') === 'button') {
            target.click();
          }
          break;
        }

        case 'scroll': {
          // 1. Dispatch synthetic WheelEvent so dynamic JS apps and canvas listen to it
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

          // 2. Perform DOM scroll on container or window
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

        case 'keydown': {
          const activeEl = document.activeElement || target;
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
          activeEl.dispatchEvent(kEvt);

          // Handle Backspace on input
          const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
          if (isInputFocused) {
            if (key === 'Backspace' && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
              const start = activeEl.selectionStart;
              const end = activeEl.selectionEnd;
              if (start === end && start > 0) {
                activeEl.value = activeEl.value.slice(0, start - 1) + activeEl.value.slice(end);
                activeEl.selectionStart = activeEl.selectionEnd = start - 1;
                activeEl.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
          } else {
            // Handle Keyboard navigation scrolling when no input is focused
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
          const activeEl = document.activeElement || target;
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
          activeEl.dispatchEvent(kEvt);
          break;
        }

        case 'type': {
          const activeEl = document.activeElement || target;
          insertTextIntoElement(activeEl, text || '');
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
