import { AbstractRepository, Entity } from "../abstractRepository";
import { Column } from "../annotations/Column";
import { Find } from "../annotations/find";
import { Id } from "../annotations/Id";
import { registry } from "../registry";

export class Session extends Entity {

   private id: number;
   private name: string;
   private username: string;
   private timestamp: Date;
   private ping?: Date;

   constructor({ id, name, username, timestamp, ping }: { id: number, name: string, username: string, timestamp: Date, ping?: Date }) {
      super();
      this.id = id;
      this.name = name;
      this.username = username;
      this.timestamp = timestamp;
      this.ping = ping;
   }

   @Id('id')
   public getId(): number {
      return this.id;
   }

   @Column({ columnName: 'name', notNull: true, unique: true })
   public getName(): string {
      return this.name;
   }

   @Column({ columnName: 'username', notNull: true })
   public getUsername(): string {
      return this.username;
   }

   @Column({ columnName: 'timestamp', notNull: true })
   public getTimestamp(): Date {
      return this.timestamp;
   }

   @Column({ columnName: 'ping' })
   public getPing(): Date | undefined {
      return this.ping;
   }

   public setPing(ping?: Date) {
      this.ping = ping;
   }
}

export class SessionRepository extends AbstractRepository<Session> {
   constructor() {
      super('session', Session);
   }

   @Find()
   public async findByUsername(username: string): Promise<Session | null> {
      return null;
   }
}

const repository = new SessionRepository();

registry.set(Session, repository);

export default repository;