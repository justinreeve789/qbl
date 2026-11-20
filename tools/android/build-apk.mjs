/**
 * Builds the QuestLab Android app: a Trusted Web Activity (TWA), the way Google recommends putting
 * a PWA on Android and in the Play Store. The app is a thin shell that opens the live site
 * (app.json "host") full screen in the phone's Chrome, so it is always the version on the
 * server: deploying the site updates the app, and the APK only needs rebuilding when the app's
 * name, icon, colours or address change.
 *
 *   cd tools/android && npm install
 *   ANDROID_HOME=~/android-sdk QBL_ANDROID_KEYSTORE_PASSWORD=… npm run build
 *
 * Writes, in tools/android/dist/:
 *   questlab-<version>.apk   signed, to install directly ("sideload") or hand out
 *   questlab-<version>.aab   signed, for the Play Store
 * and apps/client/public/.well-known/assetlinks.json, which the site must serve: it is how
 * Chrome checks the app belongs to the site. Until the live site serves it, the app still works
 * but shows a small address bar at the top.
 *
 * Needs: Java 17+, an Android SDK with "platforms;android-36" and "build-tools;35.0.0"
 * (sdkmanager), and the network the first time (Gradle and the Android libraries).
 *
 * Settings (environment):
 *   ANDROID_HOME                     the Android SDK
 *   QBL_ANDROID_KEYSTORE             the signing key (default tools/android/questlab.keystore).
 *                                    Made if missing. KEEP IT and its password: every later
 *                                    version of the app must be signed with the same key.
 *   QBL_ANDROID_KEYSTORE_PASSWORD    its password (required)
 *   QBL_ANDROID_KEY_ALIAS            default "questlab"
 *   QBL_ANDROID_KEY_PASSWORD         default: the keystore's password
 *   QBL_ANDROID_HOST                 another site than app.json's (e.g. the production address)
 *   QBL_ANDROID_VERSION_CODE/_NAME   instead of app.json's (raise the code for every release)
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bubblewrap from '@bubblewrap/core';

const { TwaGenerator, TwaManifest, ConsoleLog } = bubblewrap;
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const env = process.env;

const app = JSON.parse(readFileSync(join(here, 'app.json'), 'utf8'));
const host = env.QBL_ANDROID_HOST || app.host;
const versionCode = Number(env.QBL_ANDROID_VERSION_CODE || app.versionCode);
const versionName = env.QBL_ANDROID_VERSION_NAME || app.versionName;

const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
if (!sdk || !existsSync(sdk)) fail('Set ANDROID_HOME to an Android SDK (see the top of this file).');
const buildTools = join(sdk, 'build-tools', '35.0.0');
if (!existsSync(buildTools)) fail(`No build-tools 35.0.0 in ${sdk}: sdkmanager "platforms;android-36" "build-tools;35.0.0"`);

const keystore = resolve(env.QBL_ANDROID_KEYSTORE || join(here, 'questlab.keystore'));
const storePass = env.QBL_ANDROID_KEYSTORE_PASSWORD;
const alias = env.QBL_ANDROID_KEY_ALIAS || 'questlab';
const keyPass = env.QBL_ANDROID_KEY_PASSWORD || storePass;
if (!storePass || storePass.length < 6) fail('Set QBL_ANDROID_KEYSTORE_PASSWORD (6 characters or more).');
// Passwords go to the tools through the environment, never on a command line.
const secrets = { ...env, QBL_KS_PASS: storePass, QBL_KEY_PASS: keyPass };

const work = join(here, 'build');
const project = join(work, 'project');
const dist = join(here, 'dist');
mkdirSync(dist, { recursive: true });

// 1. The signing key.
if (!existsSync(keystore)) {
  console.log(`Making a new signing key: ${keystore}`);
  run('keytool', ['-genkeypair', '-keystore', keystore, '-alias', alias, '-keyalg', 'RSA', '-keysize', '2048',
    '-validity', '10000', '-storepass:env', 'QBL_KS_PASS', '-keypass:env', 'QBL_KEY_PASS',
    '-dname', `CN=${app.name}, O=${app.name}`], { env: secrets });
}
const fingerprint = /SHA256:\s*([0-9A-F:]+)/.exec(
  run('keytool', ['-list', '-v', '-keystore', keystore, '-alias', alias, '-storepass:env', 'QBL_KS_PASS'], { env: secrets, quiet: true }),
)?.[1];
if (!fingerprint) fail('Could not read the signing key\'s SHA-256 fingerprint.');

// 2. The Android project, from Bubblewrap's template. Its icons are the repo's own, served here
//    for a moment, so the build does not depend on what the live site has.
const icons = join(repo, 'apps/client/public/icons');
const server = createServer((req, res) => {
  const file = join(icons, (req.url ?? '').replace(/^\/+/, '').replace(/\.\./g, ''));
  if (!existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': 'image/png' });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const iconBase = `http://127.0.0.1:${server.address().port}`;

rmSync(project, { recursive: true, force: true });
const manifest = new TwaManifest({
  packageId: app.packageId,
  host,
  name: app.name,
  launcherName: app.launcherName,
  display: app.display,
  orientation: app.orientation,
  themeColor: app.themeColor,
  themeColorDark: app.themeColor,
  navigationColor: app.navigationColor,
  navigationColorDark: app.navigationColor,
  navigationDividerColor: app.navigationColor,
  navigationDividerColorDark: app.navigationColor,
  backgroundColor: app.backgroundColor,
  enableNotifications: false,
  startUrl: app.startUrl,
  iconUrl: `${iconBase}/icon-512.png`,
  maskableIconUrl: `${iconBase}/maskable-512.png`,
  splashScreenFadeOutDuration: 300,
  signingKey: { path: keystore, alias },
  appVersionCode: versionCode,
  appVersion: versionName,
  shortcuts: [],
  generatorApp: 'qbl/tools/android',
  fallbackType: 'customtabs',
  enableSiteSettingsShortcut: true,
  minSdkVersion: app.minSdkVersion,
  fingerprints: [],
});
try {
  await new TwaGenerator().createTwaProject(project, manifest, new ConsoleLog('twa'));
} finally {
  server.close();
}

// 3. Build: an unsigned APK and an unsigned bundle (AAB).
const gradleEnv = { ...env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
writeFileSync(join(project, 'local.properties'), `sdk.dir=${sdk}\n`);
run(join(project, 'gradlew'), ['--no-daemon', '-q', 'assembleRelease', 'bundleRelease'], { cwd: project, env: gradleEnv });

// 4. Align and sign.
const name = `questlab-${versionName}`;
const apk = join(dist, `${name}.apk`);
const aab = join(dist, `${name}.aab`);
const aligned = join(work, 'aligned.apk');
run(join(buildTools, 'zipalign'), ['-f', '-p', '4', join(project, 'app/build/outputs/apk/release/app-release-unsigned.apk'), aligned]);
run(join(buildTools, 'apksigner'), ['sign', '--ks', keystore, '--ks-key-alias', alias, '--ks-pass', 'env:QBL_KS_PASS',
  '--key-pass', 'env:QBL_KEY_PASS', '--out', apk, aligned], { env: secrets });
run(join(buildTools, 'apksigner'), ['verify', apk]);
copyFileSync(join(project, 'app/build/outputs/bundle/release/app-release.aab'), aab);
run('jarsigner', ['-keystore', keystore, '-storepass:env', 'QBL_KS_PASS', '-keypass:env', 'QBL_KEY_PASS',
  '-sigalg', 'SHA256withRSA', '-digestalg', 'SHA-256', aab, alias], { env: secrets, quiet: true });

// 5. Digital Asset Links: the site vouches for the app. The Play Store re-signs apps with its own
//    key ("Play App Signing"): add that key's SHA-256 (Play Console → App integrity) to app.json's
//    "extraFingerprints" and rebuild, or the Play copy shows the address bar.
const fingerprints = [fingerprint, ...(app.extraFingerprints ?? [])];
const links = [{
  relation: ['delegate_permission/common.handle_all_urls'],
  target: { namespace: 'android_app', package_name: app.packageId, sha256_cert_fingerprints: fingerprints },
}];
const wellKnown = join(repo, 'apps/client/public/.well-known');
mkdirSync(wellKnown, { recursive: true });
writeFileSync(join(wellKnown, 'assetlinks.json'), `${JSON.stringify(links, null, 2)}\n`);

console.log(`
Built ${app.name} ${versionName} (${versionCode}) for https://${host}${app.startUrl}
  ${apk}
  ${aab}
  apps/client/public/.well-known/assetlinks.json (key ${fingerprint})
The site must serve https://${host}/.well-known/assetlinks.json for the app to open without an address bar.`);
// Bubblewrap's HTTP/2 client keeps Node running otherwise.
process.exit(0);

function run(cmd, args, { cwd, env: e = env, quiet = false } = {}) {
  try {
    return execFileSync(cmd, args, { cwd, env: e, encoding: 'utf8', stdio: quiet ? 'pipe' : ['ignore', 'pipe', 'inherit'] });
  } catch (err) {
    fail(`${cmd.split('/').pop()} failed${err.stdout ? `:\n${err.stdout}` : ''}`);
  }
}

function fail(message) {
  console.error(`qbl android: ${message}`);
  process.exit(1);
}
