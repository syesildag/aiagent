# Job System

## Overview

The Job System provides scheduled task execution using `node-schedule`. It supports cron-like scheduling, recurrence rules, and worker threads for background processing.

## Architecture

### Components

1. **JobFactory** - Abstract base class for jobs
2. **ThreadJobFactory** - Jobs that run in worker threads
3. **Worker Pool** - Manages worker thread lifecycle
4. **Scheduler** - node-schedule integration

### Job Lifecycle

```
Define Job → Schedule → Execute → (Worker Thread) → Complete → Cleanup
```

## Creating Jobs

### Basic Job (JobFactory)

```typescript
import JobFactory from './utils/jobFactory';
import { JobCallback, RecurrenceRule } from 'node-schedule';

export default class MyJob extends JobFactory {
   protected getSpec() {
      const rule = new RecurrenceRule();
      rule.hour = 0;  // Run at midnight
      rule.minute = 0;
      return rule;
   }

   protected getJobCallback(): JobCallback {
      return (fireDate: Date) => {
         console.log(`Job executed at ${fireDate}`);
         // Your job logic here
      };
   }
}
```

### Thread-Based Job (ThreadJobFactory)

```typescript
import ThreadJobFactory from './utils/threadJobFactory';
import AbstractBaseWorker from './worker/pool/abstractBaseWorker';
import { RecurrenceRule, Range } from 'node-schedule';
import myWorker from './worker/myWorker';

export default class MyThreadJob extends ThreadJobFactory {
   constructor() {
      super();
      this.setEnable(true);
   }

   protected getSpec() {
      const rule = new RecurrenceRule();
      rule.minute = new Range(0, 60, 5); // Every 5 minutes
      return rule;
   }

   protected getWorker(): AbstractBaseWorker<Date, void> {
      return myWorker;
   }
}
```

## Scheduling Syntax

### Cron-Style Rules

```typescript
import { RecurrenceRule } from 'node-schedule';

const rule = new RecurrenceRule();

// Run every hour
rule.minute = 0;

// Run at specific time (2:30 AM)
rule.hour = 2;
rule.minute = 30;

// Run on specific days (Monday, Wednesday, Friday)
rule.dayOfWeek = [1, 3, 5];

// Run on specific dates
rule.date = 15; // 15th of every month

// Run every N minutes
rule.minute = new Range(0, 60, 5); // Every 5 minutes
```

### Cron String Format

```typescript
import schedule from 'node-schedule';

// Format: second minute hour day month dayOfWeek

// Every minute
schedule.scheduleJob('0 * * * * *', job);

// Every hour at minute 30
schedule.scheduleJob('0 30 * * * *', job);

// Every day at 2:30 AM
schedule.scheduleJob('0 30 2 * * *', job);

// Every Monday at 9 AM
schedule.scheduleJob('0 0 9 * * 1', job);

// Every 5 minutes
schedule.scheduleJob('*/5 * * * *', job);
```

### Date-Based Scheduling

```typescript
import schedule from 'node-schedule';

// Run once at specific date/time
const date = new Date(2026, 11, 25, 9, 0, 0);
schedule.scheduleJob(date, job);

// Run 1 hour from now
const in1Hour = new Date(Date.now() + 3600000);
schedule.scheduleJob(in1Hour, job);
```

## Built-in Jobs

### Session Timeout Job

Cleans up expired sessions every minute:

```typescript
// src/jobs/sessionTimeout.ts
export default class SessionTimeout extends ThreadJobFactory {
   constructor() {
      super();
      this.setEnable(true);
   }

   protected getSpec() {
      const rule = new RecurrenceRule();
      rule.minute = new Range(0, 60, 1); // Every minute
      return rule;
   }

   protected getWorker(): AbstractBaseWorker<Date, void> {
      return sessionTimeoutWorker;
   }
}
```

### Watchdog Job

Monitors system health:

```typescript
// src/jobs/watchdog.ts
export default class Watchdog extends JobFactory {
   protected getSpec() {
      const rule = new RecurrenceRule();
      rule.minute = new Range(0, 60, 5); // Every 5 minutes
      return rule;
   }

   protected getJobCallback(): JobCallback {
      return async (fireDate: Date) => {
         Logger.debug(`Watchdog check at ${fireDate}`);
         // Check system health
         await checkDatabaseConnection();
         await checkMCPServers();
         await checkMemoryUsage();
      };
   }
}
```

## Registering Jobs

### Application Startup

