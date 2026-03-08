import { AbstractRepository, Entity } from "../repository/abstractRepository";
import { Column } from "../repository/annotations/Column";
import { Find } from "../repository/annotations/find";
import { Id } from "../repository/annotations/Id";
import { repository } from "../repository/repository";

export class AiAgentJob extends Entity {

   private id?: number;
   private name: string;
   private enabled: boolean;
   private params?: Record<string, unknown>;
   private lastRunAt?: Date;
   private createdAt?: Date;
   private updatedAt?: Date;

   constructor({ id, name, enabled, params, lastRunAt, createdAt, updatedAt }: {
      id?: number;
      name: string;
      enabled: boolean;
      params?: Record<string, unknown>;
      lastRunAt?: Date;
      createdAt?: Date;
      updatedAt?: Date;
   }) {
      super();
      this.id = id;
      this.name = name;
      this.enabled = enabled;
      this.params = params;
      this.lastRunAt = lastRunAt;
      this.createdAt = createdAt;
      this.updatedAt = updatedAt;
   }

   @Id('id')
   public getId(): number | undefined {
      return this.id;
   }

   @Column({ columnName: 'name', notNull: true, unique: true })
   public getName(): string {
      return this.name;
   }

   @Column({ columnName: 'enabled', notNull: true, hasDefault: true })
   public getEnabled(): boolean {
      return this.enabled;
   }

   @Column({ columnName: 'params' })
   public getParams(): Record<string, unknown> | undefined {
      return this.params;
   }

   @Column({ columnName: 'last_run_at' })
   public getLastRunAt(): Date | undefined {
      return this.lastRunAt;
   }

   @Column({ columnName: 'created_at', notNull: true, hasDefault: true })
   public getCreatedAt(): Date | undefined {
      return this.createdAt;
   }

   @Column({ columnName: 'updated_at', notNull: true, hasDefault: true })
   public getUpdatedAt(): Date | undefined {
      return this.updatedAt;
   }

   public setEnabled(enabled: boolean) {
      this.enabled = enabled;
   }

   public setLastRunAt(lastRunAt: Date) {
      this.lastRunAt = lastRunAt;
   }

}

class AiAgentJobRepository extends AbstractRepository<AiAgentJob> {

   constructor() {
      super('ai_agent_jobs', AiAgentJob);
   }

   @Find()
   public async findByName(_name: string): Promise<AiAgentJob | null> {
      return null;
   }

}

const aiAgentJobRepository = new AiAgentJobRepository();
repository.set(AiAgentJob, aiAgentJobRepository);
export default aiAgentJobRepository;
