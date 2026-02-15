import { Entity, AbstractRepository, Constructor } from './abstractRepository';
import { Table } from './table';
import { queryDatabase } from '../utils/pgClient';
import ReflectMetadata from '../utils/reflectMetadata';
import { repository } from './repository';
import { __id__ } from './annotations/Id';
import { __columnFields__, __fieldColumn__, __notNullColumns__, __uniqueColumns__, __defaultColumns__ } from './annotations/Column';
import { __oneToOneRelations__ } from './annotations/OneToOne';
import { __oneToManyRelations__ } from './annotations/OneToMany';

// Mock dependencies
jest.mock('../utils/pgClient');
jest.mock('../utils/reflectMetadata');
jest.mock('./repository');

const mockQueryDatabase = queryDatabase as jest.MockedFunction<typeof queryDatabase>;
const mockReflectMetadata = ReflectMetadata as jest.Mocked<typeof ReflectMetadata>;
const mockRepository = repository as jest.Mocked<typeof repository>;

// Test entity classes
class TestUser extends Entity<number> {
  private id?: number;
  private username?: string;
  private email?: string;
  private age?: number;

  constructor(params?: { id?: number; username?: string; email?: string; age?: number }) {
    super();
    this.id = params?.id;
    this.username = params?.username;
    this.email = params?.email;
    this.age = params?.age;
  }

  getId(): number | undefined {
    return this.id;
  }

  getUsername(): string | undefined {
    return this.username;
  }

  getEmail(): string | undefined {
    return this.email;
  }

  getAge(): number | undefined {
    return this.age;
  }
}

class TestUserRepository extends AbstractRepository<TestUser> {
  constructor() {
    super('ai_agent_user' as Table, TestUser);
  }
}

