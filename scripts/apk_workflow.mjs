#!/usr/bin/env node
/**
 * NoteFlow — Galaxy Tab APK Workflow CLI (`trigger`, `pull`, `serve`, `build-local`)
 *
 * Usage:
 *   npm run apk:trigger      # Trigger GitHub Actions APK build, wait, and pull .apk
 *   npm run apk:pull         # Pull latest built .apk from GitHub Actions into ./dist-apk/
 *   npm run apk:serve        # Start Wi-Fi LAN HTTP server (:8080) to download .apk on Galaxy Tab
 *   npm run apk:build:local  # Build .apk locally using self-contained user-space JDK 21 + Android SDK
 */
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_APK_DIR = path.join(ROOT, 'dist-apk');
const APK_FILENAME = 'noteflow-galaxy-tab-debug.apk';
const APK_PATH = path.join(DIST_APK_DIR, APK_FILENAME);
const WORKFLOW_FILE = 'build-android-apk.yml';

function execOut(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', cwd: ROOT, ...opts }).trim();
}

function getLocalLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ iface: name, address: net.address });
      }
    }
  }
  return ips;
}

function printApkSummary(apkFile) {
  const stat = fs.statSync(apkFile);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(apkFile)).digest('hex');
  const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
  console.log('\n============================================================');
  console.log('✓ Galaxy Tab S-Pen APK Ready!');
  console.log(`  File   : ${apkFile}`);
  console.log(`  Size   : ${sizeMb} MB`);
  console.log(`  SHA256 : ${hash.slice(0, 16)}...`);
  console.log('  Next   : Run `npm run apk:serve` to download over Wi-Fi on your Galaxy Tab.');
  console.log('============================================================\n');
}

