const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const IDENTITY = "Developer ID Application: Brandon Samaroo (UCF4K36X9Q)";
const ENTITLEMENTS = path.join(__dirname, "..", "entitlements.plist");
const KEYCHAIN_PROFILE = "notarytool-profile";

function run(cmd) {
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch (e) {
    console.error(`Command failed: ${cmd}`);
    throw e;
  }
}

function signFile(filePath, withEntitlements = false) {
  const entitlementsArg = withEntitlements ? `--entitlements "${ENTITLEMENTS}"` : "";
  run(`codesign --force --sign "${IDENTITY}" --options runtime --timestamp ${entitlementsArg} "${filePath}"`);
}

async function signAndNotarize(appPath) {
  console.log(`\n🔐 Signing ${appPath}\n`);

  // Sign all .node files
  const nodeFiles = execSync(`find "${appPath}" -name "*.node"`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  for (const file of nodeFiles) {
    signFile(file);
  }

  // Sign all .dylib files
  const dylibFiles = execSync(`find "${appPath}" -name "*.dylib"`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  for (const file of dylibFiles) {
    signFile(file);
  }

  // Sign helper executables in Resources
  const helperExecs = execSync(`find "${appPath}" -type f -perm +111 -path "*/Resources/*" 2>/dev/null || true`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  for (const file of helperExecs) {
    signFile(file);
  }

  // Sign chrome_crashpad_handler
  const crashpadHandler = path.join(appPath, "Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler");
  if (fs.existsSync(crashpadHandler)) {
    signFile(crashpadHandler);
  }

  // Sign all frameworks
  const frameworksDir = path.join(appPath, "Contents/Frameworks");
  const frameworks = fs.readdirSync(frameworksDir).filter(f => f.endsWith(".framework"));
  for (const framework of frameworks) {
    signFile(path.join(frameworksDir, framework));
  }

  // Sign helper apps
  const helperApps = fs.readdirSync(frameworksDir).filter(f => f.endsWith(".app"));
  for (const helper of helperApps) {
    signFile(path.join(frameworksDir, helper), true);
  }

  // Sign main app
  signFile(appPath, true);

  // Verify signature
  console.log("\n✅ Verifying signature...\n");
  run(`codesign -vvv --deep --strict "${appPath}"`);

  // Create zip for notarization
  const appName = path.basename(appPath);
  const zipPath = path.join(path.dirname(appPath), `${appName}.zip`);
  console.log("\n📦 Creating zip for notarization...\n");
  run(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`);

  // Submit for notarization
  console.log("\n📤 Submitting for notarization...\n");
  run(`xcrun notarytool submit "${zipPath}" --keychain-profile "${KEYCHAIN_PROFILE}" --wait`);

  // Staple
  console.log("\n📎 Stapling notarization ticket...\n");
  run(`xcrun stapler staple "${appPath}"`);

  // Replace notarization zip with final distributable zip (includes stapled ticket)
  fs.unlinkSync(zipPath);
  const distZipPath = path.join(path.dirname(appPath), `${path.basename(appPath, ".app")}.zip`);
  console.log("\n📦 Creating distributable zip...\n");
  run(`ditto -c -k --keepParent "${appPath}" "${distZipPath}"`);

  console.log(`\n✅ Done! App is signed and notarized.`);
  console.log(`📦 Distributable zip: ${distZipPath}\n`);
}

// Get app path from command line or find it
const appPath = process.argv[2] || (() => {
  const outDir = path.join(__dirname, "..", "out");
  const dirs = fs.readdirSync(outDir).filter(d => d.includes("darwin"));
  if (dirs.length === 0) throw new Error("No darwin build found in out/");
  const buildDir = path.join(outDir, dirs[0]);
  const apps = fs.readdirSync(buildDir).filter(f => f.endsWith(".app"));
  if (apps.length === 0) throw new Error("No .app found in build directory");
  return path.join(buildDir, apps[0]);
})();

signAndNotarize(appPath).catch(e => {
  console.error(e);
  process.exit(1);
});
