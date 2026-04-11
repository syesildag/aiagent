import { AbstractRepository, Entity } from "../repository/abstractRepository";
import { Column } from "../repository/annotations/Column";
import { Id } from "../repository/annotations/Id";
import { repository } from "../repository/repository";
import { queryDatabase } from "../utils/pgClient";

export class AiAgentScheduledPushNotification extends Entity<string> {

   private id: string;
   private endpoint: string;
   private title: string;
   private body: string;
   private icon?: string;
   private url?: string;
   private fireAt: Date;
   private createdAt?: Date;

   constructor({ id, endpoint, title, body, icon, url, fireAt, createdAt }: {
      id: string;
      endpoint: string;
      title: string;
      body: string;
      icon?: string;
      url?: string;
      fireAt: Date;
      createdAt?: Date;
   }) {
      super();
      this.id = id;
      this.endpoint = endpoint;
      this.title = title;
      this.body = body;
      this.icon = icon;
      this.url = url;
      this.fireAt = fireAt;
      this.createdAt = createdAt;
   }

   @Id('id')
   public getId(): string {
      return this.id;
   }

   @Column({ columnName: 'endpoint', notNull: true })
   public getEndpoint(): string {
      return this.endpoint;
   }

   @Column({ columnName: 'title', notNull: true })
   public getTitle(): string {
      return this.title;
   }

   @Column({ columnName: 'body', notNull: true })
   public getBody(): string {
      return this.body;
   }

   @Column({ columnName: 'icon' })
   public getIcon(): string | undefined {
      return this.icon;
   }

   @Column({ columnName: 'url' })
   public getUrl(): string | undefined {
      return this.url;
   }

   @Column({ columnName: 'fire_at', notNull: true })
   public getFireAt(): Date {
      return this.fireAt;
   }

   @Column({ columnName: 'created_at', notNull: true, hasDefault: true })
   public getCreatedAt(): Date | undefined {
      return this.createdAt;
   }

}

class AiAgentScheduledPushNotificationRepository extends AbstractRepository<AiAgentScheduledPushNotification> {

   constructor() {
      super('ai_agent_scheduled_push_notifications', AiAgentScheduledPushNotification);
   }

   /** Returns all notifications whose fire_at is at or before the given timestamp. */
   public async findDue(now: Date): Promise<AiAgentScheduledPushNotification[]> {
      const rows = await queryDatabase(
         `SELECT id, endpoint, title, body, icon, url, fire_at, created_at
            FROM ai_agent_scheduled_push_notifications
           WHERE fire_at <= $1
           ORDER BY fire_at ASC`,
         [now],
      );
      return rows.map((r: any) => new AiAgentScheduledPushNotification({
         id: r.id,
         endpoint: r.endpoint,
         title: r.title,
         body: r.body,
         icon: r.icon ?? undefined,
         url: r.url ?? undefined,
         fireAt: r.fire_at,
         createdAt: r.created_at,
      }));
   }

}

const aiAgentScheduledPushNotificationRepository = new AiAgentScheduledPushNotificationRepository();
repository.set(AiAgentScheduledPushNotification, aiAgentScheduledPushNotificationRepository);
export default aiAgentScheduledPushNotificationRepository;