function pullFromGitHubActions() {
  fs.mkdirSync(DIST_APK_DIR, { recursive: true });
  console.log('[apk:pull] Finding latest Build Galaxy Tab Android APK workflow run...');
  const runsJson = execOut(
    `gh run list --workflow=${WORKFLOW_FILE} --limit 5 --json databaseId,status,conclusion,headSha`
  );
  const runs = JSON.parse(runsJson);
  if (!Array.isArray(runs) || runs.length === 0) {
    throw new Error(`No workflow runs found for ${WORKFLOW_FILE}. Push to main or run 'npm run apk:trigger'.`);
  }

  let targetRun = runs[0];
  if (targetRun.status !== 'completed') {
    console.log(`[apk:pull] Waiting for in-progress workflow run #${targetRun.databaseId} to finish...`);
    execSync(`gh run watch ${targetRun.databaseId} --exit-status`, { stdio: 'inherit', cwd: ROOT });
  } else if (targetRun.conclusion !== 'success') {
    const lastSuccess = runs.find((r) => r.conclusion === 'success');
    if (!lastSuccess) {
      throw new Error(`Latest workflow run #${targetRun.databaseId} concluded with '${targetRun.conclusion}'.`);
    }
    targetRun = lastSuccess;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteflow-apk-'));
  console.log(`[apk:pull] Downloading artifact from run #${targetRun.databaseId}...`);
  execSync(`gh run download ${targetRun.databaseId} -n noteflow-galaxy-tab-debug-apk -D "${tmpDir}"`, {
    stdio: 'inherit',
    cwd: ROOT,
  });

  const downloadedCandidate = fs.existsSync(path.join(tmpDir, APK_FILENAME))
    ? path.join(tmpDir, APK_FILENAME)
    : path.join(tmpDir, 'app-debug.apk');

  if (!fs.existsSync(downloadedCandidate)) {
    throw new Error(`Downloaded artifact did not contain ${APK_FILENAME} or app-debug.apk`);
  }

  fs.copyFileSync(downloadedCandidate, APK_PATH);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  printApkSummary(APK_PATH);
}

function triggerGitHubActions() {
  console.log(`[apk:trigger] Triggering ${WORKFLOW_FILE} on GitHub Actions...`);
  execSync(`gh workflow run ${WORKFLOW_FILE}`, { stdio: 'inherit', cwd: ROOT });
  execSync('sleep 3');
  pullFromGitHubActions();
}

function buildLocalSelfContained() {
  const cacheDir = path.join(os.homedir(), '.cache', 'noteflow-android-toolchain');
  const jdkDir = path.join(cacheDir, 'jdk-21');
  const sdkDir = path.join(cacheDir, 'android-sdk');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(DIST_APK_DIR, { recursive: true });

  // 1. Download Portable Temurin JDK 21 (x64 Linux) if not cached
  if (!fs.existsSync(path.join(jdkDir, 'bin', 'java'))) {
    console.log('[apk:build:local] Downloading portable Eclipse Temurin JDK 21 to ~/.cache/noteflow-android-toolchain...');
    fs.mkdirSync(jdkDir, { recursive: true });
    const jdkTar = path.join(cacheDir, 'temurin21.tar.gz');
    execSync(
      `curl -L --fail -o "${jdkTar}" "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse?project=jdk"`,
      { stdio: 'inherit' }
    );
    execSync(`tar -xzf "${jdkTar}" -C "${jdkDir}" --strip-components=1`, { stdio: 'inherit' });
    fs.rmSync(jdkTar, { force: true });
  }

  // 2. Download Portable Android Command-Line Tools if not cached
  const sdkManagerBin = path.join(sdkDir, 'cmdline-tools', 'latest', 'bin', 'sdkmanager');
  if (!fs.existsSync(sdkManagerBin)) {
    console.log('[apk:build:local] Downloading Android Command-Line Tools to ~/.cache/noteflow-android-toolchain...');
    const cmdToolsDir = path.join(sdkDir, 'cmdline-tools');
    fs.mkdirSync(cmdToolsDir, { recursive: true });
    const sdkZip = path.join(cacheDir, 'cmdline-tools.zip');
    execSync(
      `curl -L --fail -o "${sdkZip}" "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"`,
      { stdio: 'inherit' }
    );
    execSync(`unzip -q -o "${sdkZip}" -d "${cmdToolsDir}"`, { stdio: 'inherit' });
    const extracted = path.join(cmdToolsDir, 'cmdline-tools');
    const latestDir = path.join(cmdToolsDir, 'latest');
    if (fs.existsSync(latestDir)) fs.rmSync(latestDir, { recursive: true, force: true });
    fs.renameSync(extracted, latestDir);
    fs.rmSync(sdkZip, { force: true });

    const env = {
      ...process.env,
      JAVA_HOME: jdkDir,
      ANDROID_HOME: sdkDir,
      ANDROID_SDK_ROOT: sdkDir,
      PATH: `${path.join(jdkDir, 'bin')}:${process.env.PATH}`,
    };
    console.log('[apk:build:local] Accepting Android SDK licenses & installing platform-tools, android-35, build-tools;35.0.0...');
    execSync(`yes | "${sdkManagerBin}" --licenses > /dev/null || true`, { env, stdio: 'inherit' });
    execSync(`"${sdkManagerBin}" "platform-tools" "platforms;android-35" "build-tools;35.0.0"`, {
      env,
      stdio: 'inherit',
    });
  }

  // 3. Prepare Capacitor Android project & assembleDebug
  const env = {
    ...process.env,
    JAVA_HOME: jdkDir,
    ANDROID_HOME: sdkDir,
    ANDROID_SDK_ROOT: sdkDir,
    PATH: `${path.join(jdkDir, 'bin')}:${path.join(sdkDir, 'platform-tools')}:${process.env.PATH}`,
  };

  execSync('npm run build', { env, stdio: 'inherit', cwd: ROOT });
  execSync('node scripts/prepare_capacitor_android.mjs', { env, stdio: 'inherit', cwd: ROOT });

  const gradleCmd = './gradlew assembleDebug --no-daemon';
  const androidProjectDir = path.join(ROOT, 'android');
  fs.chmodSync(path.join(androidProjectDir, 'gradlew'), 0o755);
  console.log('[apk:build:local] Running Gradle assembleDebug...');
  execSync(gradleCmd, { env, stdio: 'inherit', cwd: androidProjectDir });

  const builtApk = path.join(androidProjectDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  fs.copyFileSync(builtApk, APK_PATH);
  printApkSummary(APK_PATH);
}

function serveApkOverLan() {
  if (!fs.existsSync(APK_PATH)) {
    throw new Error(
      `APK not found at ${APK_PATH}. Run 'npm run apk:pull' or 'npm run apk:build:local' first.`
    );
  }
  const port = Number(process.env.APK_PORT || 8080);
  const stat = fs.statSync(APK_PATH);
  const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);

  const server = http.createServer((req, res) => {
    if (req.url === `/${APK_FILENAME}` || req.url === '/download') {
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': `attachment; filename="${APK_FILENAME}"`,
        'Content-Length': stat.size,
      });
      fs.createReadStream(APK_PATH).pipe(res);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>NoteFlow — Galaxy Tab APK Installer</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
    .card { max-width: 480px; background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { color: #94a3b8; line-height: 1.5; margin-bottom: 24px; }
    .btn { display: inline-block; background: #6366f1; color: white; font-weight: 600; font-size: 18px; padding: 16px 28px; border-radius: 12px; text-decoration: none; }
    .meta { margin-top: 20px; font-size: 13px; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚛ NoteFlow Galaxy Tab APK</h1>
    <p>Stylus-First Multimodal Spatial Zettelkasten (Track 2 & Track 3 Build)</p>
    <a class="btn" href="/${APK_FILENAME}">⬇ Download APK (${sizeMb} MB)</a>
    <div class="meta">File: ${APK_FILENAME} • Enable "Install unknown apps" on Android when prompted.</div>
  </div>
</body>
</html>`);
  });

  server.listen(port, '0.0.0.0', () => {
    const ips = getLocalLanIps();
    console.log('\n============================================================');
    console.log('📡 NoteFlow Galaxy Tab Wi-Fi APK Download Server Running!');
    console.log('Open any of these URLs on your Galaxy Tab browser (same Wi-Fi):');
    for (const { iface, address } of ips) {
      console.log(`  👉 http://${address}:${port}          (${iface})`);
      console.log(`  👉 http://${address}:${port}/${APK_FILENAME}`);
    }
    console.log('\nOr download directly from GitHub Releases anytime:');
    console.log('  👉 https://github.com/lebaoquan-ai/noteflow/releases/download/latest-apk/noteflow-galaxy-tab-debug.apk');
    console.log('============================================================\n');
  });
}

const cmd = process.argv[2] ?? 'pull';
if (cmd === 'pull') {
  pullFromGitHubActions();
} else if (cmd === 'trigger') {
  triggerGitHubActions();
} else if (cmd === 'build-local') {
  buildLocalSelfContained();
} else if (cmd === 'serve') {
  serveApkOverLan();
} else {
  console.error(`Unknown subcommand '${cmd}'. Expected: pull | trigger | build-local | serve`);
  process.exit(1);
}
