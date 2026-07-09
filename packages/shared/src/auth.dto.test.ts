import { describe, expect, it } from 'vitest';
import { currentUserResponseSchema, loginRequestSchema, loginResponseSchema } from './auth.dto';

describe('loginRequestSchema', () => {
  it('accepts a valid login request', () => {
    const result = loginRequestSchema.parse({ username: 'jsilva', password: 'hunter2' });
    expect(result.username).toBe('jsilva');
  });

  it('rejects an empty username', () => {
    expect(() => loginRequestSchema.parse({ username: '', password: 'hunter2' })).toThrow();
  });

  it('rejects an empty password', () => {
    expect(() => loginRequestSchema.parse({ username: 'jsilva', password: '' })).toThrow();
  });
});

describe('currentUserResponseSchema', () => {
  it('accepts a valid user with nullable fields present', () => {
    const result = currentUserResponseSchema.parse({
      id: 'a1b2',
      username: 'jsilva',
      displayName: 'Joao Silva',
      email: 'jsilva@nova-serrana.mg.gov.br',
      department: 'TI',
      avatarUrl: null,
      isActive: true,
    });
    expect(result.username).toBe('jsilva');
  });

  it('rejects a missing isActive field', () => {
    expect(() =>
      currentUserResponseSchema.parse({
        id: 'a1b2',
        username: 'jsilva',
        displayName: 'Joao Silva',
        email: null,
        department: null,
        avatarUrl: null,
      }),
    ).toThrow();
  });
});

describe('loginResponseSchema', () => {
  it('accepts a response wrapping a valid user', () => {
    const result = loginResponseSchema.parse({
      user: {
        id: 'a1b2',
        username: 'jsilva',
        displayName: 'Joao Silva',
        email: null,
        department: null,
        avatarUrl: null,
        isActive: true,
      },
    });
    expect(result.user.id).toBe('a1b2');
  });
});
