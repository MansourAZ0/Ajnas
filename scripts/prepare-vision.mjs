#!/usr/bin/env node
// The ONLY remote request in the vision integration happens here, before app launch.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.10.32";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const MODEL_SHA256 = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public/vision");
const require = createRequire(import.meta.url);
const checkOnly = process.argv.includes("--check");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const readOrNull = async filename => { try { return await readFile(filename); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };

async function main() {
  let packageRoot;
  try { packageRoot = path.dirname(require.resolve("@mediapipe/tasks-vision")); }
  catch { throw new Error(`Install the exact dependency @mediapipe/tasks-vision@${VERSION} before preparing vision assets.`); }
  const metadata = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  if (metadata.version !== VERSION) throw new Error(`Expected MediaPipe ${VERSION}, found ${metadata.version}. Update package and preparation pins together.`);
  const bundle = (await readFile(path.join(packageRoot, "vision_bundle.cjs"), "utf8")).replace(/\/\/# sourceMappingURL=.*$/m, "");
  // Scope CJS exports without introducing a global module/require shim. The vendor
  // WASM loader remains free to use its own classic-worker importScripts path.
  const wrapper = `/* @mediapipe/tasks-vision ${VERSION}; Apache-2.0. Generated, do not edit. */\n(function(exports) {\n${bundle}\n})(self.AjnasMediaPipe = {});\n`;
  const generated = new Map([["vision-classic.js", Buffer.from(wrapper)]]);
  for (const file of ["vision_wasm_internal.js", "vision_wasm_internal.wasm",
    "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
    generated.set(`wasm/${file}`, await readFile(path.join(packageRoot, "wasm", file)));
  }
  generated.set("LICENSE-APACHE.txt", await readFile(path.join(root, "LICENSE-APACHE")));
  generated.set("THIRD_PARTY_NOTICES.md", await readFile(path.join(root, "THIRD_PARTY_NOTICES.md")));
  let model = await readOrNull(path.join(output, "hand_landmarker.task"));
  if (!model || sha256(model) !== MODEL_SHA256) {
    if (checkOnly) throw new Error("Pinned hand model is missing or invalid. Run node scripts/prepare-vision.mjs during build preparation.");
    console.log("Downloading pinned Hand Landmarker model (build preparation only)…");
    const response = await fetch(MODEL_URL, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}. Retry when build-time networking is available.`);
    model = Buffer.from(await response.arrayBuffer());
    if (sha256(model) !== MODEL_SHA256) throw new Error("Model SHA-256 mismatch. Refusing to install unverified model bytes.");
  }
  generated.set("hand_landmarker.task", model);
  const manifest = { mediapipeVersion: VERSION, model: { url: MODEL_URL, sha256: MODEL_SHA256 },
    files: Object.fromEntries([...generated].map(([name, bytes]) => [name, { bytes: bytes.length, sha256: sha256(bytes) }])) };
  generated.set("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  for (const [name, bytes] of generated) {
    const destination = path.join(output, name);
    const existing = await readOrNull(destination);
    if (existing && sha256(existing) === sha256(bytes)) continue;
    if (checkOnly) throw new Error(`Vision asset missing or differs from pinned package: ${name}`);
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    try { await writeFile(temporary, bytes); await rename(temporary, destination); }
    finally { await rm(temporary, { force: true }); }
  }
  console.log(`Vision assets ${checkOnly ? "verified" : "prepared"}: MediaPipe ${VERSION}, model float16/1 (${generated.size - 1} local files).`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
