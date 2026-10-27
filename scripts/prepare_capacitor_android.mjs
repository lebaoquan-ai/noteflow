#!/usr/bin/env node
/**
 * NoteFlow — Capacitor Android Project Initializer & 120Hz Galaxy Tab Manifest Tuner
 *
 * Ensures `dist/` is built, installs `@capacitor/*` packages on-demand, creates/syncs
 * the `android/` Gradle project, and tunes `AndroidManifest.xml` for 120Hz S-Pen performance.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const CAP_ANDROID_PKG = path.join(ROOT, 'node_modules', '@capacitor', 'android', 'package.json');
const ANDROID_DIR = path.join(ROOT, 'android');
const MANIFEST_PATH = path.join(ANDROID_DIR, 'app', 'src', 'main', 'AndroidManifest.xml');

function run(cmd) {
  console.log(`[apk:prepare] $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT });
}

// 1. Ensure production web bundle exists in dist/
if (!fs.existsSync(DIST_INDEX)) {
  run('npm run build');
}

// 2. Install Capacitor packages on-demand if not already installed
if (!fs.existsSync(CAP_ANDROID_PKG)) {
  run('npm install --no-save @capacitor/core@^7.0.0 @capacitor/cli@^7.0.0 @capacitor/android@^7.0.0');
}

// 3. Create or sync the Android Gradle project
if (!fs.existsSync(ANDROID_DIR)) {
  run('npx cap add android');
}
run('npx cap sync android');

// 4. Patch AndroidManifest.xml for 120Hz GPU acceleration & large heap on Galaxy Tab
if (fs.existsSync(MANIFEST_PATH)) {
  let manifest = fs.readFileSync(MANIFEST_PATH, 'utf8');
  let modified = false;

  if (!manifest.includes('android:hardwareAccelerated="true"')) {
    manifest = manifest.replace(
      '<application',
      '<application\n        android:hardwareAccelerated="true"'
    );
    modified = true;
  }

  if (!manifest.includes('android:largeHeap="true"')) {
    manifest = manifest.replace(
      '<application',
      '<application\n        android:largeHeap="true"'
    );
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(MANIFEST_PATH, manifest, 'utf8');
    console.log('[apk:prepare] Patched AndroidManifest.xml with hardwareAccelerated="true" & largeHeap="true".');
  }
}

console.log('[apk:prepare] Capacitor Android project is ready at ./android');
