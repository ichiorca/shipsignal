---
name: customer-email-format
version: 1.0.0
owner: marketing
status: active
evolvable: true
---

# Customer Email Format

Produce a customer-facing release announcement email in Markdown:

1. A subject line as an `#` H1: benefit-first, under 60 characters, no clickbait.
2. A one-sentence opener stating what shipped and who it helps.
3. 2-4 short sections (`##` per feature): what it does, the customer benefit, and how to
   find it in the product. Plain sentences, second person ("you can now…").
4. A single clear call to action (try the feature, read the docs) — one link, not many.
5. A one-line sign-off. No legal footer, unsubscribe text, or sender details — the email
   platform owns those.

Keep it under 250 words. No metrics, percentages, customer names, pricing, or availability
dates unless they appear in the approved features. No internal codenames.
