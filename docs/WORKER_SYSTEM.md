# Worker System

## Overview

The Worker System provides multi-threaded task execution using Node.js worker threads. It enables CPU-intensive operations to run in parallel without blocking the main event loop.

## Architecture

### Components

1. **AbstractBaseWorker** - Base class for all workers
2. **Worker Pool** - Manages worker thread lifecycle
3. **ThreadJobFactory** - Integrates workers with job system
4. **Message Passing** - Communication between main and worker threads

### Worker Lifecycle

```
Main Thread → Spawn Worker → Initialize → Send Task → Execute → Return Result → Cleanup
```

## Creating Workers

### Basic Worker

```typescript
// src/worker/myWorker.ts
import { parentPort } from 'worker_threads';
import AbstractBaseWorker from './pool/abstractBaseWorker';
import Logger from '../utils/logger';

class MyWorker extends AbstractBaseWorker<InputType, OutputType> {
   getFilename(): string {
      return __filename;
   }

   protected run(task: InputType): OutputType {
      // Your worker logic here
      Logger.debug(`Processing task: ${JSON.stringify(task)}`);
      
      const result = performComputation(task);
      
      return result;
   }
}

export default new MyWorker(parentPort);
```

### Worker with Async Operations

```typescript
class AsyncWorker extends AbstractBaseWorker<string, Promise<string>> {
   getFilename(): string {
      return __filename;
   }

   protected async run(task: string): Promise<string> {
      // Can use async/await in workers
      const result = await fetchData(task);
      const processed = await processData(result);
      return processed;
   }
}
```

### Worker with Complex Types

```typescript
interface ComputeTask {
   data: number[];
   operation: 'sum' | 'avg' | 'max';
}

interface ComputeResult {
   result: number;
   duration: number;
}

class ComputeWorker extends AbstractBaseWorker<ComputeTask, ComputeResult> {
   getFilename(): string {
      return __filename;
   }

   protected run(task: ComputeTask): ComputeResult {
      const startTime = Date.now();
      
      let result: number;
      switch (task.operation) {
         case 'sum':
            result = task.data.reduce((a, b) => a + b, 0);
            break;
         case 'avg':
            result = task.data.reduce((a, b) => a + b, 0) / task.data.length;
            break;
         case 'max':
            result = Math.max(...task.data);
            break;
      }
      
      return {
         result,
         duration: Date.now() - startTime
      };
   }
}
```

## Worker Pool

### Creating a Pool

```typescript
// src/worker/pool/workerPool.ts
import { Worker } from 'worker_threads';
import path from 'path';

export class WorkerPool<T, R> {
   private workers: Worker[] = [];
   private availableWorkers: Worker[] = [];
   private taskQueue: Array<{
      task: T;
      resolve: (value: R) => void;
      reject: (error: Error) => void;
   }> = [];
   
   constructor(
      private workerFile: string,
      private poolSize: number = 4
   ) {
      this.initialize();
   }
   
   private initialize(): void {
      for (let i = 0; i < this.poolSize; i++) {
         const worker = new Worker(this.workerFile);
         this.workers.push(worker);
         this.availableWorkers.push(worker);
         
         worker.on('message', (result: R) => {
            this.availableWorkers.push(worker);
            this.processQueue();
         });
         
         worker.on('error', (error) => {
            Logger.error(`Worker error: ${error}`);
         });
      }
   }
   
   async execute(task: T): Promise<R> {
      return new Promise((resolve, reject) => {
         this.taskQueue.push({ task, resolve, reject });
         this.processQueue();
      });
   }
   
   private processQueue(): void {
      while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
         const { task, resolve, reject } = this.taskQueue.shift()!;
         const worker = this.availableWorkers.shift()!;
         
         worker.once('message', resolve);
         worker.once('error', reject);
         worker.postMessage(task);
      }
   }
   
   terminate(): void {
      this.workers.forEach(worker => worker.terminate());
   }
}
```

### Using the Pool

```typescript
const pool = new WorkerPool<ComputeTask, ComputeResult>(
   path.join(__dirname, 'computeWorker.js'),
   4 // 4 workers
);

// Execute tasks in parallel
const tasks = [
   { data: [1, 2, 3, 4, 5], operation: 'sum' },
   { data: [10, 20, 30], operation: 'avg' },
   { data: [100, 200, 50], operation: 'max' }
];

const results = await Promise.all(
   tasks.map(task => pool.execute(task))
);

console.log(results);
// Cleanup
pool.terminate();
```

## Built-in Workers

### Session Timeout Worker

Cleans up expired sessions in a separate thread:

