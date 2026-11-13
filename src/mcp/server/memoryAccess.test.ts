import { extractUserContext, isForeignMemory, resolveScopedUser } from './memoryAccess';

describe('memory access rules', () => {
  const alice = { userLogin: 'alice', isAdmin: false };
  const admin = { userLogin: 'root', isAdmin: true };
  const system = { userLogin: null, isAdmin: false };

  describe('extractUserContext', () => {
    it('reads the host-injected identity', () => {
      expect(extractUserContext({ _userLogin: 'alice', _isAdmin: false, query: 'x' })).toEqual(alice);
    });

    it('treats missing or malformed identity as no user, never admin', () => {
      expect(extractUserContext({})).toEqual(system);
      expect(extractUserContext({ _userLogin: 42, _isAdmin: 'true' })).toEqual(system);
      expect(extractUserContext(undefined)).toEqual(system);
    });
  });

  describe('resolveScopedUser', () => {
    it('confines a regular user to their own memories, ignoring user_login', () => {
      expect(resolveScopedUser(alice, 'bob')).toBe('alice');
      expect(resolveScopedUser(alice, undefined)).toBe('alice');
    });

    it('lets an admin target another user, defaulting to themselves', () => {
      expect(resolveScopedUser(admin, 'bob')).toBe('bob');
      expect(resolveScopedUser(admin, undefined)).toBe('root');
    });

    it('keeps the requested scope when no user is attached (CLI / system job)', () => {
      expect(resolveScopedUser(system, 'bob')).toBe('bob');
      expect(resolveScopedUser(system, undefined)).toBeUndefined();
    });
  });

  describe('isForeignMemory', () => {
    it("blocks a regular user from another user's or a global memory", () => {
      expect(isForeignMemory(alice, 'bob')).toBe(true);
      expect(isForeignMemory(alice, undefined)).toBe(true);
      expect(isForeignMemory(alice, 'alice')).toBe(false);
    });

    it('allows admins and system context', () => {
      expect(isForeignMemory(admin, 'bob')).toBe(false);
      expect(isForeignMemory(system, 'bob')).toBe(false);
    });
  });
});
