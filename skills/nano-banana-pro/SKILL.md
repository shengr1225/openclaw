---
name: nano-banana-pro
description: Experimental image generation with nano-banana-pro.
metadata:
  {
    "openclaw":
      {
        "emoji": "🍌",
        "requires": { "bins": ["python3"] },
        "install":
          [
            {
              "id": "python-brew",
              "kind": "brew",
              "formula": "python",
              "bins": ["python3"],
              "label": "Install Python (brew)",
            },
          ],
      },
  }
---

# nano-banana-pro (Experimental)

This is an experimental skill for the `nano-banana-pro` model.

## Usage

_Script to be created at `{baseDir}/scripts/generate_image.py`_

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "a bunch of bananas programming a computer" --filename "./banana.png"
```

Notes:

- Prefer `uv run` so inline script dependencies (`google-genai`, `pillow`) are auto-resolved.
- If you use `python3` directly, install dependencies first:
  - `uv pip install google-genai pillow`