```typescript
// src/worker/sessionTimeoutWorker.ts
import { parentPort } from 'worker_threads';
import AbstractBaseWorker from './pool/abstractBaseWorker';
import Logger from '../utils/logger';
import deleteExpiredSessions from '../scripts/deleteExpiredSessions';

class SessionTimeoutWorker extends AbstractBaseWorker<Date, void> {
   getFilename(): string {
      return __filename;
   }

   protected run(fireDate: Date): void {
      Logger.debug('sessionTimeoutWorker: ' + fireDate);
      
      deleteExpiredSessions().catch((error) => {
         Logger.error(`Error in sessionTimeoutWorker: ${error}`);
      });
   }
}

export default new SessionTimeoutWorker(parentPort);
```

## Communication Patterns

### Simple Message Passing

```typescript
// Main thread
const worker = new Worker('./myWorker.js');

worker.postMessage({ type: 'task', data: 'hello' });

worker.on('message', (result) => {
   console.log('Result:', result);
});

// Worker thread
parentPort?.on('message', (message) => {
   const result = processTask(message.data);
   parentPort?.postMessage(result);
});
```

### Request-Response Pattern

```typescript
// Main thread
class WorkerClient<T, R> {
   private requestId = 0;
   private pending = new Map<number, {
      resolve: (value: R) => void;
      reject: (error: Error) => void;
   }>();
   
   constructor(private worker: Worker) {
      worker.on('message', this.handleResponse.bind(this));
   }
   
   async send(task: T): Promise<R> {
      const id = this.requestId++;
      
      return new Promise((resolve, reject) => {
         this.pending.set(id, { resolve, reject });
         this.worker.postMessage({ id, task });
      });
   }
   
   private handleResponse(response: { id: number; result?: R; error?: string }) {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      
      this.pending.delete(response.id);
      
      if (response.error) {
         pending.reject(new Error(response.error));
      } else {
         pending.resolve(response.result!);
      }
   }
}
```

### Streaming Data

```typescript
// Worker sends multiple updates
export class StreamingWorker extends AbstractBaseWorker<string, void> {
   protected run(task: string): void {
      for (let i = 0; i < 10; i++) {
         // Send progress updates
         this.parentPort?.postMessage({
            type: 'progress',
            value: i * 10
         });
         
         // Simulate work
         performStep(i);
      }
      
      // Send final result
      this.parentPort?.postMessage({
         type: 'complete',
         result: 'done'
      });
   }
}

// Main thread receives updates
worker.on('message', (message) => {
   if (message.type === 'progress') {
      console.log(`Progress: ${message.value}%`);
   } else if (message.type === 'complete') {
      console.log('Complete:', message.result);
   }
});
```

## Error Handling

### Worker-Side Errors

```typescript
class SafeWorker extends AbstractBaseWorker<any, any> {
   getFilename(): string {
      return __filename;
   }

   protected run(task: any): any {
      try {
         return performTask(task);
      } catch (error) {
         Logger.error(`Worker error: ${error}`);
         
         // Send error back to main thread
         this.parentPort?.postMessage({
            error: error.message,
            stack: error.stack
         });
         
         // Return error result
         return { error: true, message: error.message };
      }
   }
}
```

### Main Thread Error Handling

```typescript
const worker = new Worker('./myWorker.js');

worker.on('error', (error) => {
   Logger.error(`Worker error: ${error}`);
   // Handle error (restart worker, etc.)
});

worker.on('exit', (code) => {
   if (code !== 0) {
      Logger.error(`Worker stopped with exit code ${code}`);
   }
});
```

### Timeout Handling

```typescript
async function executeWithTimeout<T, R>(
   worker: Worker,
   task: T,
   timeoutMs: number
): Promise<R> {
   return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
         worker.terminate();
         reject(new Error('Worker timeout'));
      }, timeoutMs);
      
      worker.once('message', (result) => {
         clearTimeout(timer);
         resolve(result);
      });
      
      worker.once('error', (error) => {
         clearTimeout(timer);
         reject(error);
      });
      
      worker.postMessage(task);
   });
}
```

## Performance Optimization

### 1. Worker Pool Sizing

```typescript
import os from 'os';

// Use CPU count for CPU-bound tasks
const poolSize = os.cpus().length;

// Use fixed size for I/O-bound tasks
const poolSize = 4;
```

### 2. Task Batching

```typescript
// ❌ Create worker per task (expensive)
for (const task of tasks) {
   const worker = new Worker('./worker.js');
   await executeTask(worker, task);
   worker.terminate();
}

// ✅ Reuse workers with pool
const pool = new WorkerPool('./worker.js', 4);
const results = await Promise.all(
   tasks.map(task => pool.execute(task))
);
```

### 3. Minimize Data Transfer

```typescript
// ❌ Send large data structures
worker.postMessage({ data: largeArray });

// ✅ Use SharedArrayBuffer for large data
const sharedBuffer = new SharedArrayBuffer(1024 * 1024);
worker.postMessage({ buffer: sharedBuffer });
```

