# Tasks — Feature clustering + scoring + Gate #1 approval

- [x] **T1 — Migrations for feature_clusters + feature_evidence_links + approvals** Create §10.2 and §10.4 tables with FKs and status default pending_review.
- [x] **T2 — cluster_features_with_bedrock node** Call Bedrock Converse with a published Guardrail attached; input only redacted evidence; output validated by Pydantic into candidate features. Throttling backoff; app-level dedupe/idempotency.
- [x] **T3 — score_features + persist_feature_manifest nodes** Compute marketability/demoability/confidence and persist feature_clusters + feature_evidence_links (relevance_score).
- [x] **T4 — Gate #1 LangGraph interrupt** approve_feature_manifest interrupt surfaces the JSON payload (gate, release_run_id, thread_id, features_pending_review, dashboard_url) and halts the graph.
- [x] **T5 — Gate #1 dashboard review UI** Feature-review screen with approve/edit/reject per feature; submitting writes an approvals row (edited_payload_json on edit) and resumes the same thread_id.
- [x] **T6 — Resume + persist_review_decision path** On reviewer action, resume the thread; rejected/edited features persist a review decision and do not flow downstream.
