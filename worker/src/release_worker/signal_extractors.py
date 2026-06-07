"""T3 (spec 003) — lightweight deterministic code-signal extractors (PRD §6.2).

Each extractor is a *pure function* of one ``RawDiffFile`` → a tuple of ``CodeSignal``;
no I/O, no model call, no langgraph/psycopg/boto3 import — so the unit gate exercises
them directly (anti-pattern #4) and they are reproducible across runs (AC1: deterministic
output). Per the constitution ("Start with lightweight deterministic extractors before
AST-heavy tooling"), detection is regex over the *added* lines of the unified diff: the
new/changed user-facing surface is what a release announces.

P5 (Safety rails): the patch text is untrusted GitHub input (github-rules: "treat
ingested GitHub text as injection-capable"). These functions only *read* it to classify
it; the matched ``excerpt`` is still raw and is redacted by ``redact_evidence`` before it
reaches S3/Aurora/state (constitution §5). Confidence values are fixed constants so the
same diff always yields the same score (AC1).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator

from release_worker.evidence_models import CodeSignal, RawDiffFile

# Excerpts are bounded so a pathological single line can't bloat a row/blob.
_MAX_EXCERPT = 280


def _truncate(text: str) -> str:
    cleaned = text.strip()
    return (
        cleaned if len(cleaned) <= _MAX_EXCERPT else cleaned[: _MAX_EXCERPT - 1] + "…"
    )


# --- unified-diff walking ---------------------------------------------------------

_HUNK_HEADER = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def _added_lines(patch_text: str) -> Iterator[tuple[int | None, str]]:
    """Yield ``(new_file_line_no, content)`` for each added (``+``) line in a patch.

    Tracks the new-file line counter from each ``@@`` hunk header so every signal can
    cite a precise line for provenance (T4 metadata.line_range). Lines outside any hunk
    (no header seen yet) yield ``None`` for the line number rather than guessing.
    """
    new_line: int | None = None
    for raw in patch_text.splitlines():
        header = _HUNK_HEADER.match(raw)
        if header is not None:
            new_line = int(header.group(1))
            continue
        if raw.startswith("+++") or raw.startswith("---"):
            continue  # file headers, not content
        if raw.startswith("+"):
            yield (new_line, raw[1:])
            if new_line is not None:
                new_line += 1
        elif raw.startswith("-"):
            continue  # removed line: does not advance the new-file counter
        else:
            if new_line is not None:
                new_line += 1  # context line advances the new-file counter


def _signal(
    evidence_type: str,
    excerpt: str,
    confidence: float,
    line: int | None,
    symbol_name: str | None = None,
) -> CodeSignal:
    return CodeSignal(
        evidence_type=evidence_type,
        excerpt=_truncate(excerpt),
        confidence=confidence,
        symbol_name=symbol_name,
        line=line,
    )


# --- extract_ui_strings -----------------------------------------------------------

# UI-bearing JSX/HTML attributes and assignment targets (user-visible copy).
_UI_ATTR = re.compile(
    r"""(?ix)
    \b(aria-label|placeholder|title|alt|label|tooltip|heading|cta
       |buttontext|errormessage|emptystate|description)\b
    \s*[:=]\s*["']([^"']{2,})["']
    """
)
# JSX text node: ">Some Human Text<" starting with a capital letter.
_JSX_TEXT = re.compile(r">\s*([A-Z][A-Za-z0-9 ,.'!?\-]{3,})\s*<")
_HAS_LETTER = re.compile(r"[A-Za-z]")
_UI_ATTR_CONFIDENCE = 0.8
_UI_TEXT_CONFIDENCE = 0.6


def extract_ui_strings(file: RawDiffFile) -> tuple[CodeSignal, ...]:
    """New/changed user-visible labels, buttons, error messages, empty states."""
    out: list[CodeSignal] = []
    for line, content in _added_lines(file.patch_text):
        for attr, value in _UI_ATTR.findall(content):
            if _HAS_LETTER.search(value):
                out.append(
                    _signal(
                        "ui_string_change",
                        value,
                        _UI_ATTR_CONFIDENCE,
                        line,
                        attr.lower(),
                    )
                )
        for text in _JSX_TEXT.findall(content):
            out.append(_signal("ui_string_change", text, _UI_TEXT_CONFIDENCE, line))
    return tuple(out)


# --- extract_routes ---------------------------------------------------------------

_ROUTE_FILE = re.compile(
    r"(?i)(?:(?:^|/)(?:app|pages)/.*?(?:/route\.[jt]sx?$|/page\.[jt]sx?$)"
    r"|(?:^|/)pages/api/.+\.[jt]sx?$)"
)
_ROUTE_JS = re.compile(
    r"""(?ix)\b(?:app|router|api|server|r)\.(get|post|put|patch|delete|all)\(
        \s*["'`]([^"'`]+)["'`]"""
)
_ROUTE_PY = re.compile(
    r"""(?ix)@\s*(?:app|router|bp|blueprint)\.(?:route|get|post|put|patch|delete)\(
        \s*["']([^"']+)["']"""
)
_ROUTE_DJANGO = re.compile(r"""(?ix)\b(?:path|re_path|url)\(\s*["']([^"']*)["']""")
_ROUTE_FILE_CONFIDENCE = 0.9
_ROUTE_CODE_CONFIDENCE = 0.85


def extract_routes(file: RawDiffFile) -> tuple[CodeSignal, ...]:
    """New frontend/backend routes and API endpoints."""
    out: list[CodeSignal] = []
    if file.status == "added" and _ROUTE_FILE.search(file.file_path):
        out.append(
            _signal(
                "route", file.file_path, _ROUTE_FILE_CONFIDENCE, None, file.file_path
            )
        )
    for line, content in _added_lines(file.patch_text):
        for method, path in _ROUTE_JS.findall(content):
            out.append(
                _signal("route", path, _ROUTE_CODE_CONFIDENCE, line, method.upper())
            )
        for path in _ROUTE_PY.findall(content):
            out.append(_signal("route", path, _ROUTE_CODE_CONFIDENCE, line))
        for path in _ROUTE_DJANGO.findall(content):
            if path:
                out.append(_signal("route", path, _ROUTE_CODE_CONFIDENCE, line))
    return tuple(out)


# --- extract_feature_flags --------------------------------------------------------

_FLAG_LOOKUP = re.compile(
    r"""(?ix)\b(?:isEnabled|isFeatureEnabled|useFlag|useFeature|getFlag|variation)\(
        \s*["']([A-Za-z0-9_.\-]{2,})["']"""
)
_FLAG_ACCESS = re.compile(
    r"(?i)\b(?:feature[_\-]?flags?|flags?|toggles?)\s*[.\[]\s*[\"']?([A-Za-z0-9_.\-]{2,})"
)
_FLAG_CONST = re.compile(r"\b([A-Z][A-Z0-9]*_(?:ENABLED|FLAG|FEATURE))\b")
_FLAG_KV = re.compile(r"""["']([a-z0-9_\-]{2,})["']\s*:\s*(?:true|false)\b""")
_FLAG_CONFIDENCE = 0.75


def extract_feature_flags(file: RawDiffFile) -> tuple[CodeSignal, ...]:
    """New flags, flag defaults, rollout hints."""
    out: list[CodeSignal] = []
    for line, content in _added_lines(file.patch_text):
        names: list[str] = []
        names.extend(_FLAG_LOOKUP.findall(content))
        names.extend(_FLAG_ACCESS.findall(content))
        names.extend(_FLAG_CONST.findall(content))
        if "flag" in content.lower() or "feature" in content.lower():
            names.extend(_FLAG_KV.findall(content))
        for name in names:
            out.append(_signal("feature_flag", name, _FLAG_CONFIDENCE, line, name))
    return tuple(out)


# --- extract_schema_changes -------------------------------------------------------

_MIGRATION_PATH = re.compile(
    r"(?i)(?:^|/)(?:migrations|alembic/versions)/.+\.(?:py|sql)$"
)
_DDL_CREATE_TABLE = re.compile(
    r"""(?i)\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([A-Za-z0-9_.]+)"""
)
_DDL_ADD_COLUMN = re.compile(
    r"""(?i)\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([A-Za-z0-9_]+)"""
)
_DDL_ENUM = re.compile(
    r"""(?i)\bCREATE\s+TYPE\s+["']?([A-Za-z0-9_.]+)["']?\s+AS\s+ENUM"""
)
_ALEMBIC_OP = re.compile(
    r"""(?ix)\bop\.(create_table|add_column|create_index|alter_column|create_table)\(
        \s*["']([A-Za-z0-9_]+)["']"""
)
_SCHEMA_FILE_CONFIDENCE = 0.95
_SCHEMA_DDL_CONFIDENCE = 0.9


def extract_schema_changes(file: RawDiffFile) -> tuple[CodeSignal, ...]:
    """Migrations, new tables/columns, enum changes."""
    out: list[CodeSignal] = []
    if file.status == "added" and _MIGRATION_PATH.search(file.file_path):
        out.append(
            _signal(
                "schema_change",
                file.file_path,
                _SCHEMA_FILE_CONFIDENCE,
                None,
                file.file_path,
            )
        )
    for line, content in _added_lines(file.patch_text):
        for table in _DDL_CREATE_TABLE.findall(content):
            out.append(
                _signal("schema_change", content, _SCHEMA_DDL_CONFIDENCE, line, table)
            )
        for column in _DDL_ADD_COLUMN.findall(content):
            out.append(
                _signal("schema_change", content, _SCHEMA_DDL_CONFIDENCE, line, column)
            )
        for enum in _DDL_ENUM.findall(content):
            out.append(
                _signal("schema_change", content, _SCHEMA_DDL_CONFIDENCE, line, enum)
            )
        for _op, name in _ALEMBIC_OP.findall(content):
            out.append(
                _signal("schema_change", content, _SCHEMA_DDL_CONFIDENCE, line, name)
            )
    return tuple(out)


# --- extract_public_api_changes ---------------------------------------------------

_TS_EXPORT = re.compile(
    r"""(?x)\bexport\s+(?:default\s+)?(?:async\s+)?
        (?:function|class|const|let|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)"""
)
_PY_PUBLIC = re.compile(r"^\s*(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)")
_OPENAPI_FILE = re.compile(r"(?i)(?:^|/)(?:openapi|swagger)[^/]*\.(?:ya?ml|json)$")
_API_CONFIDENCE = 0.85
_OPENAPI_CONFIDENCE = 0.8


def extract_public_api_changes(file: RawDiffFile) -> tuple[CodeSignal, ...]:
    """Exported functions/types, OpenAPI changes, SDK changes."""
    out: list[CodeSignal] = []
    if _OPENAPI_FILE.search(file.file_path):
        out.append(
            _signal(
                "public_api_change",
                file.file_path,
                _OPENAPI_CONFIDENCE,
                None,
                file.file_path,
            )
        )
    is_py_public_surface = file.file_path.endswith("__init__.py")
    for line, content in _added_lines(file.patch_text):
        for name in _TS_EXPORT.findall(content):
            out.append(
                _signal("public_api_change", content, _API_CONFIDENCE, line, name)
            )
        if is_py_public_surface:
            match = _PY_PUBLIC.match(content)
            if match is not None:
                out.append(
                    _signal(
                        "public_api_change",
                        content,
                        _API_CONFIDENCE,
                        line,
                        match.group(1),
                    )
                )
    return tuple(out)


# --- extract_tests ----------------------------------------------------------------

_TEST_FILE = re.compile(
    r"(?i)(?:\.(?:test|spec|cy)\.[jt]sx?$|(?:^|/)test_[^/]+\.py$|_test\.py$"
    r"|(?:^|/)(?:tests?|e2e|__tests__)/)"
)
_JS_TEST_NAME = re.compile(r"""(?x)\b(?:test|it|describe)\(\s*["'`]([^"'`]{3,})["'`]""")
_PY_TEST_NAME = re.compile(r"^\s*def\s+(test_[A-Za-z0-9_]+)")
_TEST_CONFIDENCE = 0.8
_TEST_FILE_CONFIDENCE = 0.6


def extract_tests(file: RawDiffFile) -> tuple[CodeSignal, ...]:
    """New or changed tests that describe user behavior."""
    if not _TEST_FILE.search(file.file_path):
        return ()
    out: list[CodeSignal] = []
    for line, content in _added_lines(file.patch_text):
        for name in _JS_TEST_NAME.findall(content):
            out.append(_signal("test", name, _TEST_CONFIDENCE, line))
        py_match = _PY_TEST_NAME.match(content)
        if py_match is not None:
            out.append(
                _signal(
                    "test", py_match.group(1), _TEST_CONFIDENCE, line, py_match.group(1)
                )
            )
    if not out and file.status == "added":
        # A brand-new test file with no recognizable case name still signals behavior.
        out.append(
            _signal("test", file.file_path, _TEST_FILE_CONFIDENCE, None, file.file_path)
        )
    return tuple(out)


# --- extract_docs_delta -----------------------------------------------------------

_DOCS_FILE = re.compile(
    r"(?i)(?:\.(?:md|mdx|rst)$|(?:^|/)docs/|(?:^|/)(?:CHANGELOG|README|RELEASE[_\-]?NOTES))"
)
_MD_HEADING = re.compile(r"^\s*#{1,6}\s+(\S.*?)\s*$")
_DOCS_HEADING_CONFIDENCE = 0.7
_DOCS_PROSE_CONFIDENCE = 0.5


def extract_docs_delta(file: RawDiffFile) -> tuple[CodeSignal, ...]:
    """Docs pages, headings, release-note fragments."""
    if not _DOCS_FILE.search(file.file_path):
        return ()
    out: list[CodeSignal] = []
    for line, content in _added_lines(file.patch_text):
        heading = _MD_HEADING.match(content)
        if heading is not None:
            out.append(
                _signal("docs_delta", heading.group(1), _DOCS_HEADING_CONFIDENCE, line)
            )
        elif len(content.strip()) >= 12 and " " in content.strip():
            out.append(_signal("docs_delta", content, _DOCS_PROSE_CONFIDENCE, line))
    return tuple(out)


# The six diff-derived code extractors, in PRD §6.2 order. ``extract_docs_delta`` is
# driven separately by the ``collect_docs_changes`` node (graph §5.2), so every extractor
# is reachable through exactly one node (anti-pattern #3: no orphan extractor).
CODE_EXTRACTORS: tuple[Callable[[RawDiffFile], tuple[CodeSignal, ...]], ...] = (
    extract_ui_strings,
    extract_routes,
    extract_feature_flags,
    extract_schema_changes,
    extract_public_api_changes,
    extract_tests,
)
