import { Entity } from "./abstractRepository";

/**
 * Lazy loading proxy for relationship fields
 */
export class LazyLoadingProxy<T> {
  private _loaded: boolean = false;
  private _value: T | undefined;
  private _loader: () => Promise<T>;

  constructor(loader: () => Promise<T>) {
    this._loader = loader;
  }

  /**
   * Check if the relationship has been loaded
   */
  get isLoaded(): boolean {
    return this._loaded;
  }

  /**
   * Get the value, loading it if necessary
   */
  async get(): Promise<T> {
    if (!this._loaded) {
      this._value = await this._loader();
      this._loaded = true;
    }
    return this._value!;
  }

  /**
   * Set the value directly (useful for eager loading scenarios)
   */
  set(value: T): void {
    this._value = value;
    this._loaded = true;
  }

  /**
   * Reset the proxy to unloaded state
   */
  reset(): void {
    this._loaded = false;
    this._value = undefined;
  }
}

/**
 * Utility functions for lazy loading
 */
export class LazyLoadingUtils {
  /**
   * Create a lazy loading proxy for a single entity relationship
   */
  static createSingleProxy<T extends Entity>(loader: () => Promise<T | null>): LazyLoadingProxy<T | null> {
    return new LazyLoadingProxy(loader);
  }

  /**
   * Create a lazy loading proxy for a collection relationship
   */
  static createCollectionProxy<T extends Entity>(loader: () => Promise<T[]>): LazyLoadingProxy<T[]> {
    return new LazyLoadingProxy(loader);
  }

  /**
   * Check if a value is a lazy loading proxy
   */
  static isLazyProxy(value: any): value is LazyLoadingProxy<any> {
    return value instanceof LazyLoadingProxy;
  }

  /**
   * Get the actual value from a field, loading it if it's a lazy proxy
   */
  static async getValue<T>(value: T | LazyLoadingProxy<T>): Promise<T> {
    if (LazyLoadingUtils.isLazyProxy(value)) {
      return await value.get();
    }
    return value;
  }
}