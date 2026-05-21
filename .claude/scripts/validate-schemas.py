"""
Validate JSON-LD structured data against the official schema.org spec.

Uses schemaorg-current-https.jsonld as ground truth -- no guessing, no AI.
Walks type inheritance chains (e.g., Service > Intangible > Thing) to
determine the full set of valid properties for each @type.

Modes:
    python scripts/validate-schemas.py                      # scan build output
    python scripts/validate-schemas.py --live BASE_URL      # fetch from running server via sitemap
    python scripts/validate-schemas.py --url URL [URL ...]  # validate specific URLs

Options:
    --no-localhost    Suppress localhost URL warnings
    --errors-only     Only show errors, not warnings
"""

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

def _find_project_root():
    for p in Path(__file__).resolve().parents:
        if (p / ".claude").is_dir():
            return p
    raise RuntimeError(f"Project root not found from {__file__}")


PROJECT_ROOT = _find_project_root()

# Schema.org spec file location.
# TODO: When bundled into a skill, move to .claude/skills/{skill}/references/schema.org.json
# Currently lives at .lgtm/shared/resources/schema.org.json
# Download from: https://schema.org/version/latest/schemaorg-current-https.jsonld
SPEC_FILE = PROJECT_ROOT / ".lgtm" / "shared" / "resources" / "schema.org.json"

# Default build output directory. Override with CLI arg for non-Next.js projects.
DEFAULT_BUILD_DIR = PROJECT_ROOT / ".next" / "server" / "app"

# JSON-LD keywords -- not schema.org properties, always valid
JSONLD_KEYWORDS = {"@context", "@type", "@id", "@graph", "@list", "@set", "@value", "@language"}

# ---------------------------------------------------------------------------
# Schema.org spec loader
# ---------------------------------------------------------------------------


def load_spec(spec_path: Path) -> tuple[dict[str, set[str]], dict[str, list[str]]]:
    """
    Parse the schema.org JSON-LD spec and return:
    - type_properties: {type_id: set of direct property names}
    - type_parents: {type_id: [parent_type_ids]}
    """
    with open(spec_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    graph = data["@graph"]
    type_parents: dict[str, list[str]] = {}
    type_direct_props: dict[str, set[str]] = {}

    for item in graph:
        if item.get("@type") == "rdfs:Class":
            tid = item["@id"]
            parent = item.get("rdfs:subClassOf", [])
            if isinstance(parent, dict):
                parent = [parent]
            type_parents[tid] = [p["@id"] for p in parent if "@id" in p]
            type_direct_props[tid] = set()

    for item in graph:
        if item.get("@type") == "rdf:Property":
            prop_name = item["@id"].replace("schema:", "")
            domain = item.get("schema:domainIncludes", [])
            if isinstance(domain, dict):
                domain = [domain]
            for d in domain:
                dtype = d.get("@id", "")
                if dtype in type_direct_props:
                    type_direct_props[dtype].add(prop_name)

    return type_direct_props, type_parents


def get_ancestors(type_id: str, type_parents: dict[str, list[str]]) -> list[str]:
    """Walk the inheritance chain and return all ancestor type IDs."""
    ancestors = []
    visited = set()
    queue = [type_id]
    while queue:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)
        ancestors.append(current)
        for p in type_parents.get(current, []):
            queue.append(p)
    return ancestors


def build_valid_properties(
    type_direct_props: dict[str, set[str]],
    type_parents: dict[str, list[str]],
) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for type_id in type_direct_props:
        short_name = type_id.replace("schema:", "")
        ancestors = get_ancestors(type_id, type_parents)
        all_props: set[str] = set()
        for ancestor in ancestors:
            all_props.update(type_direct_props.get(ancestor, set()))
        result[short_name] = all_props
    return result


# ---------------------------------------------------------------------------
# HTML / JSON-LD extraction
# ---------------------------------------------------------------------------


def extract_jsonld(html: str) -> list[dict]:
    pattern = r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>'
    matches = re.findall(pattern, html, re.DOTALL)
    schemas = []
    for m in matches:
        try:
            schemas.append(json.loads(m))
        except json.JSONDecodeError as e:
            schemas.append({"_parse_error": str(e), "_raw": m[:200]})
    return schemas


