# Seed data

A tiny example knowledge base used by `npm run seed`. The seed CLI ingests the
Markdown and text files here into the `default` namespace so you can verify the
pipeline before connecting real documents.

Files:
- `faq.md` — a support FAQ (Markdown headings exercise the heading-aware chunker)
- `returns-policy.md` — a policy document
- `company.txt` — a plain-text overview

A sample PDF and a live webpage are intentionally not bundled (binary / network).
To exercise those loaders, point the ingest CLI at your own:

```bash
npm run ingest -- --source ./my.pdf --type pdf --namespace default
npm run ingest -- --source https://example.com/docs --type url --namespace default
```
