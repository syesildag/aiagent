import { LazyLoadingProxy, LazyLoadingUtils } from './lazyLoading';
import { Entity } from './abstractRepository';

// Mock Entity class for testing
class MockEntity extends Entity<number> {
  constructor(private id: number) {
    super();
  }

  getId(): number {
    return this.id;
  }
}

describe('LazyLoadingProxy', () => {
  describe('constructor', () => {
    it('should initialize with unloaded state', () => {
      const loader = jest.fn(async () => new MockEntity(1));
      const proxy = new LazyLoadingProxy(loader);

      expect(proxy.isLoaded).toBe(false);
    });
  });

  describe('isLoaded', () => {
    it('should return false before loading', () => {
      const loader = jest.fn(async () => new MockEntity(1));
      const proxy = new LazyLoadingProxy(loader);

      expect(proxy.isLoaded).toBe(false);
    });

    it('should return true after loading', async () => {
      const loader = jest.fn(async () => new MockEntity(1));
      const proxy = new LazyLoadingProxy(loader);

      await proxy.get();

      expect(proxy.isLoaded).toBe(true);
    });

    it('should return true after setting value', () => {
      const loader = jest.fn(async () => new MockEntity(1));
      const proxy = new LazyLoadingProxy(loader);

      proxy.set(new MockEntity(2));

      expect(proxy.isLoaded).toBe(true);
    });
  });

  describe('get', () => {
    it('should load value on first access', async () => {
      const entity = new MockEntity(1);
      const loader = jest.fn(async () => entity);
      const proxy = new LazyLoadingProxy(loader);

      const result = await proxy.get();

      expect(result).toBe(entity);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should cache loaded value', async () => {
      const entity = new MockEntity(1);
      const loader = jest.fn(async () => entity);
      const proxy = new LazyLoadingProxy(loader);

      const result1 = await proxy.get();
      const result2 = await proxy.get();
      const result3 = await proxy.get();

      expect(result1).toBe(entity);
      expect(result2).toBe(entity);
      expect(result3).toBe(entity);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should handle null values', async () => {
      const loader = jest.fn(async () => null);
      const proxy = new LazyLoadingProxy<MockEntity | null>(loader);

      const result = await proxy.get();

      expect(result).toBeNull();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should handle loading errors', async () => {
      const error = new Error('Load failed');
      const loader = jest.fn(async () => {
        throw error;
      });
      const proxy = new LazyLoadingProxy(loader);

      await expect(proxy.get()).rejects.toThrow('Load failed');
    });

    it('should handle async loader functions', async () => {
      const loader = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return new MockEntity(1);
      });
      const proxy = new LazyLoadingProxy(loader);

      const result = await proxy.get();

      expect(result).toBeInstanceOf(MockEntity);
      expect(result.getId()).toBe(1);
    });
  });

  describe('set', () => {
    it('should set value directly', () => {
      const entity = new MockEntity(1);
      const loader = jest.fn(async () => new MockEntity(2));
      const proxy = new LazyLoadingProxy(loader);

      proxy.set(entity);

      expect(proxy.isLoaded).toBe(true);
    });

    it('should not call loader when value is set directly', async () => {
      const entity = new MockEntity(1);
      const loader = jest.fn(async () => new MockEntity(2));
      const proxy = new LazyLoadingProxy(loader);

      proxy.set(entity);
      const result = await proxy.get();

      expect(result).toBe(entity);
      expect(loader).not.toHaveBeenCalled();
    });

    it('should override loader value', async () => {
      const loaderEntity = new MockEntity(1);
      const setEntity = new MockEntity(2);
      const loader = jest.fn(async () => loaderEntity);
      const proxy = new LazyLoadingProxy(loader);

      proxy.set(setEntity);
      const result = await proxy.get();

      expect(result).toBe(setEntity);
      expect(result.getId()).toBe(2);
    });

    it('should allow setting null', () => {
      const loader = jest.fn(async () => new MockEntity(1));
      const proxy = new LazyLoadingProxy<MockEntity | null>(loader);

      proxy.set(null);

      expect(proxy.isLoaded).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset proxy to unloaded state', async () => {
      const loader = jest.fn(async () => new MockEntity(1));
      const proxy = new LazyLoadingProxy(loader);

      await proxy.get();
      expect(proxy.isLoaded).toBe(true);

      proxy.reset();

      expect(proxy.isLoaded).toBe(false);
    });

    it('should reload value after reset', async () => {
      let counter = 0;
      const loader = jest.fn(async () => new MockEntity(++counter));
      const proxy = new LazyLoadingProxy(loader);

      const result1 = await proxy.get();
      expect(result1.getId()).toBe(1);

      proxy.reset();

      const result2 = await proxy.get();
      expect(result2.getId()).toBe(2);
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it('should clear cached value', async () => {
      const entity = new MockEntity(1);
      const loader = jest.fn(async () => entity);
      const proxy = new LazyLoadingProxy(loader);

      await proxy.get();
      proxy.reset();

      expect(proxy.isLoaded).toBe(false);
    });
  });
});

