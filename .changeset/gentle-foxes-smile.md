---
"@savvy-web/vitest": patch
---

## Bug Fixes

- Fixed session-start hook silently swallowing errors by converting from plain text stdout output to structured JSON `hookSpecificOutput.additionalContext` response with error trap and environment variable validation
