# DEX Global Sourcing Assistant

AI-powered **best-effort worldwide supplier discovery** for DEX purchasing teams.

## Primary UX

1. Paste a **public product-page URL**  
2. Click **Find Suppliers**  
3. See the identified manufacturer + exact MPN and about **10** supplier options  

Users do not need to type an MPN or other product fields.

## Architecture

**Version 1.2 (amended — awaiting implementation approval):**

- [docs/architecture.md](docs/architecture.md)  
- [docs/packages.md](docs/packages.md)  
- [docs/agent-guidelines.md](docs/agent-guidelines.md)  
- [docs/adr/0001-url-first-product-page-workflow.md](docs/adr/0001-url-first-product-page-workflow.md)  

## Status

Foundation MVP exists for an older SupplyItNow/MPN workflow. **Do not extend that workflow.** After v1.2 approval, refactor to URL-first resolve + safe arbitrary-URL fetching.

## Secrets

| Concern | Provider | Env |
|---------|----------|-----|
| Web search | Tavily | `TAVILY_API_KEY` |
| AI enrichment | OpenAI | `OPENAI_API_KEY`, `AI_ENABLED` |

Never commit `.env`.