def fetch_html(url: str) -> str | None:
    """Fetch HTML from a URL. Returns None on failure."""
    try:
        with urlopen(url, timeout=10) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except (URLError, TimeoutError, OSError) as e:
        print(f"  FETCH ERROR: {url} - {e}")
        return None


def discover_urls_from_sitemap(base_url: str) -> list[str]:
    """Fetch sitemap.xml and extract all URLs."""
    sitemap_url = f"{base_url.rstrip('/')}/sitemap.xml"
    html = fetch_html(sitemap_url)
    if not html:
        return []

    urls = []
    try:
        root = ET.fromstring(html)
        # Handle namespace
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        for loc in root.findall(".//sm:loc", ns):
            if loc.text:
                urls.append(loc.text)
        # Try without namespace if nothing found
        if not urls:
            for loc in root.iter():
                if loc.tag.endswith("loc") and loc.text:
                    urls.append(loc.text)
    except ET.ParseError:
        # Fallback: regex
        urls = re.findall(r"<loc>(.*?)</loc>", html)

    return urls


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

REQUIRED_FIELDS: dict[str, list[str]] = {
    "WebSite": ["name", "url"],
    "AboutPage": ["url", "name", "description"],
    "ContactPage": ["url", "name", "description"],
    "FAQPage": ["mainEntity"],
    "CollectionPage": ["url", "name", "mainEntity"],
    "Blog": ["url", "name"],
    "BlogPosting": ["headline", "url", "datePublished", "author"],
    "Service": ["name", "url", "provider"],
    "SoftwareApplication": ["name", "url"],
    "Organization": ["name", "url"],
    "BreadcrumbList": ["itemListElement"],
    "ItemList": ["itemListElement"],
}

WARN_EMPTY = {"mainEntity", "itemListElement"}


def validate_schema(
    schema: dict,
    valid_properties: dict[str, set[str]],
    page_path: str,
    depth: int = 0,
    check_localhost: bool = True,
) -> list[dict]:
    """
    Validate a single JSON-LD schema object against the spec.
    Returns a list of issue dicts: {level, type, property, message}
    """
    issues: list[dict] = []

    if "_parse_error" in schema:
        issues.append({
            "level": "ERROR",
            "type": "JSON",
            "property": "-",
            "message": f"Parse error: {schema['_parse_error']}",
        })
        return issues

    schema_type = schema.get("@type", "Unknown")

    # --- Required fields (top-level only, not nested references) ---
    if depth == 0:
        required = REQUIRED_FIELDS.get(schema_type, [])
        for field in required:
            if field not in schema or schema[field] is None:
                issues.append({
                    "level": "ERROR",
                    "type": schema_type,
                    "property": field,
                    "message": "Missing required field",
                })

    # --- Empty collections ---
    for field in WARN_EMPTY:
        val = schema.get(field)
        if isinstance(val, list) and len(val) == 0:
            issues.append({
                "level": "ERROR",
                "type": schema_type,
                "property": field,
                "message": "Empty list (no items)",
            })
        if isinstance(val, dict):
            if "itemListElement" in val:
                inner = val["itemListElement"]
                if isinstance(inner, list) and len(inner) == 0:
                    issues.append({
                        "level": "ERROR",
                        "type": schema_type,
                        "property": f"{field}.itemListElement",
                        "message": "Empty nested list",
                    })
            n = val.get("numberOfItems")
            if isinstance(n, int) and n == 0:
                issues.append({
                    "level": "WARN",
                    "type": schema_type,
                    "property": f"{field}.numberOfItems",
                    "message": "numberOfItems is 0",
                })

    # --- @context check (top-level only) ---
    if depth == 0 and "@context" not in schema:
        issues.append({
            "level": "ERROR",
            "type": schema_type,
            "property": "@context",
            "message": "Missing @context",
        })

    # --- Property validity against spec ---
    if schema_type in valid_properties:
        allowed = valid_properties[schema_type]
        for key in schema:
            if key in JSONLD_KEYWORDS:
                continue
            if key not in allowed:
                issues.append({
                    "level": "WARN",
                    "type": schema_type,
                    "property": key,
                    "message": f"Not a valid property of {schema_type} per schema.org spec",
                })

    # --- localhost URL check ---
    if check_localhost:
        for key in ("url", "@id", "urlTemplate"):
            val = schema.get(key, "")
            if isinstance(val, str) and "localhost" in val:
                issues.append({
                    "level": "WARN",
                    "type": schema_type,
                    "property": key,
                    "message": f"Contains localhost: {val[:80]}",
                })

    # --- FAQPage specific ---
    if schema_type == "FAQPage":
        entities = schema.get("mainEntity", [])
        if isinstance(entities, list):
            for i, q in enumerate(entities):
                if q.get("@type") != "Question":
                    issues.append({
                        "level": "ERROR",
                        "type": schema_type,
                        "property": f"mainEntity[{i}].@type",
                        "message": f"Expected Question, got {q.get('@type')}",
                    })
                if not q.get("acceptedAnswer", {}).get("text"):
                    issues.append({
                        "level": "ERROR",
                        "type": schema_type,
                        "property": f"mainEntity[{i}].acceptedAnswer.text",
                        "message": "Missing answer text",
                    })

    # --- BreadcrumbList position check ---
    if schema_type == "BreadcrumbList":
        items = schema.get("itemListElement", [])
        for i, item in enumerate(items):
            if item.get("position") != i + 1:
                issues.append({
                    "level": "ERROR",
                    "type": schema_type,
                    "property": f"itemListElement[{i}].position",
                    "message": f"Expected {i + 1}, got {item.get('position')}",
                })

    # --- Recurse into nested objects ---
    for key, val in schema.items():
        if key in JSONLD_KEYWORDS:
            continue
        if isinstance(val, dict) and "@type" in val:
            nested_issues = validate_schema(val, valid_properties, page_path, depth + 1, check_localhost)
            for issue in nested_issues:
                issue["property"] = f"{key}.{issue['property']}"
                issues.append(issue)
        elif isinstance(val, list):
            for i, item in enumerate(val):
                if isinstance(item, dict) and "@type" in item:
                    nested_issues = validate_schema(item, valid_properties, page_path, depth + 1, check_localhost)
                    for issue in nested_issues:
                        issue["property"] = f"{key}[{i}].{issue['property']}"
                        issues.append(issue)

    return issues


