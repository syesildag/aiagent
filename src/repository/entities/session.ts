import { AbstractRepository, Entity } from "../abstractRepository";
import { Column } from "../annotations/Column";
import { Find } from "../annotations/find";
import { Id } from "../annotations/Id";
import { repository } from "../repository";

export class Session extends Entity {

   private id?: number;
   private name: string;
   private userLogin: string;
   private createdAt?: Date;
   private ping?: Date;

   constructor({ id, name, userLogin, createdAt, ping }: { id?: number, name: string, userLogin: string, createdAt?: Date, ping?: Date }) {
      super();
      this.id = id;
      this.name = name;
      this.userLogin = userLogin;
      this.createdAt = createdAt;
      this.ping = ping;
   }

   @Id('id')
   public getId(): number | undefined {
      return this.id;
   }

   @Column({ columnName: 'name', notNull: true, unique: true })
   public getName(): string {
      return this.name;
   }

   @Column({ columnName: 'user_login', notNull: true })
   public getUserLogin(): string {
      return this.userLogin;
   }

   @Column({ columnName: 'created_at' })
   public getCreatedAt(): Date | undefined {
      return this.createdAt;
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
      super('ai_agent_session', Session);
   }

   @Find()
   public async findByUserLogin(userLogin: string): Promise<Session | null> {
      return null;
   }}

const sessionRepository = new SessionRepository();

repository.set(Session, sessionRepository);

export default sessionRepository;