```typescript
// src/index.ts
import SessionTimeout from './jobs/sessionTimeout';
import Watchdog from './jobs/watchdog';
import JobFactory from './utils/jobFactory';

const activeJobs: JobFactory[] = [];

// Register jobs
const jobs = [
   new SessionTimeout(),
   new Watchdog(),
   // Add more jobs here
];

jobs.forEach(jobFactory => {
   const job = jobFactory.create();
   if (job) {
      activeJobs.push(jobFactory);
      Logger.info(`Registered job: ${jobFactory.constructor.name}`);
   }
});

// Keep reference to prevent garbage collection
```

### Manual Scheduling

```typescript
const jobFactory = new MyJob();
const job = jobFactory.create();

// Job is now scheduled
// Stop job later
job.cancel();
```

## Job Control

### Enable/Disable Jobs

```typescript
export default class MyJob extends JobFactory {
   constructor() {
      super();
      
      // Enable based on environment
      if (config.NODE_ENV === 'production') {
         this.setEnable(true);
      } else {
         this.setEnable(false);
      }
   }
   
   // ... rest of job
}
```

### Manual Trigger

```typescript
const jobFactory = new MyJob();

// Create scheduled job
const job = jobFactory.create();

// Manually trigger
jobFactory.getJobCallback()(new Date());
```

### Cancel Job

```typescript
const job = jobFactory.create();

// Cancel scheduled job
if (job) {
   job.cancel();
}
```

## Worker Thread Integration

Jobs can offload work to separate threads for better performance.

### Define Worker

```typescript
// src/worker/myWorker.ts
import { parentPort } from 'worker_threads';
import AbstractBaseWorker from './pool/abstractBaseWorker';

class MyWorker extends AbstractBaseWorker<Date, void> {
   getFilename(): string {
      return __filename;
   }

   protected run(fireDate: Date): void {
      // This runs in a separate thread
      console.log(`Worker processing at ${fireDate}`);
      
      // Perform heavy computation
      const result = performHeavyTask();
      
      // Send result back to main thread
      this.parentPort?.postMessage(result);
   }
}

export default new MyWorker(parentPort);
```

### Use Worker in Job

```typescript
import myWorker from './worker/myWorker';

export default class MyThreadJob extends ThreadJobFactory {
   protected getWorker(): AbstractBaseWorker<Date, void> {
      return myWorker;
   }
   
   // ... rest of implementation
}
```

## Error Handling

### Job-Level Errors

```typescript
protected getJobCallback(): JobCallback {
   return async (fireDate: Date) => {
      try {
         await performTask();
      } catch (error) {
         Logger.error(`Job failed: ${error}`);
         // Send alert, retry, etc.
      }
   };
}
```

### Worker-Level Errors

```typescript
protected run(task: Date): void {
   try {
      performTask();
   } catch (error) {
      Logger.error(`Worker error: ${error}`);
      // Error is caught and logged, job continues
   }
}
```

### Graceful Failure

```typescript
protected getJobCallback(): JobCallback {
   return async (fireDate: Date) => {
      try {
         await performTask();
      } catch (error) {
         Logger.error(`Task failed, will retry next run: ${error}`);
         // Don't throw - let job reschedule naturally
      }
   };
}
```

## Performance Considerations

### 1. Use Worker Threads for Heavy Tasks

```typescript
// ❌ Blocks main thread
protected getJobCallback(): JobCallback {
   return () => {
      heavyComputation(); // Blocks event loop
   };
}

// ✅ Non-blocking
protected getWorker(): AbstractBaseWorker<any, any> {
   return heavyComputationWorker; // Runs in separate thread
}
```

### 2. Batch Database Operations

```typescript
protected getJobCallback(): JobCallback {
   return async () => {
      // ❌ Many individual queries
      for (const item of items) {
         await queryDatabase('INSERT INTO ...', [item]);
      }
      
      // ✅ Single batch query
      await queryDatabase(
         'INSERT INTO ... SELECT * FROM unnest($1::type[])',
         [items]
      );
   };
}
```

### 3. Implement Rate Limiting

```typescript
protected getJobCallback(): JobCallback {
   return async () => {
      const items = await getItemsToProcess();
      
      // Process in batches to avoid overload
      for (let i = 0; i < items.length; i += 100) {
         const batch = items.slice(i, i + 100);
         await processBatch(batch);
         
         // Small delay between batches
         await new Promise(resolve => setTimeout(resolve, 100));
      }
   };
}
```

## Monitoring

### Job Execution Logging

