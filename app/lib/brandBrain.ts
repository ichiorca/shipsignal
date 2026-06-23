// The "brand & customer brain" config domain (migration 0025): ICP segments, company voice
// exemplars, and approved messaging claims. Pure types + Zod input validation, shared by the API
// routes (server) and the /settings UI (client). No 'server-only' / DB import here, so it is
// unit-testable under the dependency-free `node --test` harness. Field names mirror the peer repo
// (hindsight-guild) so a future merge is a join, not a rewrite.

import { z } from 'zod';
// Relative (not '@/') for the VALUE import so the dependency-free `node --test` harness resolves
// it at runtime; the bundler alias is only safe for erased type imports.
import { isArtifactType } from './artifactTypes.ts';

// --- ICP segments ("who we market to") -------------------------------------------------------

export type IcpStatus = 'active' | 'archived';

export interface IcpSegment {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly buyer_roles: readonly string[];
  readonly pain_points: readonly string[];
  readonly objections: readonly string[];
  readonly approved_angles: readonly string[];
  readonly status: IcpStatus;
}

/** Derive a stable, readable segment id from a name: "DTC merchant" → "seg_dtc_merchant".
 *  Mirrors the peer repo's `seg_*` convention so segments line up across the two products. */
export function slugifyIcpId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `seg_${slug || 'segment'}`;
}

const stringList = z.array(z.string().trim().min(1)).max(20).default([]);

export const icpInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
  buyer_roles: stringList,
  pain_points: stringList,
  objections: stringList,
  approved_angles: stringList,
  status: z.enum(['active', 'archived']).default('active'),
});
export type IcpInput = z.infer<typeof icpInputSchema>;

// --- Voice guide (structured, authored voice knowledge — migration 0033) ---------------------
// The company's voice *rules* as first-class config: tone, reading level, do/don't rules, and a
// preferred/avoided vocabulary. Authored on the Brand Voice page and rendered into every generation
// prompt alongside the retrieved exemplars. A singleton (one company — constitution §2).

export interface VoiceGuide {
  readonly tone: string;
  readonly reading_level: string;
  readonly do_rules: readonly string[];
  readonly dont_rules: readonly string[];
  readonly prefer_terms: readonly string[];
  readonly avoid_terms: readonly string[];
  readonly notes: string;
}

export const voiceGuideInputSchema = z.object({
  tone: z.string().trim().max(300).default(''),
  reading_level: z.string().trim().max(120).default(''),
  do_rules: stringList,
  dont_rules: stringList,
  prefer_terms: stringList,
  avoid_terms: stringList,
  notes: z.string().trim().max(4000).default(''),
});
export type VoiceGuideInput = z.infer<typeof voiceGuideInputSchema>;

// --- Company voice exemplars (the embedded voice corpus) -------------------------------------

export interface VoiceExemplar {
  readonly id: string;
  readonly title: string;
  readonly body_text: string;
  readonly channel: string;
  readonly source: string | null;
  readonly icp_segment_id: string | null;
  /** Whether the Bedrock embedding has been populated yet (worker-side). */
  readonly embedded: boolean;
}

const channelSchema = z
  .string()
  .trim()
  .refine((v) => v === 'any' || isArtifactType(v), {
    message: 'channel must be "any" or a known artifact type',
  });

export const voiceExemplarInputSchema = z.object({
  title: z.string().trim().max(200).default(''),
  body_text: z.string().trim().min(1).max(20000),
  channel: channelSchema.default('any'),
  source: z.string().trim().max(500).optional(),
  icp_segment_id: z.string().trim().min(1).optional(),
});
export type VoiceExemplarInput = z.infer<typeof voiceExemplarInputSchema>;

// --- Messaging claims (approved, evidence-backed positioning per ICP) ------------------------

export type MessagingClaimType = 'positioning' | 'feature_proof' | 'differentiator';
export type MessagingClaimStatus = 'draft' | 'approved' | 'archived';

export interface MessagingClaim {
  readonly id: string;
  readonly claim_text: string;
  readonly claim_type: MessagingClaimType;
  readonly evidence_url: string | null;
  readonly applies_to_icp: readonly string[];
  readonly status: MessagingClaimStatus;
}

export const messagingClaimInputSchema = z.object({
  claim_text: z.string().trim().min(1).max(2000),
  claim_type: z.enum(['positioning', 'feature_proof', 'differentiator']).default('positioning'),
  // Accept a real URL or an internal pointer (internal://…), else empty → null.
  evidence_url: z.string().trim().max(2000).optional(),
  applies_to_icp: z.array(z.string().trim().min(1)).max(20).default([]),
  status: z.enum(['draft', 'approved', 'archived']).default('approved'),
});
export type MessagingClaimInput = z.infer<typeof messagingClaimInputSchema>;
