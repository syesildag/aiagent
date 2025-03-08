import { AbstractRepository, Constructor, Entity } from "./abstractRepository";

class Registry<C extends Entity> extends WeakMap<Constructor<C>, AbstractRepository<C>> {
}

export const registry  = new Registry();