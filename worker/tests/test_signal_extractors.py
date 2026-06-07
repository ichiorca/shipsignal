"""T3 (spec 003) — AC1/AC4 unit tests for the deterministic code-signal extractors.

Each extractor is tested through its public surface (anti-pattern #4) over fixture diffs:
a positive case asserting the correct ``evidence_type``, plus the empty/boundary/no-change
inputs the AC requires. Determinism (AC1) is proven by running an extractor twice and
asserting identical output. Patches carry real ``@@`` hunk headers so the new-file line
numbers used for provenance (T4 metadata.line_range) are exercised, not faked.
"""

from __future__ import annotations

from release_worker.evidence_models import RawDiffFile
from release_worker.signal_extractors import (
    extract_docs_delta,
    extract_feature_flags,
    extract_public_api_changes,
    extract_routes,
    extract_schema_changes,
    extract_tests,
    extract_ui_strings,
)


def _file(path: str, patch: str, status: str = "modified") -> RawDiffFile:
    return RawDiffFile(file_path=path, status=status, patch_text=patch)


def _types(signals: tuple[object, ...]) -> list[str]:
    return [s.evidence_type for s in signals]  # type: ignore[attr-defined]


# --- extract_ui_strings -----------------------------------------------------------


def test_ui_strings_detects_jsx_text_and_attributes() -> None:
    patch = (
        "@@ -10,2 +10,4 @@ function Checklist()\n"
        " const x = 1\n"
        "+  <button>Create onboarding checklist</button>\n"
        '+  <input placeholder="Search teams" />\n'
    )

    signals = extract_ui_strings(_file("src/Checklist.tsx", patch))

    excerpts = {s.excerpt for s in signals}
    assert "Create onboarding checklist" in excerpts
    assert "Search teams" in excerpts
    assert _types(signals) == ["ui_string_change"] * len(signals)


def test_ui_strings_line_number_tracks_hunk_header() -> None:
    patch = (
        "@@ -10,1 +10,2 @@\n"
        " context\n"  # new line 10, advances to 11
        "+  <button>Save changes</button>\n"  # added at new line 11
    )

    signals = extract_ui_strings(_file("src/Save.tsx", patch))

    assert len(signals) == 1
    assert signals[0].line == 11


def test_ui_strings_empty_patch_yields_nothing() -> None:
    assert extract_ui_strings(_file("src/Empty.tsx", "")) == ()


def test_ui_strings_no_ui_change_yields_nothing() -> None:
    patch = "@@ -1,1 +1,2 @@\n const total = computeTotal(items)\n+const tax = rate * total\n"
    assert extract_ui_strings(_file("src/calc.ts", patch)) == ()


def test_ui_strings_is_deterministic() -> None:
    patch = "@@ -1,1 +1,2 @@\n x\n+  <h1>Welcome aboard</h1>\n"
    first = extract_ui_strings(_file("src/Home.tsx", patch))
    second = extract_ui_strings(_file("src/Home.tsx", patch))
    assert first == second


# --- extract_routes ---------------------------------------------------------------


def test_routes_detects_new_route_file() -> None:
    signals = extract_routes(_file("app/api/teams/route.ts", "", status="added"))
    assert _types(signals) == ["route"]
    assert signals[0].confidence == 0.9


def test_routes_detects_express_handler() -> None:
    patch = (
        "@@ -1,1 +1,2 @@\n const app = express()\n+app.get('/api/teams', listTeams)\n"
    )
    signals = extract_routes(_file("server/routes.ts", patch))
    assert _types(signals) == ["route"]
    assert signals[0].excerpt == "/api/teams"
    assert signals[0].symbol_name == "GET"


def test_routes_detects_python_decorator() -> None:
    patch = '@@ -1,1 +1,2 @@\n app = Flask(__name__)\n+@app.route("/health")\n'
    signals = extract_routes(_file("api/app.py", patch))
    assert _types(signals) == ["route"]
    assert signals[0].excerpt == "/health"


def test_routes_no_route_yields_nothing() -> None:
    patch = "@@ -1,1 +1,2 @@\n x = 1\n+y = 2\n"
    assert extract_routes(_file("src/util.ts", patch)) == ()


# --- extract_feature_flags --------------------------------------------------------


def test_feature_flags_detects_lookup_call() -> None:
    patch = "@@ -1,1 +1,2 @@\n render()\n+if (isEnabled('onboarding_v2')) doThing()\n"
    signals = extract_feature_flags(_file("src/gate.ts", patch))
    assert _types(signals) == ["feature_flag"]
    assert signals[0].symbol_name == "onboarding_v2"


def test_feature_flags_detects_constant() -> None:
    patch = "@@ -1,1 +1,2 @@\n x\n+const CHECKLIST_ENABLED = true\n"
    signals = extract_feature_flags(_file("src/flags.ts", patch))
    assert any(s.symbol_name == "CHECKLIST_ENABLED" for s in signals)