describe('AbstractRepository', () => {
  let userRepository: TestUserRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock repository.get method
    (mockRepository.get as jest.Mock) = jest.fn();
    
    // Setup default metadata
    mockReflectMetadata.getMetadata.mockImplementation((key: any, target: any) => {
      if (key === __id__) return 'id';
      if (key === __fieldColumn__) return {
        id: 'id',
        username: 'username',
        email: 'email',
        age: 'age'
      };
      if (key === __columnFields__) return {
        id: 'id',
        username: 'username',
        email: 'email',
        age: 'age'
      };
      if (key === __uniqueColumns__) return new Set(['email']);
      if (key === __notNullColumns__) return new Set(['username', 'email']);
      if (key === __defaultColumns__) return new Set<string>();
      if (key === __oneToOneRelations__) return new Map();
      if (key === __oneToManyRelations__) return new Map();
      return undefined;
    });

    userRepository = new TestUserRepository();
  });

  describe('Entity base class', () => {
    it('should save entity through repository', async () => {
      const user = new TestUser({ username: 'john', email: 'john@example.com' });
      const savedUser = new TestUser({ id: 1, username: 'john', email: 'john@example.com' });

      mockRepository.get.mockReturnValue(userRepository);
      mockQueryDatabase.mockResolvedValue([{ id: 1, username: 'john', email: 'john@example.com' }]);

      const result = await user.save();
      expect(result).toBeDefined();
      expect(mockRepository.get).toHaveBeenCalledWith(TestUser);
    });

    it('should delete entity through repository', async () => {
      const user = new TestUser({ id: 1, username: 'john', email: 'john@example.com' });

      mockRepository.get.mockReturnValue(userRepository);
      mockQueryDatabase.mockResolvedValue([]);

      await user.delete();
      expect(mockRepository.get).toHaveBeenCalledWith(TestUser);
    });

    it('should handle save when repository not found', async () => {
      const user = new TestUser({ username: 'john', email: 'john@example.com' });
      mockRepository.get.mockReturnValue(undefined);

      const result = await user.save();
      expect(result).toBeUndefined();
    });

    it('should handle delete when repository not found', async () => {
      const user = new TestUser({ id: 1, username: 'john', email: 'john@example.com' });
      mockRepository.get.mockReturnValue(undefined);

      await expect(user.delete()).resolves.not.toThrow();
    });
  });

  describe('Metadata methods', () => {
    describe('getColumnName', () => {
      it('should return column name for field name', () => {
        expect(userRepository.getColumnName('username')).toBe('username');
        expect(userRepository.getColumnName('email')).toBe('email');
      });

      it('should return undefined for unknown field', () => {
        expect(userRepository.getColumnName('unknownField')).toBeUndefined();
      });
    });

    describe('getFieldName', () => {
      it('should return field name for column name', () => {
        expect(userRepository.getFieldName('username')).toBe('username');
        expect(userRepository.getFieldName('email')).toBe('email');
      });

      it('should handle ID column', () => {
        expect(userRepository.getFieldName('id')).toBe('id');
      });

      it('should return undefined for unmapped column', () => {
        expect(userRepository.getFieldName('unknown_column')).toBeUndefined();
      });
    });

    describe('getUniqueColumns', () => {
      it('should return array of unique columns', () => {
        const uniqueColumns = userRepository.getUniqueColumns();
        expect(uniqueColumns).toEqual(['email']);
        expect(Array.isArray(uniqueColumns)).toBe(true);
      });
    });

    describe('getNotNullColumns', () => {
      it('should return array of not-null columns', () => {
        const notNullColumns = userRepository.getNotNullColumns();
        expect(notNullColumns).toEqual(['username', 'email']);
        expect(Array.isArray(notNullColumns)).toBe(true);
      });
    });

    describe('getOneToOneRelations', () => {
      it('should return OneToOne relationship metadata', () => {
        const relations = userRepository.getOneToOneRelations();
        expect(relations).toBeInstanceOf(Map);
      });
    });

    describe('getOneToManyRelations', () => {
      it('should return OneToMany relationship metadata', () => {
        const relations = userRepository.getOneToManyRelations();
        expect(relations).toBeInstanceOf(Map);
      });
    });
  });

  describe('save', () => {
    it('should insert new entity', async () => {
      const user = new TestUser({ username: 'john', email: 'john@example.com', age: 30 });
      mockQueryDatabase.mockResolvedValue([{ id: 1, username: 'john', email: 'john@example.com', age: 30 }]);

      const result = await userRepository.save(user);
      
      expect(mockQueryDatabase).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.any(Array)
      );
      expect(result).toBeInstanceOf(TestUser);
      expect(result.getId()).toBe(1);
    });

    it('should update existing entity', async () => {
      const user = new TestUser({ id: 1, username: 'john', email: 'john@example.com', age: 31 });
      mockQueryDatabase.mockResolvedValue([{ id: 1, username: 'john', email: 'john@example.com', age: 31 }]);

      const result = await userRepository.save(user);
      
      expect(mockQueryDatabase).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        expect.any(Array)
      );
      expect(result).toBeInstanceOf(TestUser);
    });

    it('should handle save errors', async () => {
      const user = new TestUser({ username: 'john', email: 'john@example.com' });
      mockQueryDatabase.mockRejectedValue(new Error('Database error'));

      await expect(userRepository.save(user)).rejects.toThrow('Database error');
    });
  });

  describe('getById', () => {
    it('should fetch entity by ID', async () => {
      mockQueryDatabase.mockResolvedValue([{ id: 1, username: 'john', email: 'john@example.com' }]);

      const result = await userRepository.getById(1);
      
      expect(mockQueryDatabase).toHaveBeenCalledWith(
        expect.stringMatching(/SELECT.*FROM.*ai_agent_user/s),
        [1]
      );
      expect(result).toBeInstanceOf(TestUser);
      expect(result?.getId()).toBe(1);
    });

    it('should return null when entity not found', async () => {
      mockQueryDatabase.mockResolvedValue([]);

      const result = await userRepository.getById(999);
      expect(result).toBeNull();
    });

    it('should handle query errors', async () => {
      mockQueryDatabase.mockRejectedValue(new Error('Database error'));

      await expect(userRepository.getById(1)).rejects.toThrow('Database error');
    });
  });

  describe('getByUniqueValues', () => {
    it('should fetch entity by unique column values', async () => {
      mockQueryDatabase.mockResolvedValue([{ id: 1, username: 'john', email: 'john@example.com' }]);

      const result = await userRepository.getByUniqueValues('john@example.com');
      
      expect(result).toBeInstanceOf(TestUser);
      expect(result?.getEmail()).toBe('john@example.com');
    });

    it('should return null when no entity found', async () => {
      mockQueryDatabase.mockResolvedValue([]);

      const result = await userRepository.getByUniqueValues('nonexistent@example.com');
      expect(result).toBeNull();
    });
  });

  describe('getByFieldValues', () => {
    it('should fetch entities by field values', async () => {
      mockQueryDatabase.mockResolvedValue([
        { id: 1, username: 'john', email: 'john@example.com', age: 30 },
        { id: 2, username: 'jane', email: 'jane@example.com', age: 30 }
      ]);

      const result = await userRepository.getByFieldValues({ age: 30 });
      
      expect(result).toHaveLength(2);
      expect(result?.[0]).toBeInstanceOf(TestUser);
    });

    it('should support orderBy option', async () => {
      mockQueryDatabase.mockResolvedValue([{ id: 1, username: 'john', email: 'john@example.com' }]);

      await userRepository.getByFieldValues(
        { age: 30 },
        { orderBy: [{ field: 'username', direction: 'ASC' }] }
      );
      
      expect(mockQueryDatabase).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY'),
        expect.any(Array)
      );
    });

    it('should support limit option', async () => {
      mockQueryDatabase.mockResolvedValue([{ id: 1, username: 'john', email: 'john@example.com' }]);

      await userRepository.getByFieldValues(
        { age: 30 },
        { limit: 10 }
      );
      
      expect(mockQueryDatabase).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.any(Array)
      );
    });

    it('should support offset option', async () => {
      mockQueryDatabase.mockResolvedValue([{ id: 1, username: 'john', email: 'john@example.com' }]);

      await userRepository.getByFieldValues(
        { age: 30 },
        { offset: 10 }
      );
      
      expect(mockQueryDatabase).toHaveBeenCalledWith(
        expect.stringContaining('OFFSET'),
        expect.any(Array)
      );
    });

    it('should throw on query error', async () => {
      mockQueryDatabase.mockRejectedValue(new Error('Query failed'));

      await expect(userRepository.getByFieldValues({ age: 30 })).rejects.toThrow('Query failed');
    });
  });

  describe('findAll', () => {
    it('should fetch all entities', async () => {
      mockQueryDatabase.mockResolvedValue([
        { id: 1, username: 'john', email: 'john@example.com' },
        { id: 2, username: 'jane', email: 'jane@example.com' }
      ]);

      const result = await userRepository.findAll();
      
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(TestUser);
      expect(result[1]).toBeInstanceOf(TestUser);
    });

    it('should support orderBy option', async () => {
      mockQueryDatabase.mockResolvedValue([]);

      await userRepository.findAll({
        orderBy: [{ field: 'username', direction: 'DESC' }]
      });
      
      expect(mockQueryDatabase).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY'),
        expect.any(Array)
      );
    });

    it('should support limit option', async () => {
      mockQueryDatabase.mockResolvedValue([]);

      await userRepository.findAll({ limit: 5 });
      
      expect(mockQueryDatabase).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.any(Array)
      );
    });

    it('should support offset option', async () => {
      mockQueryDatabase.mockResolvedValue([]);

      await userRepository.findAll({ offset: 10 });
      
      expect(mockQueryDatabase).toHaveBeenCalledWith(
        expect.stringContaining('OFFSET'),
        expect.any(Array)
      );
    });

    it('should return empty array when no entities found', async () => {
      mockQueryDatabase.mockResolvedValue([]);

      const result = await userRepository.findAll();
      expect(result).toEqual([]);
    });

    it('should handle query errors', async () => {
      mockQueryDatabase.mockRejectedValue(new Error('Database error'));

      await expect(userRepository.findAll()).rejects.toThrow('Database error');
    });
  });

  describe('deleteById', () => {
    it('should delete entity by ID', async () => {
      mockQueryDatabase
        .mockResolvedValueOnce([{ id: 1, username: 'john', email: 'john@example.com' }])
        .mockResolvedValueOnce([]);

      await userRepository.deleteById(1);
      
      expect(mockQueryDatabase).toHaveBeenCalledTimes(2);
    });

    it('should throw error when entity not found', async () => {
      mockQueryDatabase.mockResolvedValue([]);

      await expect(userRepository.deleteById(999)).rejects.toThrow('Entity with ID 999 not found');
    });

    it('should handle delete errors', async () => {
      mockQueryDatabase
        .mockResolvedValueOnce([{ id: 1, username: 'john', email: 'john@example.com' }])
        .mockRejectedValueOnce(new Error('Database error'));

      await expect(userRepository.deleteById(1)).rejects.toThrow('Database error');
    });
  });

  describe('delete', () => {
    it('should delete entity', async () => {
      const user = new TestUser({ id: 1, username: 'john', email: 'john@example.com' });
      mockQueryDatabase.mockResolvedValue([]);

      await userRepository.delete(user);
      
      expect(mockQueryDatabase).toHaveBeenCalled();
    });

    it('should handle entity without ID', async () => {
      const user = new TestUser({ username: 'john', email: 'john@example.com' });
      mockQueryDatabase.mockResolvedValue([]);

      await expect(userRepository.delete(user)).rejects.toThrow('Cannot delete entity without ID');
    });
  });

  describe('deleteAll', () => {
    it('should delete all entities', async () => {
      mockQueryDatabase.mockResolvedValue([]);

      await userRepository.deleteAll();
      
      expect(mockQueryDatabase).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM')
      );
    });

    it('should handle delete errors', async () => {
      mockQueryDatabase.mockRejectedValue(new Error('Database error'));

      await expect(userRepository.deleteAll()).rejects.toThrow('Database error');
    });
  });

  describe('truncate', () => {
    it('should truncate table', async () => {
      mockQueryDatabase.mockResolvedValue([]);

      await userRepository.truncate();
      
      expect(mockQueryDatabase).toHaveBeenCalledWith(
        expect.stringContaining('TRUNCATE')
      );
    });

    it('should handle truncate errors', async () => {
      mockQueryDatabase.mockRejectedValue(new Error('Database error'));

      await expect(userRepository.truncate()).rejects.toThrow('Database error');
    });
  });

  describe('getByColumnValues', () => {
    it('should fetch entities by column values', async () => {
      mockQueryDatabase.mockResolvedValue([
        { id: 1, username: 'john', email: 'john@example.com' }
      ]);

      const result = await userRepository.getByColumnValues({ username: 'john' });
      
      expect(result).toHaveLength(1);
      expect(result?.[0]).toBeInstanceOf(TestUser);
    });

    it('should handle unique flag', async () => {
      mockQueryDatabase.mockResolvedValue([
        { id: 1, username: 'john', email: 'john@example.com' }
      ]);

      const result = await userRepository.getByColumnValues({ email: 'john@example.com' }, true);
      
      expect(result).toHaveLength(1);
    });

    it('should return null when no entities found', async () => {
      mockQueryDatabase.mockResolvedValue([]);

      const result = await userRepository.getByColumnValues({ username: 'nonexistent' });
      expect(result).toBeNull();
    });

    it('should throw on query errors', async () => {
      mockQueryDatabase.mockRejectedValue(new Error('Database error'));

      await expect(userRepository.getByColumnValues({ username: 'john' })).rejects.toThrow('Database error');
    });
  });

  describe('Edge cases', () => {
    it('should handle entity with null values', async () => {
      const user = new TestUser({ username: 'john', email: 'john@example.com', age: undefined });
      mockQueryDatabase.mockResolvedValue([{ id: 1, username: 'john', email: 'john@example.com', age: null }]);

      const result = await userRepository.save(user);
      expect(result).toBeDefined();
    });

    it('should handle database returning empty array', async () => {
      mockQueryDatabase.mockResolvedValue([]);

      const result = await userRepository.getById(1);
      expect(result).toBeNull();
    });

    it('should handle multiple orderBy clauses', async () => {
      mockQueryDatabase.mockResolvedValue([]);

      await userRepository.findAll({
        orderBy: [
          { field: 'username', direction: 'ASC' },
          { field: 'email', direction: 'DESC' }
        ]
      });
      
      expect(mockQueryDatabase).toHaveBeenCalled();
    });

    it('should handle complex field values query', async () => {
      mockQueryDatabase.mockResolvedValue([]);

      await userRepository.getByFieldValues({
        username: 'john',
        age: 30
      }, {
        orderBy: [{ field: 'email', direction: 'ASC' }],
        limit: 10,
        offset: 5
      });
      
      expect(mockQueryDatabase).toHaveBeenCalled();
    });
  });
});
