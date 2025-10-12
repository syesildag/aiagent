import { AbstractRepository, Constructor, Entity } from "./abstractRepository";
import { PrimaryKey } from "./serializable";

class Repository extends WeakMap<Constructor<Entity<any>>, AbstractRepository<Entity<any>>> {
   get<C extends Entity<any>>(key: Constructor<C>): AbstractRepository<C> | undefined {
      return super.get(key) as AbstractRepository<C> | undefined;
   }
   
   set<C extends Entity<any>>(key: Constructor<C>, value: AbstractRepository<C>): this {
      return super.set(key as Constructor<Entity<any>>, value as AbstractRepository<Entity<any>>);
   }
}

export const repository = new Repository();