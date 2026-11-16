/** Set-1 scancodes as delivered by Windows Raw Input, mapped to KeyboardEvent.code names. */
const PLAIN: Record<number, string> = {
  0x01: 'Escape',
  0x0c: 'Minus',
  0x0d: 'Equal',
  0x0e: 'Backspace',
  0x0f: 'Tab',
  0x1a: 'BracketLeft',
  0x1b: 'BracketRight',
  0x1c: 'Enter',
  0x1d: 'ControlLeft',
  0x27: 'Semicolon',
  0x28: 'Quote',
  0x29: 'Backquote',
  0x2a: 'ShiftLeft',
  0x2b: 'Backslash',
  0x33: 'Comma',
  0x34: 'Period',
  0x35: 'Slash',
  0x36: 'ShiftRight',
  0x37: 'NumpadMultiply',
  0x38: 'AltLeft',
  0x39: 'Space',
  0x3a: 'CapsLock',
  0x47: 'Numpad7',
  0x48: 'Numpad8',
  0x49: 'Numpad9',
  0x4a: 'NumpadSubtract',
  0x4b: 'Numpad4',
  0x4c: 'Numpad5',
  0x4d: 'Numpad6',
  0x4e: 'NumpadAdd',
  0x4f: 'Numpad1',
  0x50: 'Numpad2',
  0x51: 'Numpad3',
  0x52: 'Numpad0',
  0x53: 'NumpadDecimal',
  0x56: 'IntlBackslash',
  0x57: 'F11',
  0x58: 'F12',
};

const EXTENDED: Record<number, string> = {
  0x1c: 'NumpadEnter',
  0x1d: 'ControlRight',
  0x35: 'NumpadDivide',
  0x38: 'AltRight',
  0x47: 'Home',
  0x48: 'ArrowUp',
  0x49: 'PageUp',
  0x4b: 'ArrowLeft',
  0x4d: 'ArrowRight',
  0x4f: 'End',
  0x50: 'ArrowDown',
  0x51: 'PageDown',
  0x52: 'Insert',
  0x53: 'Delete',
};

const ROWS: [number, string][] = [
  [0x10, 'QWERTYUIOP'],
  [0x1e, 'ASDFGHJKL'],
  [0x2c, 'ZXCVBNM'],
];
for (const [start, letters] of ROWS) {
  [...letters].forEach((ch, i) => (PLAIN[start + i] = `Key${ch}`));
}
for (let i = 0; i < 10; i++) PLAIN[0x02 + i] = `Digit${(i + 1) % 10}`;
for (let i = 0; i < 10; i++) PLAIN[0x3b + i] = `F${i + 1}`;

export function scancodeToCode(sc: number, e0: boolean): string {
  return (e0 ? EXTENDED[sc] : PLAIN[sc]) ?? `Sc${e0 ? 'E0' : ''}${sc.toString(16).toUpperCase()}`;
}

const PRETTY: Record<string, string> = {
  Mouse0: 'Left click',
  Mouse1: 'Middle click',
  Mouse2: 'Right click',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
};

export function prettyCode(code: string): string {
  return PRETTY[code] ?? code.replace(/^Key|^Digit/, '');
}
