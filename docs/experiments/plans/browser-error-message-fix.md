# Plan: Fix Misleading Browser Error Messages

## Problem

The browser tool always surfaces a generic error: _"Can't reach the openclaw browser control service. Start (or restart) the OpenClaw gateway..."_ — even when the service **was** reached and returned an application-level error. This masks the real cause and gives incorrect remediation guidance.

### Error Categories (from session logs)

| Actual Cause                                                 | Generic Wrapper | Correct Remediation                               |
| ------------------------------------------------------------ | --------------- | ------------------------------------------------- |
| `Element "e107" not found or not visible`                    | Can't reach...  | Run a new snapshot; use a ref from that snapshot  |
| `Chrome extension relay is running, but no tab is connected` | Can't reach...  | Click the OpenClaw Chrome extension icon on a tab |
| `fields are required`                                        | Can't reach...  | Fix the tool request (validation error)           |
| `Failed to start Chrome CDP on port 18800`                   | Can't reach...  | Restart gateway; check port conflicts             |
| `timed out after 20000ms`                                    | Can't reach...  | May be connectivity or overload; restart gateway  |
| `Unknown ref "e3"`                                           | Can't reach...  | Run a new snapshot; use valid ref                 |
| `request required`                                           | Can't reach...  | Fix the tool request                              |

### Root Cause

In `src/browser/client-fetch.ts`, `fetchBrowserJson` wraps **all** caught errors with `enhanceBrowserFetchError()`, which always produces the "Can't reach..." message. This happens for:

1. **Local dispatcher path**: Dispatcher returns 4xx/5xx → we `throw new Error(message)` → catch wraps it.
2. **Remote fetch path** (`fetchHttpJson`): HTTP 4xx/5xx → we `throw new Error(text)` → catch wraps it.
3. **True connectivity failures**: Timeout, ECONNREFUSED, abort → correct to wrap.

Only (3) should use "Can't reach...". For (1) and (2), the service was reached and returned an error — the actual message should be primary.

---

## Proposed Solution

### 1. Introduce an ApplicationError Marker

Create a sentinel error class so we can detect "service was reached, error came from response":

```ts
// src/browser/client-fetch.ts
export class BrowserApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserApplicationError";
  }
}
```

### 2. Throw ApplicationError for HTTP/Response Errors

**Local dispatcher** (line 142–148): when `result.status >= 400`, throw `BrowserApplicationError` instead of `Error`:

```ts
if (result.status >= 400) {
  const message = ...;
  throw new BrowserApplicationError(message);
}
```

**Remote fetch** (`fetchHttpJson`): when `!res.ok`, throw `BrowserApplicationError` instead of `Error`:

```ts
if (!res.ok) {
  const text = await res.text().catch(() => "");
  throw new BrowserApplicationError(text || `HTTP ${res.status}`);
}
```

### 3. Skip Wrapping in `enhanceBrowserFetchError`

In the catch block, rethrow application errors without wrapping:

```ts
} catch (err) {
  if (err instanceof BrowserApplicationError) {
    throw err;
  }
  throw enhanceBrowserFetchError(url, err, timeoutMs);
}
```

### 4. Optional: Add Context-Specific Hints for Application Errors

For application errors, we can optionally add a short hint based on the message (only when it helps, not as the main text):

- `Element "..." not found` / `Unknown ref "..."` → hint: "Run a new snapshot to get current page refs."
- `Chrome extension relay is running, but no tab is connected` → hint: "Click the OpenClaw Chrome extension icon on a tab to attach it."
- `fields are required` / `ref is required` → no extra hint (validation error is self-explanatory).

This can be a follow-up; the primary fix is surfacing the real message.

---

## Implementation Checklist

- [x] Add `BrowserApplicationError` class in `client-fetch.ts` (export if needed elsewhere).
- [x] In local dispatcher path: `throw new BrowserApplicationError(message)` when status >= 400.
- [x] In `fetchHttpJson`: `throw new BrowserApplicationError(...)` when !res.ok.
- [x] In catch block: rethrow `BrowserApplicationError` without wrapping.
- [x] Update `client.test.ts`: "surfaces non-2xx responses with body text" — expect primary message to be the body text, not "Can't reach...".
- [x] Run `pnpm test` for `src/browser/client.test.ts` — all pass.
- [ ] Manually verify: element-not-found, extension-not-attached, and timeout errors show the right primary message.

---

## Debugging Tips

When investigating similar issues:

1. **Check the nested error** in logs: `(Error: ...)` after "Can't reach" often contains the real cause.
2. **Trace the path**: `fetchBrowserJson` → local dispatcher vs remote fetch. Local uses `createBrowserRouteDispatcher`; remote uses `fetch` with absolute URL.
3. **Session logs**: `~/.openclaw/agents/<agentId>/sessions/*.jsonl` — `toolResult` with `toolName: "browser"` and `status: "error"` show the full error string.

---

## Related Files

- `src/browser/client-fetch.ts` — main fix location
- `src/browser/client-actions-core.ts`, `client-actions-observe.ts`, `client-actions-state.ts` — call `fetchBrowserJson`
- `src/agents/tools/browser-tool.ts` — surfaces errors to the agent
- `docs/tools/browser.md` — user-facing docs; update troubleshooting if needed

---

## Out of Scope (for this plan)

- Errors from `exec`, `sessions_send`, `message`, `gateway` tools (different code paths).
- Changing error aggregation/classification in log analysis scripts.
- Improvements to `handleRouteError` or route-level error mapping (separate effort).
