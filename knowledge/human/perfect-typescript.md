---
title: Perfect Typescript
description: How to write a perfect typescript code.
---

There is a set of rules that you MUST follow when writing typescript code:

## Code structure
- All sources are in the "sources" folder.

## Code style
- Never use "any" type. Use specific types instead. "unknown" is allowed.

## Testing
- Call tests "*.spec.ts" only.
- Do not use delays - moch time all the time.
- Do not mock anything at all, ever. It is useless.
- If you want to test some external service, use a real service and disable this test later.
- Reduce external service testing to minimum and scoped.