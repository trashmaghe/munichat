import { describe, expect, it } from 'vitest';
import { userSummarySchema } from './user.dto';

describe('userSummarySchema', () => {
  it('accepts a valid user summary with a null avatar', () => {
    const result = userSummarySchema.parse({
      id: 'a1b2',
      username: 'jsilva',
      displayName: 'Joao Silva',
      avatarUrl: null,
    });
    expect(result.username).toBe('jsilva');
  });

  it('rejects a missing displayName field', () => {
    expect(() =>
      userSummarySchema.parse({
        id: 'a1b2',
        username: 'jsilva',
        avatarUrl: null,
      }),
    ).toThrow();
  });
});
