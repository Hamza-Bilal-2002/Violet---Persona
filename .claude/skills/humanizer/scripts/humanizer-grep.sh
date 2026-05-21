#!/bin/bash
# Mechanical AI pattern detector for humanizer process
# Runs deterministic grep checks against a file for all fully-greppable patterns
# Usage: bash .claude/scripts/humanizer-grep.sh <file>

FILE="$1"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: bash .claude/scripts/humanizer-grep.sh <file>"
  exit 1
fi

# Create a sanitized copy that blanks out URL targets and frontmatter URL fields
# so patterns inside slugs (e.g. "self-hosted" in /services/self-hosted-ai) don't
# trigger false positives. Line numbers are preserved for accurate reporting.
SCANFILE=$(mktemp)
sed -E \
  -e 's|\]\([^)]*\)|](___URL___)|g' \
  -e 's|^(parent|image|icon):.*|\1: ___URL___|' \
  -e 's|^tags:.*|tags: ___TAGS___|' \
  "$FILE" > "$SCANFILE"
trap "rm -f '$SCANFILE'" EXIT

FOUND=0
echo "=== HUMANIZER MECHANICAL SCAN: $(basename "$FILE") ==="
echo ""

# Pattern 7: AI vocabulary
echo "--- #7 AI Vocabulary ---"
for word in "Additionally" "delve" "foster" "garner" "interplay" "intricate" "pivotal" "showcase" "tapestry" "testament" "underscore" "vibrant" "landscape" "crucial" "enhance" "enduring" "leverage" "empower" "harness" "seamless" "robust" "holistic" "synergy"; do
  COUNT=$(grep -oi "$word" "$SCANFILE" 2>/dev/null | wc -l)
  if [ "$COUNT" -gt 0 ]; then
    echo "  FOUND: \"$word\" x$COUNT"
    grep -in "$word" "$SCANFILE" 2>/dev/null | head -5
    FOUND=$((FOUND + COUNT))
  fi
done

# Pattern 8: Copula avoidance
echo "--- #8 Copula Avoidance ---"
for phrase in "serves as" "stands as" "boasts a" "features a" "offers a"; do
  COUNT=$(grep -oi "$phrase" "$SCANFILE" 2>/dev/null | wc -l)
  if [ "$COUNT" -gt 0 ]; then
    echo "  FOUND: \"$phrase\" x$COUNT"
    grep -in "$phrase" "$SCANFILE" 2>/dev/null | head -5
    FOUND=$((FOUND + COUNT))
  fi
done

# Pattern 9: Negative parallelisms
echo "--- #9 Negative Parallelisms ---"
for phrase in "not just" "not only" "not merely" "it's not about"; do
  COUNT=$(grep -oi "$phrase" "$SCANFILE" 2>/dev/null | wc -l)
  if [ "$COUNT" -gt 0 ]; then
    echo "  FOUND: \"$phrase\" x$COUNT"
    grep -in "$phrase" "$SCANFILE" 2>/dev/null | head -5
    FOUND=$((FOUND + COUNT))
  fi
done

# Pattern 13: Em dashes
echo "--- #13 Em Dashes ---"
COUNT=$(grep -o "—" "$SCANFILE" 2>/dev/null | wc -l)
if [ "$COUNT" -gt 0 ]; then
  echo "  FOUND: em dash (—) x$COUNT"
  grep -n "—" "$SCANFILE" 2>/dev/null
  FOUND=$((FOUND + COUNT))
fi

# Pattern 17: Emojis (common unicode ranges)
echo "--- #17 Emojis ---"
COUNT=$(grep -oP '[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}\x{FE00}-\x{FE0F}\x{1F000}-\x{1F02F}\x{1F0A0}-\x{1F0FF}\x{200D}\x{20E3}\x{E0020}-\x{E007F}]' "$SCANFILE" 2>/dev/null | wc -l)
if [ "$COUNT" -gt 0 ]; then
  echo "  FOUND: emoji x$COUNT"
  grep -nP '[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}]' "$SCANFILE" 2>/dev/null
  FOUND=$((FOUND + COUNT))
fi