# ---------------------------------------------------------------------------
# Scanners
# ---------------------------------------------------------------------------


def validate_pages(
    pages: list[tuple[str, str]],
    valid_properties: dict[str, set[str]],
    check_localhost: bool = True,
    errors_only: bool = False,
) -> tuple[int, int, int, int, list[tuple[str, list[dict]]]]:
    """
    Validate a list of (page_label, html_content) tuples.
    Returns (pages_checked, total_schemas, total_errors, total_warnings, all_issues).
    """
    total_schemas = 0
    total_errors = 0
    total_warnings = 0
    pages_checked = 0
    all_page_issues: list[tuple[str, list[dict]]] = []

    for label, html in pages:
        schemas = extract_jsonld(html)
        if not schemas:
            continue

        pages_checked += 1
        page_issues: list[dict] = []

        for schema in schemas:
            total_schemas += 1
            issues = validate_schema(schema, valid_properties, label, check_localhost=check_localhost)
            if errors_only:
                issues = [i for i in issues if i["level"] == "ERROR"]
            page_issues.extend(issues)

        if page_issues:
            all_page_issues.append((label, page_issues))
            for issue in page_issues:
                if issue["level"] == "ERROR":
                    total_errors += 1
                else:
                    total_warnings += 1

    return pages_checked, total_schemas, total_errors, total_warnings, all_page_issues


def scan_build_dir(build_dir: Path) -> list[tuple[str, str]]:
    """Read all HTML files from build output."""
    pages = []
    html_files = sorted(build_dir.rglob("*.html"))
    for html_file in html_files:
        rel = str(html_file.relative_to(build_dir)).replace("\\", "/")
        content = html_file.read_text(encoding="utf-8", errors="replace")
        pages.append((rel, content))
    return pages


