# Architecture amendment v1.2 — URL-first sourcing

## Decision

Replace SupplyItNow-or-MPN input with **arbitrary public product-page URL** as the only required user input. Automate MPN identification with evidence + confidence gating, then best-effort worldwide supplier discovery returning ~10 useful results.

## Consequences

- Security model shifts from host allowlist to DNS/IP/redirect/resource isolation  
- Resolve becomes a first-class multi-step identity pipeline  
- Existing MVP code paths for MPN-first UX and SupplyItNow-only resolve must be refactored before further feature work  
- Docs: `docs/architecture.md` v1.2  

## Status

Accepted and implemented in the URL-first v1.2 codebase.