describe('LazyLoadingUtils', () => {
  describe('createSingleProxy', () => {
    it('should create a proxy for single entity', async () => {
      const entity = new MockEntity(1);
      const loader = jest.fn(async () => entity);
      
      const proxy = LazyLoadingUtils.createSingleProxy(loader);

      expect(proxy).toBeInstanceOf(LazyLoadingProxy);
      expect(proxy.isLoaded).toBe(false);
    });

    it('should create a proxy that loads entity', async () => {
      const entity = new MockEntity(1);
      const loader = jest.fn(async () => entity);
      
      const proxy = LazyLoadingUtils.createSingleProxy(loader);
      const result = await proxy.get();

      expect(result).toBe(entity);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should handle null entity', async () => {
      const loader = jest.fn(async () => null);
      
      const proxy = LazyLoadingUtils.createSingleProxy(loader);
      const result = await proxy.get();

      expect(result).toBeNull();
    });
  });

  describe('createCollectionProxy', () => {
    it('should create a proxy for entity collection', async () => {
      const entities = [new MockEntity(1), new MockEntity(2)];
      const loader = jest.fn(async () => entities);
      
      const proxy = LazyLoadingUtils.createCollectionProxy(loader);

      expect(proxy).toBeInstanceOf(LazyLoadingProxy);
      expect(proxy.isLoaded).toBe(false);
    });

    it('should create a proxy that loads collection', async () => {
      const entities = [new MockEntity(1), new MockEntity(2), new MockEntity(3)];
      const loader = jest.fn(async () => entities);
      
      const proxy = LazyLoadingUtils.createCollectionProxy(loader);
      const result = await proxy.get();

      expect(result).toBe(entities);
      expect(result).toHaveLength(3);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should handle empty collection', async () => {
      const loader = jest.fn(async () => []);
      
      const proxy = LazyLoadingUtils.createCollectionProxy(loader);
      const result = await proxy.get();

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('isLazyProxy', () => {
    it('should return true for LazyLoadingProxy instances', () => {
      const loader = jest.fn(async () => new MockEntity(1));
      const proxy = new LazyLoadingProxy(loader);

      expect(LazyLoadingUtils.isLazyProxy(proxy)).toBe(true);
    });

    it('should return false for non-proxy values', () => {
      expect(LazyLoadingUtils.isLazyProxy(null)).toBe(false);
      expect(LazyLoadingUtils.isLazyProxy(undefined)).toBe(false);
      expect(LazyLoadingUtils.isLazyProxy(new MockEntity(1))).toBe(false);
      expect(LazyLoadingUtils.isLazyProxy({})).toBe(false);
      expect(LazyLoadingUtils.isLazyProxy([])).toBe(false);
      expect(LazyLoadingUtils.isLazyProxy('string')).toBe(false);
      expect(LazyLoadingUtils.isLazyProxy(123)).toBe(false);
    });

    it('should return true for both single and collection proxies', () => {
      const singleProxy = LazyLoadingUtils.createSingleProxy(async () => new MockEntity(1));
      const collectionProxy = LazyLoadingUtils.createCollectionProxy(async () => [new MockEntity(1)]);

      expect(LazyLoadingUtils.isLazyProxy(singleProxy)).toBe(true);
      expect(LazyLoadingUtils.isLazyProxy(collectionProxy)).toBe(true);
    });
  });

  describe('getValue', () => {
    it('should return value directly if not a proxy', async () => {
      const entity = new MockEntity(1);

      const result = await LazyLoadingUtils.getValue(entity);

      expect(result).toBe(entity);
    });

    it('should load value if it is a proxy', async () => {
      const entity = new MockEntity(1);
      const loader = jest.fn(async () => entity);
      const proxy = new LazyLoadingProxy(loader);

      const result = await LazyLoadingUtils.getValue(proxy);

      expect(result).toBe(entity);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should handle null values', async () => {
      const result = await LazyLoadingUtils.getValue(null);

      expect(result).toBeNull();
    });

    it('should handle primitive values', async () => {
      expect(await LazyLoadingUtils.getValue(123)).toBe(123);
      expect(await LazyLoadingUtils.getValue('test')).toBe('test');
      expect(await LazyLoadingUtils.getValue(true)).toBe(true);
    });

    it('should handle array values', async () => {
      const array = [new MockEntity(1), new MockEntity(2)];

      const result = await LazyLoadingUtils.getValue(array);

      expect(result).toBe(array);
      expect(result).toHaveLength(2);
    });

    it('should handle collection proxy', async () => {
      const entities = [new MockEntity(1), new MockEntity(2)];
      const loader = jest.fn(async () => entities);
      const proxy = LazyLoadingUtils.createCollectionProxy(loader);

      const result = await LazyLoadingUtils.getValue(proxy);

      expect(result).toBe(entities);
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe('Integration tests', () => {
    it('should work with entity relationships', async () => {
      // Simulate a user entity with a lazy-loaded profile
      const userEntity = new MockEntity(1);
      const profileEntity = new MockEntity(100);
      
      const profileLoader = jest.fn(async () => profileEntity);
      const profileProxy = LazyLoadingUtils.createSingleProxy(profileLoader);

      // Access the relationship
      const profile = await profileProxy.get();

      expect(profile).toBe(profileEntity);
      expect(profileLoader).toHaveBeenCalledTimes(1);

      // Access again (should use cache)
      const profile2 = await profileProxy.get();
      
      expect(profile2).toBe(profileEntity);
      expect(profileLoader).toHaveBeenCalledTimes(1);
    });

    it('should work with collection relationships', async () => {
      // Simulate a user entity with lazy-loaded posts
      const userEntity = new MockEntity(1);
      const posts = [new MockEntity(10), new MockEntity(20), new MockEntity(30)];
      
      const postsLoader = jest.fn(async () => posts);
      const postsProxy = LazyLoadingUtils.createCollectionProxy(postsLoader);

      // Access the collection
      const loadedPosts = await postsProxy.get();

      expect(loadedPosts).toBe(posts);
      expect(loadedPosts).toHaveLength(3);
      expect(postsLoader).toHaveBeenCalledTimes(1);
    });

    it('should support eager loading by setting values', async () => {
      const eagerEntity = new MockEntity(5);
      const lazyLoader = jest.fn(async () => new MockEntity(10));
      
      const proxy = LazyLoadingUtils.createSingleProxy(lazyLoader);
      
      // Eagerly load
      proxy.set(eagerEntity);
      
      // Get value (should not call loader)
      const result = await proxy.get();
      
      expect(result).toBe(eagerEntity);
      expect(lazyLoader).not.toHaveBeenCalled();
    });
  });
});
