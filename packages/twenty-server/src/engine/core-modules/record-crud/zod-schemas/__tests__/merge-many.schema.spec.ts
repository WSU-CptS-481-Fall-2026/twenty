import { mergeManySchema } from '../merge-many.schema';

describe('mergeManySchema', () => {
  it('requires at least two ids', () => {
    const result = mergeManySchema.safeParse({
      ids: ['one'],
    });

    expect(result.success).toBe(false);
  });

  it('accepts two or more ids', () => {
    const result = mergeManySchema.safeParse({
      ids: ['one', 'two'],
    });

    expect(result.success).toBe(true);
  });

  it('defaults conflictPriorityIndex to 0', () => {
    const result = mergeManySchema.parse({
      ids: ['a', 'b'],
    });

    expect(result.conflictPriorityIndex).toBe(0);
  });

  it('defaults dryRun to false', () => {
    const result = mergeManySchema.parse({
      ids: ['a', 'b'],
    });

    expect(result.dryRun).toBe(false);
  });

  it('allows explicit conflictPriorityIndex and dryRun', () => {
    const result = mergeManySchema.parse({
      ids: ['a', 'b', 'c'],
      conflictPriorityIndex: 2,
      dryRun: true,
    });

    expect(result.conflictPriorityIndex).toBe(2);
    expect(result.dryRun).toBe(true);
  });
});