def test_feature_flags_no_flag_yields_nothing() -> None:
    patch = "@@ -1,1 +1,2 @@\n a\n+const total = 5\n"
    assert extract_feature_flags(_file("src/x.ts", patch)) == ()


# --- extract_schema_changes -------------------------------------------------------


def test_schema_detects_migration_file() -> None:
    signals = extract_schema_changes(
        _file("db/migrations/versions/0004_teams.py", "", status="added")
    )
    assert _types(signals) == ["schema_change"]
    assert signals[0].confidence == 0.95


def test_schema_detects_create_table_ddl() -> None:
    patch = "@@ -1,0 +1,2 @@\n+CREATE TABLE teams (\n+  id UUID PRIMARY KEY\n"
    signals = extract_schema_changes(_file("schema.sql", patch))
    assert "schema_change" in _types(signals)
    assert any(s.symbol_name == "teams" for s in signals)


def test_schema_detects_alembic_add_column() -> None:
    patch = (
        "@@ -1,0 +1,1 @@\n+    op.add_column('teams', sa.Column('plan', sa.Text()))\n"
    )
    signals = extract_schema_changes(
        _file("db/migrations/versions/0005_plan.py", patch, status="modified")
    )
    # op.add_column's first positional arg is the table being altered.
    assert any(s.symbol_name == "teams" for s in signals)
    assert "schema_change" in _types(signals)


def test_schema_no_change_yields_nothing() -> None:
    patch = "@@ -1,1 +1,2 @@\n print('hi')\n+print('bye')\n"
    assert extract_schema_changes(_file("app/util.py", patch)) == ()


# --- extract_public_api_changes ---------------------------------------------------


def test_public_api_detects_ts_export() -> None:
    patch = "@@ -1,1 +1,2 @@\n import x\n+export function createChecklist(): void {}\n"
    signals = extract_public_api_changes(_file("src/api.ts", patch))
    assert _types(signals) == ["public_api_change"]
    assert signals[0].symbol_name == "createChecklist"


def test_public_api_detects_openapi_file() -> None:
    signals = extract_public_api_changes(
        _file("docs/openapi.yaml", "", status="modified")
    )
    assert _types(signals) == ["public_api_change"]


def test_public_api_no_export_yields_nothing() -> None:
    patch = "@@ -1,1 +1,2 @@\n const x = 1\n+const y = 2\n"
    assert extract_public_api_changes(_file("src/internal.ts", patch)) == ()


# --- extract_tests ----------------------------------------------------------------


def test_tests_detects_js_case_name() -> None:
    patch = "@@ -1,1 +1,2 @@\n describe('x', () => {\n+  it('creates a checklist', () => {})\n"
    signals = extract_tests(_file("tests/onboarding.test.ts", patch))
    assert _types(signals) == ["test"]
    assert signals[0].excerpt == "creates a checklist"


def test_tests_detects_python_test_function() -> None:
    patch = "@@ -1,0 +1,1 @@\n+def test_creates_checklist():\n"
    signals = extract_tests(_file("tests/test_onboarding.py", patch))
    assert any(s.symbol_name == "test_creates_checklist" for s in signals)


def test_tests_new_empty_test_file_still_signals() -> None:
    signals = extract_tests(_file("e2e/smoke.spec.ts", "", status="added"))
    assert _types(signals) == ["test"]
    assert signals[0].confidence == 0.6


def test_tests_ignores_non_test_files() -> None:
    patch = "@@ -1,1 +1,2 @@\n x\n+  it('looks like a test', () => {})\n"
    assert extract_tests(_file("src/app.ts", patch)) == ()


# --- extract_docs_delta -----------------------------------------------------------


def test_docs_detects_markdown_heading() -> None:
    patch = "@@ -1,0 +1,1 @@\n+## New onboarding flow\n"
    signals = extract_docs_delta(_file("README.md", patch))
    assert _types(signals) == ["docs_delta"]
    assert signals[0].excerpt == "New onboarding flow"


def test_docs_detects_prose_line() -> None:
    patch = "@@ -1,0 +1,1 @@\n+Admins can now assign onboarding checklists to new members.\n"
    signals = extract_docs_delta(_file("docs/guide.md", patch))
    assert _types(signals) == ["docs_delta"]
    assert signals[0].confidence == 0.5


def test_docs_ignores_non_docs_files() -> None:
    patch = "@@ -1,0 +1,1 @@\n+## Not really docs\n"
    assert extract_docs_delta(_file("src/component.tsx", patch)) == ()


def test_docs_empty_patch_yields_nothing() -> None:
    assert extract_docs_delta(_file("CHANGELOG.md", "")) == ()
