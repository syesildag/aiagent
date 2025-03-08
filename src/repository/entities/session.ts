import { AbstractRepository, Entity } from "../abstractRepository";
import { Column } from "../annotations/Column";
import { Id } from "../annotations/Id";
import { registry } from "../registry";

export class Session implements Entity {

   private id: number;
   private name: string;
   private username: string;
   private timestamp: Date;
   private ping?: Date;

   constructor({ id, name, username, timestamp, ping }: { id: number, name: string, username: string, timestamp: Date, ping?: Date }) {
      this.id = id;
      this.name = name;
      this.username = username;
      this.timestamp = timestamp;
      this.ping = ping;
   }

   @Id('id')
   getId(): number {
      return this.id;
   }

   @Column({ columnName: 'name', notNull: true, unique: true })
   getName(): string {
      return this.name;
   }

   @Column({ columnName: 'username', notNull: true })
   getUsername(): string {
      return this.username;
   }

   @Column({ columnName: 'timestamp', notNull: true })
   getTimestamp(): Date {
      return this.timestamp;
   }

   @Column({ columnName: 'ping' })
   getPing(): Date {
      return this.ping;
   }
}

class SessionRepository extends AbstractRepository<Session> {
   constructor() {
      super('session', Session);
   }
}

const repository = new SessionRepository();

registry.set(Session, repository);

export default repository;