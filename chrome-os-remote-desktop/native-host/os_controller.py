#!/usr/bin/env python3
"""
Chrome OS Remote Desktop - Native Messaging Input Host
Provides high-performance, low-latency OS-level input injection (Mouse & Keyboard)
communicating with the Chrome Extension via standard 32-bit length-prefixed JSON on stdio.
"""

import sys
import os
import json
import struct
import platform
import logging
import tempfile

# Configure file logger (DO NOT use stdout/stderr for logging as stdout is the binary IPC channel)
log_path = os.path.join(tempfile.gettempdir(), 'os_remote_controller.log')
logging.basicConfig(
    filename=log_path,
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logging.info("Starting OS Native Messaging Controller...")

try:
    import pyautogui
    # Configure PyAutoGUI for instant execution and smooth boundary handling
    pyautogui.FAILSAFE = False
    pyautogui.PAUSE = 0.0
except ImportError as e:
    logging.error(f"PyAutoGUI import failed: {e}")

try:
    import pyperclip
except ImportError as e:
    logging.warning(f"Pyperclip import failed: {e}")

try:
    from pynput.keyboard import Controller as KeyboardController, Key
    keyboard = KeyboardController()
except ImportError as e:
    logging.error(f"Pynput import failed: {e}")
    keyboard = None


def read_message():
    """Reads a 32-bit length-prefixed JSON message from sys.stdin.buffer."""
    try:
        raw_length = sys.stdin.buffer.read(4)
        if not raw_length or len(raw_length) < 4:
            return None
        message_length = struct.unpack('@I', raw_length)[0]
        if message_length == 0:
            return None
        raw_data = sys.stdin.buffer.read(message_length)
        if len(raw_data) < message_length:
            return None
        return json.loads(raw_data.decode('utf-8'))
    except Exception as e:
        logging.error(f"Error reading message from stdin: {e}")
        return None


def send_message(message_dict):
    """Encodes and writes a 32-bit length-prefixed JSON message to sys.stdout.buffer."""
    try:
        encoded = json.dumps(message_dict).encode('utf-8')
        length_prefix = struct.pack('@I', len(encoded))
        sys.stdout.buffer.write(length_prefix)
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()
    except Exception as e:
        logging.error(f"Error sending message to stdout: {e}")


# Key mapping dictionary from browser KeyboardEvent.code / key to pynput.keyboard.Key
KEY_CODE_MAP = {
    'Enter': Key.enter,
    'NumpadEnter': Key.enter,
    'Backspace': Key.backspace,
    'Tab': Key.tab,
    'Escape': Key.esc,
    'Space': Key.space,
    'ArrowLeft': Key.left,
    'ArrowRight': Key.right,
    'ArrowUp': Key.up,
    'ArrowDown': Key.down,
    'Delete': Key.delete,
    'Home': Key.home,
    'End': Key.end,
    'PageUp': Key.page_up,
    'PageDown': Key.page_down,
    'ShiftLeft': Key.shift,
    'ShiftRight': Key.shift_r if hasattr(Key, 'shift_r') else Key.shift,
    'ControlLeft': Key.ctrl,
    'ControlRight': Key.ctrl_r if hasattr(Key, 'ctrl_r') else Key.ctrl,
    'AltLeft': Key.alt,
    'AltRight': Key.alt_r if hasattr(Key, 'alt_r') else Key.alt,
    'MetaLeft': Key.cmd,
    'MetaRight': Key.cmd_r if hasattr(Key, 'cmd_r') else Key.cmd,
    'CapsLock': Key.caps_lock,
    'Insert': Key.insert,
    'F1': Key.f1,
    'F2': Key.f2,
    'F3': Key.f3,
    'F4': Key.f4,
    'F5': Key.f5,
    'F6': Key.f6,
    'F7': Key.f7,
    'F8': Key.f8,
    'F9': Key.f9,
    'F10': Key.f10,
    'F11': Key.f11,
    'F12': Key.f12
}


def resolve_key(key_str, code_str):
    """Resolves browser key/code representation to a pynput Key or single character."""
    if code_str in KEY_CODE_MAP:
        return KEY_CODE_MAP[code_str]
    if key_str in KEY_CODE_MAP:
        return KEY_CODE_MAP[key_str]
    if key_str and len(key_str) == 1:
        return key_str
    return None


def handle_input_event(msg):
    """Dispatches incoming remote control event to OS input APIs."""
    event_type = msg.get('type')

    try:
        # Screen metadata
        if event_type == 'get_screen_info' or event_type == 'ping':
            sw, sh = pyautogui.size()
            send_message({
                'type': 'screen_info',
                'width': sw,
                'height': sh,
                'platform': platform.system(),
                'status': 'ready'
            })
            return

        # Mouse Movement (Normalized [0.0, 1.0])
        elif event_type == 'mouse_move':
            x_norm = float(msg.get('x', 0.5))
            y_norm = float(msg.get('y', 0.5))
            sw, sh = pyautogui.size()
            target_x = max(0, min(sw - 1, int(x_norm * sw)))
            target_y = max(0, min(sh - 1, int(y_norm * sh)))
            pyautogui.moveTo(target_x, target_y, _pause=False)

        # Mouse Down
        elif event_type == 'mouse_down':
            button = msg.get('button', 'left')
            if 'x' in msg and 'y' in msg:
                sw, sh = pyautogui.size()
                tx = max(0, min(sw - 1, int(float(msg['x']) * sw)))
                ty = max(0, min(sh - 1, int(float(msg['y']) * sh)))
                pyautogui.moveTo(tx, ty, _pause=False)
            pyautogui.mouseDown(button=button, _pause=False)

        # Mouse Up
        elif event_type == 'mouse_up':
            button = msg.get('button', 'left')
            if 'x' in msg and 'y' in msg:
                sw, sh = pyautogui.size()
                tx = max(0, min(sw - 1, int(float(msg['x']) * sw)))
                ty = max(0, min(sh - 1, int(float(msg['y']) * sh)))
                pyautogui.moveTo(tx, ty, _pause=False)
            pyautogui.mouseUp(button=button, _pause=False)

        # Mouse Click
        elif event_type == 'mouse_click':
            button = msg.get('button', 'left')
            double = msg.get('double', False)
            if 'x' in msg and 'y' in msg:
                sw, sh = pyautogui.size()
                tx = max(0, min(sw - 1, int(float(msg['x']) * sw)))
                ty = max(0, min(sh - 1, int(float(msg['y']) * sh)))
                pyautogui.moveTo(tx, ty, _pause=False)
            if double:
                pyautogui.doubleClick(button=button, _pause=False)
            else:
                pyautogui.click(button=button, _pause=False)

        # Mouse Scroll
        elif event_type == 'mouse_scroll':
            dy = float(msg.get('dy', 0))
            dx = float(msg.get('dx', 0))
            if dy != 0:
                # Browser deltaY down is positive; pyautogui scroll up is positive
                scroll_units = int(-dy / 25)
                if scroll_units == 0:
                    scroll_units = -1 if dy > 0 else 1
                pyautogui.scroll(scroll_units, _pause=False)
            if dx != 0 and hasattr(pyautogui, 'hscroll'):
                hscroll_units = int(-dx / 25)
                pyautogui.hscroll(hscroll_units, _pause=False)

        # Key Down
        elif event_type == 'key_down':
            if not keyboard:
                return
            target_key = resolve_key(msg.get('key'), msg.get('code'))
            if target_key:
                keyboard.press(target_key)

        # Key Up
        elif event_type == 'key_up':
            if not keyboard:
                return
            target_key = resolve_key(msg.get('key'), msg.get('code'))
            if target_key:
                keyboard.release(target_key)

        # Text Typing Simulation
        elif event_type == 'key_type':
            text = msg.get('text', '')
            if keyboard and text:
                keyboard.type(text)

        # Clipboard Paste
        elif event_type == 'clipboard_paste':
            text = msg.get('text', '')
            if text:
                pyperclip.copy(text)
                cmd_key = Key.cmd if platform.system() == 'Darwin' else Key.ctrl
                with keyboard.pressed(cmd_key):
                    keyboard.press('v')
                    keyboard.release('v')

        # Special OS Key Combos
        elif event_type == 'special_combo':
            combo = msg.get('combo')
            if combo == 'win':
                keyboard.press(Key.cmd)
                keyboard.release(Key.cmd)
            elif combo == 'alt_tab':
                with keyboard.pressed(Key.alt):
                    keyboard.press(Key.tab)
                    keyboard.release(Key.tab)
            elif combo == 'ctrl_alt_del':
                # Note: WinLogon SAS restricts remote Ctrl+Alt+Del on Windows; simulate Task Manager shortcut
                if platform.system() == 'Windows':
                    with keyboard.pressed(Key.ctrl):
                        with keyboard.pressed(Key.shift):
                            keyboard.press(Key.esc)
                            keyboard.release(Key.esc)
                else:
                    with keyboard.pressed(Key.ctrl):
                        with keyboard.pressed(Key.alt):
                            keyboard.press(Key.delete)
                            keyboard.release(Key.delete)

    except Exception as e:
        logging.error(f"Error handling event {event_type}: {e}")


def main():
    logging.info("Native Messaging Loop entered.")
    # On start, let host know we are online
    sw, sh = pyautogui.size()
    send_message({
        'type': 'ready',
        'width': sw,
        'height': sh,
        'platform': platform.system()
    })

    while True:
        msg = read_message()
        if msg is None:
            logging.info("Host closed stdio stream. Exiting controller.")
            break
        handle_input_event(msg)


if __name__ == '__main__':
    main()
