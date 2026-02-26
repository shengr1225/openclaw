import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

function commandExists(command: string): boolean {
  const res = spawnSync(command, ["--version"], { stdio: "ignore" });
  return res.status === 0;
}

function runBashScript(
  scriptPath: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof spawnSync> {
  return spawnSync("bash", [scriptPath, ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

describe("error remediation scripts (integration)", () => {
  const hasBash = commandExists("bash");
  const hasGog = commandExists("gog");
  const hasPython3 = commandExists("python3");
  const canRunGogScript = hasBash && hasGog && hasPython3;

  it.skipIf(!canRunGogScript)("fails fast for wildcard-like Drive file IDs in real script execution", () => {
    const scriptPath = path.join(process.cwd(), "scripts", "gog-drive-download-safe.sh");
    const result = runBashScript(scriptPath, ["*.jpg"], process.env);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("wildcard pattern");
    expect(result.stderr).toContain("not a glob like '*.jpg'");
  });

  it.skipIf(!canRunGogScript)(
    "shows metadata preflight error from real gog invocation when ID cannot be resolved",
    () => {
    const scriptPath = path.join(process.cwd(), "scripts", "gog-drive-download-safe.sh");
    const result = runBashScript(scriptPath, ["1AbCdEfGhIj", "--account", "you@example.com"], {
      ...process.env,
      GOG_ACCOUNT: "you@example.com",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("failed to fetch Drive metadata");
    expect(result.stderr).toContain("verify the file exists");
    },
  );

  it.skipIf(!hasPython3)(
    "shows actionable dependency guidance for nano-banana script in isolated Python mode",
    () => {
      const scriptPath = path.join(
        process.cwd(),
        "skills",
        "nano-banana-pro",
        "scripts",
        "generate_image.py",
      );
      const result = spawnSync(
        "python3",
        ["-S", scriptPath, "--prompt", "test", "--filename", "/tmp/out.png", "--api-key", "x"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: process.env,
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Missing Python dependency 'google-genai'");
      expect(result.stderr).toContain("uv pip install google-genai pillow");
    },
  );

  it("documents uv-based nano-banana usage with explicit output filename", async () => {
    const skillPath = path.join(process.cwd(), "skills", "nano-banana-pro", "SKILL.md");
    const content = await readFile(skillPath, "utf8");
    expect(content).toContain("uv run {baseDir}/scripts/generate_image.py");
    expect(content).toContain("--filename");
  });
});