```typescript
protected getJobCallback(): JobCallback {
   return async (fireDate: Date) => {
      const startTime = Date.now();
      
      Logger.info(`Job ${this.constructor.name} started at ${fireDate}`);
      
      try {
         await performTask();
         
         const duration = Date.now() - startTime;
         Logger.info(`Job completed in ${duration}ms`);
      } catch (error) {
         Logger.error(`Job failed: ${error}`);
      }
   };
}
```

### Health Checks

```typescript
protected getJobCallback(): JobCallback {
   return async () => {
      const health = {
         database: await checkDatabase(),
         mcpServers: await checkMCPServers(),
         memory: process.memoryUsage(),
         uptime: process.uptime()
      };
      
      Logger.info(`System health: ${JSON.stringify(health)}`);
      
      // Alert if unhealthy
      if (!health.database || !health.mcpServers) {
         await sendAlert('System health check failed');
      }
   };
}
```

## Testing

### Unit Tests

```typescript
describe('MyJob', () => {
   let job: MyJob;
   
   beforeEach(() => {
      job = new MyJob();
   });
   
   test('should have correct schedule', () => {
      const spec = job['getSpec']();
      expect(spec.minute).toBe(0);
      expect(spec.hour).toBe(0);
   });
   
   test('should execute job callback', async () => {
      const callback = job['getJobCallback']();
      const result = await callback(new Date());
      expect(result).toBeDefined();
   });
});
```

### Integration Tests

```typescript
test('job should clean up expired sessions', async () => {
   // Create expired session
   const session = new AiAgentSession();
   session.setExpires(new Date(Date.now() - 1000));
   await repository.save(session);
   
   // Run job
   const job = new SessionTimeout();
   const callback = job['getJobCallback']();
   await callback(new Date());
   
   // Verify cleanup
   const found = await repository
      .getRepository(AiAgentSession)
      .findById(session.getId()!);
   expect(found).toBeNull();
});
```

## Best Practices

### 1. Keep Jobs Idempotent

Jobs should be safe to run multiple times:

```typescript
protected getJobCallback(): JobCallback {
   return async () => {
      // ✅ Idempotent - safe to run multiple times
      await queryDatabase(
         'DELETE FROM sessions WHERE expires < $1',
         [new Date()]
      );
   };
}
```

### 2. Handle Job Overlap

Prevent concurrent executions:

```typescript
let isRunning = false;

protected getJobCallback(): JobCallback {
   return async () => {
      if (isRunning) {
         Logger.warn('Job already running, skipping');
         return;
      }
      
      isRunning = true;
      try {
         await performTask();
      } finally {
         isRunning = false;
      }
   };
}
```

### 3. Use Appropriate Intervals

```typescript
// ✅ Appropriate intervals
rule.minute = new Range(0, 60, 5);  // Every 5 min for cleanup
rule.minute = new Range(0, 60, 15); // Every 15 min for sync
rule.hour = 0;                       // Daily for reports

// ❌ Too frequent
rule.second = 1; // Every second - too frequent!
```

### 4. Log Job Activity

```typescript
protected getJobCallback(): JobCallback {
   return async (fireDate: Date) => {
      Logger.info(`Job started: ${this.constructor.name}`);
      
      try {
         const result = await performTask();
         Logger.info(`Job completed: ${JSON.stringify(result)}`);
      } catch (error) {
         Logger.error(`Job failed: ${error}`);
         throw error;
      }
   };
}
```

## Troubleshooting

### Job Not Running

```typescript
// Check if job is enabled
const job = new MyJob();
console.log('Enabled:', job['isEnabled']());

// Check schedule
const spec = job['getSpec']();
console.log('Schedule:', spec);

// Test callback manually
const callback = job['getJobCallback']();
await callback(new Date());
```

### Job Running Multiple Times

```typescript
// Ensure only one instance
let jobInstance: Job | null = null;

function registerJob() {
   if (jobInstance) {
      jobInstance.cancel();
   }
   jobInstance = jobFactory.create();
}
```

### Memory Leaks

```typescript
// Keep reference to prevent GC
const activeJobs: JobFactory[] = [];

jobs.forEach(factory => {
   const job = factory.create();
   if (job) {
      activeJobs.push(factory); // Keep reference
   }
});
```

## Examples

See implementation examples:
- [sessionTimeout.ts](../src/jobs/sessionTimeout.ts)
- [watchdog.ts](../src/jobs/watchdog.ts)

## Related Documentation

- [Worker System](WORKER_SYSTEM.md)
- [Scripts Reference](SCRIPTS_REFERENCE.md)
- [Configuration](CONFIGURATION.md)
