"""T2 (spec 010) — data-subject erasure across Aurora + S3 (Art.17).

Exercises ``erase_release_run`` — the surface the privacy CLI invokes — against the in-memory
store (anti-pattern #4: no DB/S3/network, no private helper). The fake mirrors the runtime
store: Aurora rows in a set, S3 objects in a dict keyed by ``evidence/<run>/`` + ``media/<run>/``
keys, and an audit list — so the test proves BOTH stores are cleared, no object is orphaned,
and the erasure is audited with requester + reason.
"""

from __future__ import annotations

import pytest

from release_worker.erasure import (
    InMemoryErasureStore,
    InvalidReleaseRunIdError,
    OrphanedObjectsError,
    OrphanedRowsError,
    erase_release_run,
)

_RUN = "11111111-1111-4111-8111-111111111111"
_OTHER_RUN = "99999999-9999-4999-8999-999999999999"


def _seeded_store() -> InMemoryErasureStore:
    store = InMemoryErasureStore()
    store.seed_run(_RUN)
    store.seed_run(_OTHER_RUN)
    # The run's PII-bearing blobs span both prefixes/buckets.
    store.seed_object(f"evidence/{_RUN}/a.txt")
    store.seed_object(f"evidence/{_RUN}/b.txt")
    store.seed_object(f"media/{_RUN}/demo.mp4")
    # Another run's objects must survive (cross-run bleed is forbidden, constitution §2).
    store.seed_object(f"evidence/{_OTHER_RUN}/c.txt")
    return store


def test_erase_removes_rows_and_objects_across_both_stores() -> None:
    store = _seeded_store()

    report = erase_release_run(
        store, _RUN, requested_by="dpo@team", reason="Art.17 erasure request"
    )

    # Aurora: the run row is gone; the other run is untouched.
    assert _RUN not in store.run_rows
    assert _OTHER_RUN in store.run_rows
    # S3: every object under the run's prefixes is gone; the other run's object remains.
    assert not [k for k in store.objects if _RUN in k]
    assert f"evidence/{_OTHER_RUN}/c.txt" in store.objects
    # The report counts what was removed.
    assert report.rows_deleted == 1
    assert report.objects_deleted == 3
    assert report.s3_prefixes == (f"evidence/{_RUN}/", f"media/{_RUN}/")


def test_erase_records_an_audit_row_with_requester_and_reason() -> None:
    store = _seeded_store()

    erase_release_run(
        store, _RUN, requested_by="dpo@team", reason="subject asked to be forgotten"
    )

    assert len(store.audits) == 1
    audit = store.audits[0]
    assert audit.release_run_id == _RUN
    assert audit.requested_by == "dpo@team"
    assert audit.reason == "subject asked to be forgotten"
    assert audit.objects_deleted == 3


def test_erase_is_idempotent_on_an_already_erased_run() -> None:
    store = _seeded_store()
    erase_release_run(store, _RUN, requested_by="dpo", reason="first")

    report = erase_release_run(store, _RUN, requested_by="dpo", reason="retry")

    # Nothing left to delete, but the (re)request is still audited — never silent.
    assert report.rows_deleted == 0
    assert report.objects_deleted == 0
    assert len(store.audits) == 2


def test_erase_fails_closed_if_an_object_is_orphaned() -> None:
    """If delete leaves an object under the prefix, verification raises (Art.17 unmet)."""

    class LeakyStore(InMemoryErasureStore):
        def delete_objects(self, keys: tuple[str, ...]) -> int:
            # Simulate a partial delete: drop all but the last key.
            return super().delete_objects(keys[:-1])

    store = LeakyStore()
    store.seed_run(_RUN)
    store.seed_object(f"evidence/{_RUN}/a.txt")
    store.seed_object(f"evidence/{_RUN}/b.txt")

    with pytest.raises(OrphanedObjectsError):
        erase_release_run(store, _RUN, requested_by="dpo", reason="x")
    # A false 'erased' audit must NOT be recorded when verification fails.
    assert store.audits == []


def test_erase_fails_closed_if_aurora_rows_survive() -> None:
    """If a run-scoped row survives the delete, verification raises (Art.17 unmet)."""

    class StaleRowStore(InMemoryErasureStore):
        def delete_run_rows(self, release_run_id: str) -> int:
            # Simulate a partial CASCADE: report success but leave the run row behind.
            return 1

    store = StaleRowStore()
    store.seed_run(_RUN)

    with pytest.raises(OrphanedRowsError):
        erase_release_run(store, _RUN, requested_by="dpo", reason="x")
    # A false 'erased' audit must NOT be recorded when verification fails.
    assert store.audits == []


def test_erase_rejects_an_unsafe_run_id() -> None:
    store = InMemoryErasureStore()

    with pytest.raises(InvalidReleaseRunIdError):
        erase_release_run(store, "../etc/passwd", requested_by="dpo", reason="x")
