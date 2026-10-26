import { z } from 'zod';

/**
 * Tool 1: Create or Update a Zettel Card from a Stroke Cluster (`docs/SPEC.md` §7.2)
 */
export const CreateZettelCardToolSchema = z.object({
  anchorClusterId: z.string().uuid(),
  title: z.string().min(3).max(80),
  summaryMarkdown: z.string(),
  latexBlocks: z.array(z.string()).default([]),
  verificationState: z.enum(['unverified', 'verified', 'conflict', 'hint']),
  worldPosition: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }),
});

export type CreateZettelCardToolInput = z.infer<typeof CreateZettelCardToolSchema>;

/**
 * Tool 2: Update Async Job Badge (`docs/SPEC.md` §7.2)
 */
export const UpdateJobBadgeToolSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(['completed', 'failed']),
  badgeState: z.enum(['verified', 'conflict', 'hint_available']),
  tooltipMessage: z.string().max(140),
  linkedZettelId: z.string().uuid().optional(),
});

export type UpdateJobBadgeToolInput = z.infer<typeof UpdateJobBadgeToolSchema>;
