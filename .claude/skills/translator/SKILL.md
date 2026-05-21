---
name: translator
description: "Translate JSON dictionaries and MDX content files between locales with structural integrity, SEO/GEO-aware keyword adaptation, and native-quality output. Use when translating UI strings, blog posts, service pages, or any locale-specific content."
---

# Translator

Translate web content between locales. Every translation must read like it
was originally written in the target language while preserving exact file
structure.

## Project context

- **Framework**: `i18next` (planned — not yet integrated)
- **Content pipeline**: JSON dictionaries loaded at runtime by the avatar UI; no MDX content pipeline today. MDX rules below apply only if/when long-form copy is introduced.
- **Locales**: `en` (source), `de` (planned)
- **Dictionaries**: `frontend/src/locales/{locale}.json` (planned path — adjust when the i18n module lands)
- **Content files**: Not applicable — this project has no MDX content today

---

## 1. JSON dictionary translation

### Structure rules

Dictionaries are nested JSON objects. Keys are typically camelCase.

```
{
  "section": {
    "subsection": {
      "label": "Translate this value",
      "heading": "And this one"
    }
  }
}
```

**Preserve exactly:**
- Every key name (never translate keys)
- Nesting structure and depth
- Array length and index ordering
- Object property ordering (match source file order)
- Value types (string stays string, array stays array)

**Translate:**
- All string leaf values that contain human-readable text

**Do NOT translate:**
- Keys (ever)
- URLs in values (e.g., `"href": "/audit"`, `"href": "https://..."`)
- Brand names (define in project context or terminology glossary)
- Statistical values that appear as strings (e.g., `"value": "44%"`)

**If the source has interpolation variables** (`{{variable}}` or `{variable}`),
preserve them exactly in the translated string. Do not translate variable names.

### Validation

After translating dictionary files:

```bash
python .claude/scripts/validate-json-structure.py <original.json> <translated.json>
```

For batch locale parity checks:

```bash
python .claude/scripts/dictionary-diff.py --source en --target de --dir dictionaries
```

---

## 2. MDX content translation

### Frontmatter rules

MDX files use YAML frontmatter. Fields fall into two categories:

**Translate these text fields:**

| Field | Notes |
|-------|-------|
| `title` | Optimize for target-language search intent (see section 3) |
| `description` | Optimize for target-language search intent |
| `summary` | Natural adaptation, not word-for-word |
| `tagline` | Short, punchy — adapt to target language rhythm |

**Do NOT translate metadata fields (copy byte-identical):**

Date fields, author, image paths, tags, status, technical metadata,
ordering fields, category slugs, URLs, and any field whose value is
a machine-readable identifier rather than human-readable text.

### Body rules

**Translate:**
- All prose paragraphs
- Heading text (preserve heading level: `##` stays `##`)
- Table cell content (preserve table structure)
- List item text
- Image alt text if present
- Link text (the visible part in `[text](url)`)

**Do NOT translate:**
- URLs in links: `[translated text](original-url-unchanged)`
- Code blocks (inline or fenced)
- HTML entities or tags if present
- Markdown syntax characters (`#`, `|`, `-`, `*`, `>`)

### Validation

```bash
python .claude/scripts/validate-mdx-structure.py <original.mdx> <translated.mdx>
```

---

## 3. SEO/GEO-aware translation

Do not mechanically translate keywords. Optimize for how the target audience
actually searches.

**Title and description optimization:**
- Research what the target-language audience searches for
- Keep the same search intent but use natural target-language phrasing
- Include the primary target-language keyword naturally in the title
- Description should be compelling in the target language, not a calque

**Structured content preservation (for AI engine citability):**
- Preserve heading hierarchy exactly (H2, H3 nesting)
- Preserve list structures (enumerated/bulleted content is cited more often)
- Preserve table structure and column alignment
- Preserve the overall content architecture (section count, section ordering)

**Internal linking:**
- Link URLs stay unchanged (routing handles locale prefixing automatically)
- Link text translates naturally

---

## 4. Quality standard

### The bar

A native speaker of the target language should read the content and not
suspect it was translated. No translationese. No awkward calques.
No word-for-word mirroring of source language sentence structure.

### What good translation looks like

- **Restructure sentences** for natural target-language flow. Different
  languages have different word order conventions — respect them.
- **Adapt idioms and examples**. Find the equivalent expression or
  rewrite the thought.
- **Match register**. If the source is casual and direct, the translation
  should feel casual and direct in the target language.
- **Preserve tone**. The translation must carry the same personality as
  the source.

### Anti-fabrication rules

1. **Never invent content** not present in the source. If the source says
   three benefits, the translation has three benefits. Not four.
2. **Never omit content** present in the source. Every paragraph, heading,
   list item, and table row must appear in the translation.
3. **Never change factual claims**. Statistics, pricing, dates, company names,
   product names, technical specifications — these transfer exactly.
4. **Never alter URLs**. Not even "fixing" a URL that looks wrong.

### Terminology consistency

Use consistent terminology across all files for the same locale. Do not
translate a term one way in one section and another way elsewhere.

If the project has a terminology glossary (`references/terminology-glossary.md`),
follow it. If not, document terminology decisions in the translation report.

---

## 5. Language-specific rules

Each locale can have its own reference file at `references/i18n-{code}.md`
containing register, grammar rules, terminology table, and brand names.

**Before translating, check for `references/i18n-{locale}.md`** for the
target locale. If no file exists, create one and document all decisions.

When creating a new locale reference, determine:

1. Register (formal/informal) based on context
2. Which technical terms the target industry keeps in the source language
3. Script or directionality requirements (RTL for Arabic, etc.)
4. Cultural adaptations (date formats, number separators, etc.)

---

## 6. Workflow

1. **Read the source file(s).**
2. **Determine content type** (JSON or MDX) and apply the corresponding rules.
3. **Translate** following quality standards and anti-fabrication rules.
4. **Write output** to the matching path in the target locale directory.
5. **Validate structure** using the appropriate validation script.
6. **If validation fails**, fix the issues and re-run until PASS.
7. **Report** what was translated, any terminology decisions made, and any
   content that needs native speaker review.

---

## References

- [solberg.is/i18n-subagent](https://www.solberg.is/i18n-subagent) — i18n specialist subagent pattern
- [senshinji/claude-translation-skill](https://github.com/senshinji/claude-translation-skill) — Multi-agent translation pipeline; anti-fabrication checklist concepts adapted from here