### 4. Keep Workers Alive

```typescript
// ❌ Recreate worker each time
function processTask(task) {
   const worker = new Worker('./worker.js');
   const result = await executeTask(worker, task);
   worker.terminate();
   return result;
}

// ✅ Reuse worker
const worker = new Worker('./worker.js');

async function processTask(task) {
   return await executeTask(worker, task);
}
```

## Monitoring

### Worker Statistics

```typescript
class MonitoredWorkerPool<T, R> extends WorkerPool<T, R> {
   private stats = {
      tasksCompleted: 0,
      tasksQueued: 0,
      totalDuration: 0,
      errors: 0
   };
   
   async execute(task: T): Promise<R> {
      this.stats.tasksQueued++;
      const startTime = Date.now();
      
      try {
         const result = await super.execute(task);
         this.stats.tasksCompleted++;
         this.stats.totalDuration += Date.now() - startTime;
         return result;
      } catch (error) {
         this.stats.errors++;
         throw error;
      }
   }
   
   getStats() {
      return {
         ...this.stats,
         avgDuration: this.stats.totalDuration / this.stats.tasksCompleted
      };
   }
}
```

### Health Checks

```typescript
class HealthMonitor {
   async checkWorkerHealth(worker: Worker): Promise<boolean> {
      return new Promise((resolve) => {
         const timer = setTimeout(() => resolve(false), 5000);
         
         worker.once('message', () => {
            clearTimeout(timer);
            resolve(true);
         });
         
         worker.postMessage({ type: 'ping' });
      });
   }
}
```

## Testing

### Unit Tests

```typescript
describe('ComputeWorker', () => {
   let worker: Worker;
   
   beforeEach(() => {
      worker = new Worker('./computeWorker.js');
   });
   
   afterEach(() => {
      worker.terminate();
   });
   
   test('should calculate sum', async () => {
      const result = await new Promise((resolve) => {
         worker.once('message', resolve);
         worker.postMessage({
            data: [1, 2, 3, 4, 5],
            operation: 'sum'
         });
      });
      
      expect(result.result).toBe(15);
   });
});
```

### Integration Tests

```typescript
test('worker pool should process tasks in parallel', async () => {
   const pool = new WorkerPool('./worker.js', 4);
   
   const tasks = Array(100).fill(0).map((_, i) => ({ value: i }));
   
   const startTime = Date.now();
   const results = await Promise.all(
      tasks.map(task => pool.execute(task))
   );
   const duration = Date.now() - startTime;
   
   expect(results.length).toBe(100);
   expect(duration).toBeLessThan(5000); // Should be faster than sequential
   
   pool.terminate();
});
```

## Best Practices

### 1. Initialize Workers Early

```typescript
// ✅ Initialize at startup
const workerPool = new WorkerPool('./worker.js', 4);

// ❌ Create on demand (slower)
async function handleRequest() {
   const pool = new WorkerPool('./worker.js', 4);
   // ...
}
```

### 2. Handle Worker Crashes

```typescript
worker.on('exit', (code) => {
   if (code !== 0) {
      Logger.error(`Worker crashed with code ${code}`);
      // Restart worker
      worker = new Worker('./worker.js');
   }
});
```

### 3. Clean Up Resources

```typescript
process.on('SIGTERM', () => {
   pool.terminate();
   process.exit(0);
});
```

### 4. Use Type Safety

```typescript
// Define clear types
interface WorkerInput {
   data: string;
   options: { format: 'json' | 'xml' };
}

interface WorkerOutput {
   result: any;
   metadata: { duration: number };
}

class TypedWorker extends AbstractBaseWorker<WorkerInput, WorkerOutput> {
   // Type-safe implementation
}
```

## Troubleshooting

### Worker Not Responding

```typescript
// Add timeout
const result = await Promise.race([
   executeTask(worker, task),
   new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), 5000)
   )
]);
```

### Memory Leaks

```typescript
// Terminate unused workers
worker.terminate();

// Clear references
worker = null;

// Monitor memory
console.log(process.memoryUsage());
```

### High CPU Usage

```typescript
// Limit worker pool size
const maxWorkers = Math.min(os.cpus().length, 4);

// Add delays between tasks
await new Promise(resolve => setTimeout(resolve, 100));
```

## Examples

See implementation examples:
- [sessionTimeoutWorker.ts](../src/worker/sessionTimeoutWorker.ts)
- [abstractBaseWorker.ts](../src/worker/pool/abstractBaseWorker.ts)

## Related Documentation

- [Job System](JOB_SYSTEM.md)
- [Configuration](CONFIGURATION.md)
- [Testing Guide](TESTING_GUIDE.md)
