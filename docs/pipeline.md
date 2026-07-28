# The DEX Ten-Stage Verification Pipeline

Every part search — single link or batch report — runs through ten stages.
Stages 1–5 establish *what* the part is; stages 6–10 establish *who really
sells it and at what price*. AI assists at four points, always grounded:
it can only use identifiers and facts that literally appear in source
material, and every AI step fails open to deterministic logic.

| # | Stage | What happens | AI involvement |
|---|-------|--------------|----------------|
| 1 | **Intake** | Input accepted: product URL, part number, or messy pasted list. Pasted lists are parsed deterministically (SupplyItNow rows, spreadsheets, comma lists). | AI parses unrecognized paste formats; part numbers must appear verbatim in the paste. |
| 2 | **Validate** | URL safety (SSRF guards, public-host checks), rate limits, budget assignment. | — |
| 3 | **Read source** | HTTP-first fetch of the product page with redirects, size and time limits; snapshot stored (temp-dir fallback on serverless). | — |
| 4 | **Extract identity** | JSON-LD, microdata, OpenGraph, labeled fields, and URL-path evidence collected and scored. | — |
| 5 | **Identify part** | Deterministic MPN selection with confidence gate. Fallbacks in order: grounded AI identification (result must appear in page text), then the page's own structured product title. | AI identification, grounded and verified against the page. |
| 6 | **Search worldwide** | Supplier-knowledge suggestions plus quoted web searches using the human-readable part text; low-value domains (social, Q&A, blogs, travel) filtered. | — |
| 7 | **Extract offers** | Each candidate page fetched and parsed: structured-first pricing (JSON-LD → meta tags → filtered CSS), currency detection with ISO whitelist, stock/availability rules, substitute/accessory rejection. | — |
| 8 | **AI verify** | Borderline (non-structured) matches get a strict AI second opinion with procurement domain knowledge: accessories, substitutes, variants, and mention-only pages are rejected with reasons recorded. | AI vendor verdict; fails open. |
| 9 | **Normalize prices** | Currency conversion to USD (live FX), per-supplier dedupe, median-based price-outlier flagging, category price-band sanity. | — |
| 10 | **Rank & audit** | Final ranking (match strength, then price), AI price audit and part description synthesis, knowledge-base update for future searches. | AI writes the professional part description and flags implausible prices/counterfeit-risk sellers. |

## The domain-knowledge layer

All AI calls are primed with `packages/ai/src/knowledge.ts`:

- **Manufacturer identity resolution** — ~75 canonical manufacturers with
  aliases, abbreviations, and acquisition history (TI/National, HP/Compaq/HPE,
  TE/Tyco/AMP/Crompton, ABB/Baldor, Rockwell/Allen-Bradley, …). Also used
  deterministically when comparing a vendor page's brand to the target part.
- **Catalog shorthand dictionary** — ~90 abbreviations (ASSY, BZL, PWA, RCPT,
  XFMR, VFD, NOS, …) so cryptic catalog rows become readable descriptions.
- **Part-category taxonomy** — 10 categories (passives, semiconductors,
  connectors, breakers/electrical, drives/inverters, wind/renewable,
  IT hardware, medical, electromechanical, single-board computers) each with
  typical USD price bands and category-specific verification notes.
- **Counterfeit/risk heuristics** — the signals the AI is told to hunt for
  when auditing prices and sellers.

## Failure philosophy

- A **missing** value always beats a **wrong** value (prices, MPNs, stock).
- Every AI step **fails open** to the deterministic decision; an AI outage
  can never blank a report.
- Every stage failure is recorded on the job with a human-readable reason
  and shown in the activity log — no silent failures.
