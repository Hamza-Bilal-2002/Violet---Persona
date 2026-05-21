# Anti-Fabrication Checklist

Self-check rules the translator runs against its own output.

Adapted from [senshinji/claude-translation-skill](https://github.com/senshinji/claude-translation-skill)
([LobeHub listing](https://lobehub.com/skills/senshinji-claude-translation-skill)).

## Severity priority

When issues overlap, fix in this order:

1. **FABRICATION** -- content invented that does not exist in the source
2. **OMISSION** -- content in the source that was dropped from the translation
3. **TERMINOLOGY** -- inconsistent or incorrect term usage
4. **ACCURACY** -- meaning shifted, nuance lost, or claim altered
5. **STRUCTURE** -- formatting, heading levels, or layout diverged
6. **REGISTER** -- tone or formality level wrong for the context

---

## Prevention (before writing)

1. Read the entire source before translating any part. Understand the
   full context before starting.
2. Translate paragraph by paragraph in source order. Do not rearrange.
3. When a sentence is hard to translate, simplify the expression in the
   target language. Do not add explanatory text that was not in the source.
4. Statistics, dates, prices, version numbers, percentages: copy exactly.
   Do not round, convert, or "update" them.
5. If unsure about a technical term, keep the English term rather than
   guessing a translation.

## Detection (self-check after writing)

Run these checks against your own output:

### Content count check
- Count headings in source vs translation. Must match.
- Count list items in source vs translation. Must match.
- Count table rows in source vs translation. Must match.
- Count paragraphs in source vs translation. Should be close (minor
  sentence restructuring is OK; adding or removing whole paragraphs is not).

### Factual integrity check
- Every number in the source appears in the translation (same value).
- Every company/product/person name in the source appears in the translation
  (same spelling).
- Every URL in the source appears in the translation (byte-identical).
- Every technical specification (e.g., "600ms latency", "$0.14/min") is
  preserved exactly.

### Red flags (if you catch yourself doing any of these, stop and fix)
- Adding a sentence that explains something the source left implicit
- Adding a bullet point to a list that had fewer items in the source
- Splitting one source paragraph into multiple translated paragraphs
  without good cause
- "Improving" the source by adding claims, benefits, or qualifiers
- Translating a brand name, product name, or proper noun
- Changing a URL to point to a localized version (routing handles this)
- Rounding a number ("approximately 300M" when the source says "300M")

### Structure check
- Heading levels (`##`, `###`) match source exactly
- Table column count matches source
- Code blocks are untouched (not translated)
- Frontmatter non-text fields are byte-identical to source
- Markdown link syntax is intact: `[translated text](unchanged-url)`
