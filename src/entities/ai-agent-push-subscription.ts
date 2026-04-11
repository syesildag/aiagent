import { AbstractRepository, Entity } from "../repository/abstractRepository";
import { Column } from "../repository/annotations/Column";
import { Find } from "../repository/annotations/find";
import { Id } from "../repository/annotations/Id";
import { repository } from "../repository/repository";

export class AiAgentPushSubscription extends Entity<number> {

   private id?: number;
   private endpoint: string;
   private p256dh: string;
   private auth: string;
   private createdAt?: Date;

   constructor({ id, endpoint, p256dh, auth, createdAt }: {
      id?: number;
      endpoint: string;
      p256dh: string;
      auth: string;
      createdAt?: Date;
   }) {
      super();
      this.id = id;
      this.endpoint = endpoint;
      this.p256dh = p256dh;
      this.auth = auth;
      this.createdAt = createdAt;
   }

   @Id('id')
   public getId(): number | undefined {
      return this.id;
   }

   @Column({ columnName: 'endpoint', notNull: true, unique: true })
   public getEndpoint(): string {
      return this.endpoint;
   }

   @Column({ columnName: 'p256dh', notNull: true })
   public getP256dh(): string {
      return this.p256dh;
   }

   @Column({ columnName: 'auth', notNull: true })
   public getAuth(): string {
      return this.auth;
   }

   @Column({ columnName: 'created_at', notNull: true, hasDefault: true })
   public getCreatedAt(): Date | undefined {
      return this.createdAt;
   }

}

class AiAgentPushSubscriptionRepository extends AbstractRepository<AiAgentPushSubscription> {

   constructor() {
      super('ai_agent_push_subscriptions', AiAgentPushSubscription);
   }

   @Find()
   public async findByEndpoint(_endpoint: string): Promise<AiAgentPushSubscription | null> {
      return null;
   }

   public async deleteByEndpoint(endpoint: string): Promise<void> {
      const sub = await this.findByEndpoint(endpoint);
      if (sub) await sub.delete();
   }

}

const aiAgentPushSubscriptionRepository = new AiAgentPushSubscriptionRepository();
repository.set(AiAgentPushSubscription, aiAgentPushSubscriptionRepository);
export default aiAgentPushSubscriptionRepository;
