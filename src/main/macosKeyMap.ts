import type { EventData } from "iohook-macos";

type Modifiers = EventData["modifiers"];

const LETTERS: Record<number, string> = {
  0: "a",
  1: "s",
  2: "d",
  3: "f",
  4: "h",
  5: "g",
  6: "z",
  7: "x",
  8: "c",
  9: "v",
  11: "b",
  12: "q",
  13: "w",
  14: "e",
  15: "r",
  16: "y",
  17: "t",
  31: "o",
  32: "u",
  34: "i",
  35: "p",
  37: "l",
  38: "j",
  40: "k",
  45: "n",
  46: "m",
};

const DIGITS: Record<number, string> = {
  18: "1",
  19: "2",
  20: "3",
  21: "4",
  23: "5",
  22: "6",
  26: "7",
  28: "8",
  25: "9",
  29: "0",
};

const SHIFTED_DIGITS: Record<string, string> = {
  "1": "!",
  "2": "@",
  "3": "#",
  "4": "$",
  "5": "%",
  "6": "^",
  "7": "&",
  "8": "*",
  "9": "(",
  "0": ")",
};

const PUNCTUATION: Record<
  number,
  { key: string; code: string; shifted?: string }
> = {
  24: { key: "=", code: "Equal", shifted: "+" },
  27: { key: "-", code: "Minus", shifted: "_" },
  30: { key: "]", code: "BracketRight", shifted: "}" },
  33: { key: "[", code: "BracketLeft", shifted: "{" },
  41: { key: ";", code: "Semicolon", shifted: ":" },
  39: { key: "'", code: "Quote", shifted: "\"" },
  43: { key: ",", code: "Comma", shifted: "<" },
  47: { key: ".", code: "Period", shifted: ">" },
  44: { key: "/", code: "Slash", shifted: "?" },
  42: { key: "\\", code: "Backslash", shifted: "|" },
  50: { key: "`", code: "Backquote", shifted: "~" },
};

const SPECIALS: Record<number, { key: string; code: string }> = {
  36: { key: "Enter", code: "Enter" },
  48: { key: "Tab", code: "Tab" },
  49: { key: " ", code: "Space" },
  51: { key: "Backspace", code: "Backspace" },
  53: { key: "Escape", code: "Escape" },
  55: { key: "Meta", code: "MetaLeft" },
  56: { key: "Shift", code: "ShiftLeft" },
  57: { key: "CapsLock", code: "CapsLock" },
  58: { key: "Alt", code: "AltLeft" },
  59: { key: "Control", code: "ControlLeft" },
  60: { key: "Shift", code: "ShiftRight" },
  61: { key: "Alt", code: "AltRight" },
  62: { key: "Control", code: "ControlRight" },
  63: { key: "Fn", code: "Fn" },
  123: { key: "ArrowLeft", code: "ArrowLeft" },
  124: { key: "ArrowRight", code: "ArrowRight" },
  125: { key: "ArrowDown", code: "ArrowDown" },
  126: { key: "ArrowUp", code: "ArrowUp" },
};

export function macKeyCodeToKeyAndCode(
  keyCode: number,
  modifiers: Modifiers
): { key: string; code: string } {
  const shift = modifiers.shift;

  const letter = LETTERS[keyCode];
  if (letter) {
    return {
      key: shift ? letter.toUpperCase() : letter,
      code: `Key${letter.toUpperCase()}`,
    };
  }

  const digit = DIGITS[keyCode];
  if (digit) {
    return {
      key: shift ? SHIFTED_DIGITS[digit] : digit,
      code: `Digit${digit}`,
    };
  }

  const punctuation = PUNCTUATION[keyCode];
  if (punctuation) {
    return {
      key: shift && punctuation.shifted ? punctuation.shifted : punctuation.key,
      code: punctuation.code,
    };
  }

  const special = SPECIALS[keyCode];
  if (special) return special;

  return { key: `Unknown(${keyCode})`, code: `MacKeyCode(${keyCode})` };
}

