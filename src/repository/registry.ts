import { AbstractRepository, Constructor, Entity } from "./abstractRepository";

export const registry: WeakMap<Constructor<Entity>, AbstractRepository<Entity>>  = new WeakMap();