def scan_live(base_url: str) -> list[tuple[str, str]]:
    """Fetch all pages from a running server via sitemap."""
    base = base_url.rstrip("/")
    print(f"Fetching sitemap from {base}/sitemap.xml ...")
    urls = discover_urls_from_sitemap(base)

    if not urls:
        print("No URLs found in sitemap. Trying common paths...")
        # Fallback: try to read routes from build output if available
        if DEFAULT_BUILD_DIR.exists():
            for html_file in DEFAULT_BUILD_DIR.rglob("*.html"):
                rel = str(html_file.relative_to(DEFAULT_BUILD_DIR)).replace("\\", "/")
                route = "/" + rel.replace(".html", "").replace("/index", "")
                if route == "/":
                    route = "/"
                urls.append(f"{base}{route}")

    print(f"Found {len(urls)} URLs\n")

    pages = []
    for url in urls:
        html = fetch_html(url)
        if html:
            # Use path as label
            label = url.replace(base, "") or "/"
            pages.append((label, html))

    return pages


def scan_urls(urls: list[str]) -> list[tuple[str, str]]:
    """Fetch specific URLs."""
    pages = []
    for url in urls:
        html = fetch_html(url)
        if html:
            pages.append((url, html))
    return pages


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


def print_report(
    pages: int,
    schemas: int,
    errors: int,
    warnings: int,
    all_issues: list[tuple[str, list[dict]]],
) -> None:
    for page_path, issues in all_issues:
        print(f"\n  {page_path}")
        for issue in issues:
            level = issue["level"]
            marker = "x" if level == "ERROR" else "!"
            print(f"    [{marker}] {issue['type']}.{issue['property']}: {issue['message']}")

    print(f"\n{'=' * 60}")
    print(f"  Pages scanned:    {pages}")
    print(f"  Schemas found:    {schemas}")
    print(f"  Errors:           {errors}")
    print(f"  Warnings:         {warnings}")
    print(f"{'=' * 60}")

    if errors > 0:
        print(f"\n  Result: {errors} ERRORS, {warnings} WARNINGS")
    elif warnings > 0:
        print(f"\n  Result: PASS with {warnings} WARNINGS")
    else:
        print(f"\n  Result: ALL SCHEMAS VALID")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate JSON-LD against schema.org spec")
    parser.add_argument("build_dir", nargs="?", default=None, help="Build output directory")
    parser.add_argument("--live", metavar="BASE_URL", help="Fetch pages from running server via sitemap")
    parser.add_argument("--url", nargs="+", metavar="URL", help="Validate specific URL(s)")
    parser.add_argument("--no-localhost", action="store_true", help="Suppress localhost URL warnings")
    parser.add_argument("--errors-only", action="store_true", help="Only show errors, not warnings")
    args = parser.parse_args()

    # Load spec
    if not SPEC_FILE.exists():
        print(f"ERROR: Schema.org spec not found at {SPEC_FILE}")
        print("Download from: https://schema.org/version/latest/schemaorg-current-https.jsonld")
        sys.exit(1)

    print(f"Loading schema.org spec: {SPEC_FILE.name}")
    type_direct_props, type_parents = load_spec(SPEC_FILE)
    valid_properties = build_valid_properties(type_direct_props, type_parents)
    print(f"Loaded {len(valid_properties)} types with property maps\n")

    # Determine mode
    if args.url:
        print(f"Validating {len(args.url)} URL(s)...\n")
        pages = scan_urls(args.url)
    elif args.live:
        print(f"Live mode: {args.live}\n")
        pages = scan_live(args.live)
    else:
        build_dir = Path(args.build_dir) if args.build_dir else DEFAULT_BUILD_DIR
        if not build_dir.exists():
            print(f"ERROR: Build directory not found: {build_dir}")
            print("Run 'pnpm build' first, or use --live BASE_URL")
            sys.exit(1)
        print(f"Scanning build: {build_dir}\n")
        pages = scan_build_dir(build_dir)

    if not pages:
        print("No pages found to validate.")
        sys.exit(1)

    check_localhost = not args.no_localhost
    result = validate_pages(pages, valid_properties, check_localhost, args.errors_only)
    pages_checked, schemas, errors, warnings, all_issues = result
    print_report(pages_checked, schemas, errors, warnings, all_issues)

    sys.exit(1 if errors > 0 else 0)


if __name__ == "__main__":
    main()
