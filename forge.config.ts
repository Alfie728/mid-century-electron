import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
// AutoUnpackNativesPlugin disabled - requires asar
// import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import * as fs from "fs";
import * as path from "path";

import { mainConfig } from "./webpack.main.config";
import { rendererConfig } from "./webpack.renderer.config";

// Helper to copy directory recursively
function copyDirSync(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    // Disable asar for now to debug native module issues
    asar: false,
  },
  hooks: {
    // Create a launcher for macOS 26 compatibility after packaging
    // NOTE: As of Dec 2024, Electron 38-39 has a fundamental crash on macOS 26 (Tahoe) beta.
    // The crash occurs at ElectronMain+124 during V8 initialization, BEFORE any JavaScript
    // or command-line arguments are processed. This launcher may not help until Apple or
    // Electron provides a fix. See: https://github.com/microsoft/vscode/issues/278451
    postPackage: async (_config, options) => {
      if (process.platform !== "darwin") return;

      const outputDir = options.outputPaths[0];
      const entries = fs.readdirSync(outputDir);
      const appBundle = entries.find((e: string) => e.endsWith(".app"));
      if (!appBundle) return;

      const appName = appBundle.replace(".app", "");
      const launcherDir = path.join(outputDir, `${appName} Launcher.app`);
      const contentsDir = path.join(launcherDir, "Contents");
      const macosDir = path.join(contentsDir, "MacOS");
      const resourcesDir = path.join(contentsDir, "Resources");

      // Create launcher app structure
      fs.mkdirSync(macosDir, { recursive: true });
      fs.mkdirSync(resourcesDir, { recursive: true });

      // Create Info.plist for launcher
      const launcherPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>launcher</string>
  <key>CFBundleIdentifier</key>
  <string>com.electron.launcher</string>
  <key>CFBundleName</key>
  <string>${appName} Launcher</string>
  <key>CFBundleDisplayName</key>
  <string>${appName}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>`;
      fs.writeFileSync(path.join(contentsDir, "Info.plist"), launcherPlist);

      // Create launcher shell script
      // Use environment variables and flags to work around macOS 26 crashes
      const launcherScript = `#!/bin/bash
# Launcher for macOS 26 (Tahoe) compatibility
# Electron 39's native initialization crashes on macOS 26 beta.
# This launcher disables problematic features during early init.
DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$(dirname "$(dirname "$DIR")")")"

# Disable security features that may crash on macOS 26
export ELECTRON_NO_SANDBOX=1
export ELECTRON_DISABLE_SECURITY_WARNINGS=1
export NODE_OPTIONS="--no-node-snapshot"

# V8 flags to disable features that may be incompatible with macOS 26
export V8_FLAGS="--no-lazy"

# macOS 26 workarounds
exec "$APP_DIR/${appBundle}/Contents/MacOS/electron" \\
  --no-sandbox \\
  --disable-gpu-sandbox \\
  --use-mock-keychain \\
  --disable-features=SandboxV2,CertificateTransparency,OptimizationGuideModelDownloading \\
  --no-zygote \\
  --disable-dev-shm-usage \\
  --js-flags="--no-lazy" \\
  "$@"
`;
      const launcherPath = path.join(macosDir, "launcher");
      fs.writeFileSync(launcherPath, launcherScript, { mode: 0o755 });

      console.log(`Created macOS 26 launcher at: ${launcherDir}`);
      console.log(
        `\nIMPORTANT: On macOS 26 (Tahoe), use "${appName} Launcher.app" to run the app.`
      );
      console.log(
        `Or run from terminal: ${appBundle}/Contents/MacOS/electron --no-sandbox`
      );
    },
    // Copy native module and its dependencies to webpack output before packaging
    packageAfterCopy: async (_config, buildPath) => {
      const nativeModules = [
        "iohook-macos",
        "node-gyp-build", // Required by iohook-macos for binary loading
        "node-addon-api", // Required by iohook-macos for N-API bindings
      ];

      for (const moduleName of nativeModules) {
        const src = path.resolve(__dirname, "node_modules", moduleName);
        const dest = path.join(buildPath, "node_modules", moduleName);

        if (fs.existsSync(src)) {
          console.log(`Copying ${moduleName} to ${dest}`);
          copyDirSync(src, dest);
        } else {
          console.warn(`Warning: ${moduleName} not found at ${src}`);
        }
      }
    },
  },
  rebuildConfig: {
    // Note: iohook-macos ships with prebuilt N-API binaries and cannot be rebuilt
    // from source (no binding.gyp included). The prebuilds should work with Electron.
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    // AutoUnpackNativesPlugin disabled - requires asar
    // new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      devContentSecurityPolicy: "connect-src 'self' * 'unsafe-eval'",
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: "./src/index.html",
            js: "./src/renderer.ts",
            name: "main_window",
            preload: {
              js: "./src/preload.ts",
            },
            nodeIntegration: true,
          },
          {
            html: "./src/toolbar.html",
            js: "./src/toolbarRenderer.ts",
            name: "toolbar_window",
            preload: {
              js: "./src/preload.ts",
            },
            nodeIntegration: true,
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      // Disabled for native module compatibility with app.asar.unpacked
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};

export default config;