# Pattern 18: Curly quotes (split: double quotes vs apostrophes)
echo "--- #18 Curly Quotes ---"
DCOUNT=$(grep -oP '[\x{201C}\x{201D}]' "$SCANFILE" 2>/dev/null | wc -l)
if [ "$DCOUNT" -gt 0 ]; then
  echo "  FOUND: curly double quotes x$DCOUNT"
  grep -nP '[\x{201C}\x{201D}]' "$SCANFILE" 2>/dev/null
  FOUND=$((FOUND + DCOUNT))
fi
SCOUNT=$(grep -oP '[\x{2018}\x{2019}]' "$SCANFILE" 2>/dev/null | wc -l)
if [ "$SCOUNT" -gt 0 ]; then
  echo "  FOUND: curly apostrophes x$SCOUNT (replace U+2018/U+2019 with straight U+0027)"
  grep -nP '[\x{2018}\x{2019}]' "$SCANFILE" 2>/dev/null
  FOUND=$((FOUND + SCOUNT))
fi

# Pattern 19: Chatbot artifacts
echo "--- #19 Chatbot Artifacts ---"
for phrase in "I hope this helps" "Let me know" "Would you like" "Certainly!" "Of course!"; do
  COUNT=$(grep -oi "$phrase" "$SCANFILE" 2>/dev/null | wc -l)
  if [ "$COUNT" -gt 0 ]; then
    echo "  FOUND: \"$phrase\" x$COUNT"
    grep -in "$phrase" "$SCANFILE" 2>/dev/null | head -5
    FOUND=$((FOUND + COUNT))
  fi
done

# Pattern 20: Knowledge-cutoff disclaimers
echo "--- #20 Cutoff Disclaimers ---"
for phrase in "as of my" "based on available information" "while specific details"; do
  COUNT=$(grep -oi "$phrase" "$SCANFILE" 2>/dev/null | wc -l)
  if [ "$COUNT" -gt 0 ]; then
    echo "  FOUND: \"$phrase\" x$COUNT"
    grep -in "$phrase" "$SCANFILE" 2>/dev/null | head -5
    FOUND=$((FOUND + COUNT))
  fi
done

# Pattern 21: Sycophantic tone
echo "--- #21 Sycophantic Tone ---"
for phrase in "Great question" "You're absolutely right" "excellent point"; do
  COUNT=$(grep -oi "$phrase" "$SCANFILE" 2>/dev/null | wc -l)
  if [ "$COUNT" -gt 0 ]; then
    echo "  FOUND: \"$phrase\" x$COUNT"
    grep -in "$phrase" "$SCANFILE" 2>/dev/null | head -5
    FOUND=$((FOUND + COUNT))
  fi
done

# Pattern 22: Filler phrases
echo "--- #22 Filler Phrases ---"
for phrase in "in order to" "due to the fact" "at this point in time" "has the ability to" "it is important to note"; do
  COUNT=$(grep -oi "$phrase" "$SCANFILE" 2>/dev/null | wc -l)
  if [ "$COUNT" -gt 0 ]; then
    echo "  FOUND: \"$phrase\" x$COUNT"
    grep -in "$phrase" "$SCANFILE" 2>/dev/null | head -5
    FOUND=$((FOUND + COUNT))
  fi
done

# Pattern 25: Hyphenated word pairs
echo "--- #25 Hyphenated Word Pairs ---"
for phrase in "self-hosted" "production-grade" "cross-functional" "data-driven" "client-facing" "high-quality" "real-time" "long-term" "end-to-end" "decision-making" "well-known"; do
  COUNT=$(grep -oi "$phrase" "$SCANFILE" 2>/dev/null | wc -l)
  if [ "$COUNT" -gt 0 ]; then
    echo "  FOUND: \"$phrase\" x$COUNT"
    grep -in "$phrase" "$SCANFILE" 2>/dev/null | head -5
    FOUND=$((FOUND + COUNT))
  fi
done

echo ""
echo "=== TOTAL MECHANICAL HITS: $FOUND ==="
if [ "$FOUND" -eq 0 ]; then
  echo "PASS: No mechanical AI patterns detected."
else
  echo "FAIL: $FOUND mechanical AI pattern(s) found. Fix before proceeding to judgment audit."
fi
