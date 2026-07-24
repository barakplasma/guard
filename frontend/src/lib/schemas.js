import * as z from 'zod';

const PublicRelationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
});

export const TempRosterResponseSchema = z.array(z.object({
  id: z.string().min(1),
  start: z.string().min(1),
  end: z.string().min(1),
  guard: PublicRelationSchema.nullable(),
  position: PublicRelationSchema.nullable(),
}));
