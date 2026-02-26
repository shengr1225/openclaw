import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { toToolDefinitions } from "./pi-tool-definition-adapter.js";

type ToolExecute = ReturnType<typeof toToolDefinitions>[number]["execute"];
const extensionContext = {} as Parameters<ToolExecute>[4];

async function executeThrowingTool(name: string, callId: string) {
  const tool = {
    name,
    label: name === "bash" ? "Bash" : "Boom",
    description: "throws",
    parameters: Type.Object({}),
    execute: async () => {
      throw new Error("nope");
    },
  } satisfies AgentTool;

  const defs = toToolDefinitions([tool]);
  const def = defs[0];
  if (!def) {
    throw new Error("missing tool definition");
  }
  return await def.execute(callId, {}, undefined, undefined, extensionContext);
}

describe("pi tool definition adapter", () => {
  it("wraps tool errors into a tool result", async () => {
    const result = await executeThrowingTool("boom", "call1");

    expect(result.details).toMatchObject({
      status: "error",
      tool: "boom",
    });
    expect(result.details).toMatchObject({ error: "nope" });
    expect(JSON.stringify(result.details)).not.toContain("\n    at ");
  });

  it("unwraps misleading Can't reach... when inner error is application-level", async () => {
    const wrapped =
      "Can't reach the openclaw browser control service. Start (or restart) the OpenClaw gateway. (Error: fields are required)";
    const tool = {
      name: "browser",
      label: "Browser",
      description: "throws",
      parameters: {},
      execute: async () => {
        throw new Error(wrapped);
      },
    } satisfies AgentTool<unknown, unknown>;

    const defs = toToolDefinitions([tool]);
    const result = await defs[0].execute("call1", {}, undefined, undefined);

    expect(result.details).toMatchObject({
      status: "error",
      tool: "browser",
      error: "fields are required",
    });
  });

  it("normalizes exec tool aliases in error results", async () => {
    const result = await executeThrowingTool("bash", "call2");

    expect(result.details).toMatchObject({
      status: "error",
      tool: "exec",
      error: "nope",
    });
  });

  it("adds guidance when edit fails with exact-text mismatch", async () => {
    const tool = {
      name: "edit",
      label: "Edit",
      description: "throws exact-text mismatch",
      parameters: Type.Object({}),
      execute: async () => {
        throw new Error("Could not find exact text in file");
      },
    } satisfies AgentTool;

    const defs = toToolDefinitions([tool]);
    const def = defs[0];
    if (!def) {
      throw new Error("missing tool definition");
    }
    const result = await def.execute("call3", {}, undefined, undefined, extensionContext);

    expect(result.details).toMatchObject({
      status: "error",
      tool: "edit",
    });
    expect((result.details as { error?: string }).error).toMatch(/Could not find exact text/i);
    expect((result.details as { error?: string }).error).toMatch(
      /copy exact oldText \(including whitespace\/newlines\)/i,
    );
  });

  it("adds retry guidance for missing edit parameters from upstream errors", async () => {
    const tool = {
      name: "edit",
      label: "Edit",
      description: "throws missing parameter",
      parameters: Type.Object({}),
      execute: async () => {
        throw new Error("Missing required parameter: oldText");
      },
    } satisfies AgentTool;

    const defs = toToolDefinitions([tool]);
    const def = defs[0];
    if (!def) {
      throw new Error("missing tool definition");
    }
    const result = await def.execute("call4", {}, undefined, undefined, extensionContext);

    expect(result.details).toMatchObject({
      status: "error",
      tool: "edit",
      error: "Missing required parameter: oldText. Supply correct parameters before retrying.",
    });
  });
});
