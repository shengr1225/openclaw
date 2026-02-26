import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { describe, expect, it } from "vitest";
import { isTruthyEnvValue } from "../infra/env.js";

// Live script tests often run directly via Vitest and may not inherit CLI dotenv loading.
// Use .env.local as test source-of-truth so placeholder shell env values do not shadow it.
dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: true, quiet: true });

function commandExists(command: string): boolean {
  const res = spawnSync(command, ["--version"], { stdio: "ignore" });
  return res.status === 0;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

const LIVE = isTruthyEnvValue(process.env.LIVE) || isTruthyEnvValue(process.env.OPENCLAW_LIVE_TEST);
const hasBash = commandExists("bash");
const hasPython3 = commandExists("python3");
const hasUv = commandExists("uv");
const hasGog = commandExists("gog");
const GOG_ACCOUNT = process.env.GOG_ACCOUNT ?? "";
const GOG_LIVE_FILE_ID = process.env.OPENCLAW_LIVE_GDRIVE_FILE_ID ?? "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const LIVE_INPUT_IMAGE =
  process.env.OPENCLAW_LIVE_TEST_IMAGE ?? "/Users/mingmin/.openclaw/workspace-duoduo/test.jpg";
const hasLiveInputImage = existsSync(LIVE_INPUT_IMAGE);
const looksLikeGeminiApiKey = /^AIza[0-9A-Za-z_-]{20,}$/.test(GEMINI_API_KEY);

const gogSkipReasons: string[] = [];
if (!LIVE) {
  gogSkipReasons.push("LIVE/OPENCLAW_LIVE_TEST not enabled");
}
if (!hasBash) {
  gogSkipReasons.push("bash not found");
}
if (!hasGog) {
  gogSkipReasons.push("gog not found");
}
if (!GOG_ACCOUNT) {
  gogSkipReasons.push("GOG_ACCOUNT missing");
}
if (!GOG_LIVE_FILE_ID) {
  gogSkipReasons.push("OPENCLAW_LIVE_GDRIVE_FILE_ID missing");
}

const nanoSkipReasons: string[] = [];
if (!LIVE) {
  nanoSkipReasons.push("LIVE/OPENCLAW_LIVE_TEST not enabled");
}
if (!hasUv) {
  nanoSkipReasons.push("uv not found");
}
if (!hasPython3) {
  nanoSkipReasons.push("python3 not found");
}
if (!GEMINI_API_KEY) {
  nanoSkipReasons.push("GEMINI_API_KEY missing");
} else if (!looksLikeGeminiApiKey) {
  nanoSkipReasons.push("GEMINI_API_KEY does not look like AIza... key");
}
if (!hasLiveInputImage) {
  nanoSkipReasons.push(`input image missing: ${LIVE_INPUT_IMAGE}`);
}

const gogReady = gogSkipReasons.length === 0;
const nanoReady = nanoSkipReasons.length === 0;
const label = (base: string, reasons: string[]) =>
  reasons.length === 0 ? base : `${base} [skip reasons: ${reasons.join("; ")}]`;

describe("error remediation scripts (live)", () => {
  it(label("live gate diagnostics", []), () => {
    console.info(
      [
        `[live] enabled=${LIVE}`,
        `[live] gogReady=${gogReady}${gogReady ? "" : ` | reasons=${gogSkipReasons.join("; ")}`}`,
        `[live] nanoReady=${nanoReady}${nanoReady ? "" : ` | reasons=${nanoSkipReasons.join("; ")}`}`,
      ].join("\n"),
    );
    expect(true).toBe(true);
  });

  it.skipIf(!gogReady)(
    label(
      "runs gog-drive-download-safe.sh and successfully downloads a real Drive file",
      gogSkipReasons,
    ),
    async () => {
      const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gog-download-live-"));
      const outPath = path.join(outDir, "gog-live-download.bin");
      const scriptPath = path.join(process.cwd(), "scripts", "gog-drive-download-safe.sh");
      const result = run(
        "bash",
        [
          scriptPath,
          GOG_LIVE_FILE_ID,
          "--account",
          GOG_ACCOUNT,
          "--out",
          outPath,
          "--allow-large",
          "--timeout-sec",
          "900",
        ],
        {
          ...process.env,
          GOG_ACCOUNT,
        },
      );

      const detail = `exit=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
      expect(result.status, detail).toBe(0);
      const stat = await fs.stat(outPath);
      expect(stat.size).toBeGreaterThan(0);
      expect(result.stdout).toMatch(/success: downloaded to/i);
    },
    120_000,
  );

  it.skipIf(!nanoReady)(
    label("runs nano-banana-pro generate_image.py end-to-end with real Gemini API", nanoSkipReasons),
    async () => {
      const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-nano-banana-live-"));
      const outPath = path.join(outDir, "banana-live.png");
      const scriptPath = path.join(
        process.cwd(),
        "skills",
        "nano-banana-pro",
        "scripts",
        "generate_image.py",
      );

      const result = run(
        "uv",
        [
          "run",
          scriptPath,
          "--prompt",
          "A small banana icon on white background, minimal style.",
          "--filename",
          outPath,
          "--input-image",
          LIVE_INPUT_IMAGE,
          "--api-key",
          GEMINI_API_KEY,
        ],
        process.env,
      );

      const detail = `exit=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
      if (result.stderr.includes("API_KEY_INVALID")) {
        throw new Error(
          `Gemini API key is invalid for this live test.\n` +
            `- Ensure GEMINI_API_KEY is a valid AI Studio key (not OAuth client secret JSON values).\n` +
            `- Verify the Generative Language API key is active for your project.\n\n` +
            detail,
        );
      }
      expect(result.status, detail).toBe(0);
      expect(result.stdout).toContain("Image saved:");
      const stat = await fs.stat(outPath);
      expect(stat.size).toBeGreaterThan(0);
    },
    90_000,
  );
});
