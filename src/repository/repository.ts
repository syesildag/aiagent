import { AbstractRepository, Constructor, Entity } from "./abstractRepository";

class Repository extends WeakMap<Constructor<Entity>, AbstractRepository<Entity>> {
   get<C extends Entity>(key: Constructor<C>): AbstractRepository<C> | undefined {
      return super.get(key) as AbstractRepository<C> | undefined;
   }
}

export const repository  = new Repository();