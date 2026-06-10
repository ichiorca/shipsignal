// T2 (spec 022) — the configured default artifact-type selection (PRD §8.1 / §14.1).
// Applied when a run is created without an explicit selection: GitHub-webhook-triggered
// runs always use it, and a POST /api/releases body that omits artifact_types falls back
// to it. P5 (Safety rails): `server-only` keeps this off the client; the value itself is
// config, not a secret.
//
// Validated at STARTUP (spec AC): the parse runs at module load, so a deployment with a
// typo'd ARTIFACT_TYPES_DEFAULT fails its first request loudly instead of silently
// generating the wrong artifact set for every webhook run. Unset/blank → all six.

import 'server-only';
import {
  parseArtifactTypesDefault,
  type ArtifactType,
} from '@/app/lib/artifactTypes.ts';

/** The selection applied to runs created without an explicit artifact_types. */
export const DEFAULT_ARTIFACT_TYPES: readonly ArtifactType[] = parseArtifactTypesDefault(
  process.env.ARTIFACT_TYPES_DEFAULT,
);
