import { z } from 'zod';

export const mergeManySchema = z.object({
  ids: z.array(z.string()).min(2),
  conflictPriorityIndex: z.number().default(0),
  dryRun: z.boolean().default(false),
});
