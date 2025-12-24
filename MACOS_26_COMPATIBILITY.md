# macOS 26 (Tahoe) Compatibility

## Known Issue

As of December 2024, **packaged** Electron applications (versions 38-39) crash immediately on macOS 26.1 (Tahoe beta) with an `EXC_BREAKPOINT (SIGTRAP)` error at `ElectronMain + 124`.

**Development mode works fine** - the issue only affects packaged/bundled apps.

## Root Cause

The crash occurs during Electron's native V8/Chromium initialization, **before** any JavaScript code or command-line arguments (like `--no-sandbox`) are processed. This is a fundamental incompatibility between Electron's native code and macOS 26's new runtime environment.

Related issues:

- **[Electron #49105](https://github.com/electron/electron/issues/49105)** - "macOS Crash on startup" (Electron 39.2.4, macOS 26.1) - _Closed as not planned_
- **[Electron #49185](https://github.com/electron/electron/issues/49185)** - Similar crash on macOS 26 with `ElectronMain` crash
- [VS Code #278451](https://github.com/microsoft/vscode/issues/278451) - Similar crash in VS Code
- The crash involves `rust_png$cxxbridge1`, `v8::CpuProfileNode::GetNodeId()` and V8 initialization code

## Current Workarounds

### Option 1: Use Development Mode (Recommended for Development)

```bash
npm run start
```

This works correctly on macOS 26.

### Option 2: Run from Terminal with `--no-sandbox`

After packaging, try running directly from terminal:

```bash
./out/electron-darwin-arm64/electron.app/Contents/MacOS/electron --no-sandbox
```

**Note:** This may not work if the crash happens before argument parsing.

### Option 3: Use the Launcher App

A launcher app is automatically created during packaging:

```bash
open "./out/electron-darwin-arm64/electron Launcher.app"
```

The launcher passes `--no-sandbox` and other flags, but may not help due to the early crash.

### Option 4: Use a Stable macOS Version

Run on macOS 15.x (Sequoia) or earlier until Electron or Apple provides a fix.

## Status

- **Electron versions tested:** 38.2.0, 39.2.5, 39.2.7 - All crash
- **macOS version:** 26.1 (25B78) beta
- **Expected fix:** Waiting for either:
  - An Electron update with macOS 26 compatibility
  - A macOS 26 update that fixes Electron compatibility

## Technical Details

The crash stack trace shows:

```
ElectronMain + 124
v8::ObjectTemplate::SetHandler()
v8::CpuProfileNode::GetNodeId() const
...
```

This indicates the crash happens during V8 JavaScript engine initialization, specifically during object template setup. The `--no-sandbox` flag doesn't help because it's processed after V8 is initialized.

## Building for Production

When building for users:

1. Target macOS 15.x (Sequoia) or earlier
2. Document that macOS 26 beta is not supported until Electron releases a fix
3. Monitor Electron releases for macOS 26 compatibility updates
