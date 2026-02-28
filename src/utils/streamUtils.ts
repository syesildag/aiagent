import { Response } from "express";
import { pipeline } from "node:stream/promises";
import { PassThrough, Transform } from "stream";
import Logger from "./logger";

/**
 * Handles streaming responses by capturing content while streaming to client
 */
export async function handleStreamingResponse(
   stream: ReadableStream<string>, 
   res: Response,
   consumer?: (content: string) => void
): Promise<void> {
   let capturedContent = '';
   
   // Create transform stream to capture content while passing through
   const captureTransform = new Transform({
      objectMode: false,
      transform(chunk: Buffer, encoding: BufferEncoding, callback: Function) {
         try {
            const str = chunk.toString('utf8');
            capturedContent += str;
            // Wrap each text fragment as an NDJSON event so the browser can
            // distinguish text chunks from other events (e.g. tool-approval).
            this.push(Buffer.from(JSON.stringify({ t: 'text', v: str }) + '\n', 'utf8'));
            callback();
         } catch (error) {
            callback(error);
         }
      },
      flush(callback: Function) {
         try {
            Logger.debug(`Streaming response completed. Total length: ${capturedContent.length} chars`);
            // Call consumer callback if provided
            if (consumer) {
               try {
                  consumer(capturedContent);
               } catch (consumerError) {
                  Logger.error(`Error in consumer callback: ${consumerError}`);
                  // Don't propagate consumer errors to the stream - continue flushing
               }
            }
            callback();
         } catch (error) {
            Logger.error(`Error in flush callback: ${error}`);
            callback(error);
         }
      }
   });

   // Convert Web ReadableStream to Node.js stream
   const nodeStream = await convertWebStreamToNodeStream(stream);
   
   // Pipeline: WebStream -> NodeStream -> CaptureTransform -> Response
   await pipeline(nodeStream, captureTransform, res);
}

/**
 * Converts Web ReadableStream to Node.js Readable stream
 */
export async function convertWebStreamToNodeStream(webStream: ReadableStream<string>): Promise<PassThrough> {
   const nodeStream = new PassThrough();
   const reader = webStream.getReader();
   
   // Pump data from Web stream to Node.js stream
   const pump = async (): Promise<void> => {
      try {
         while (true) {
            const { done, value } = await reader.read();
            if (done) {
               nodeStream.end();
               break;
            }
            
            // Ensure value is a Buffer for consistent handling
            const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
            
            if (!nodeStream.write(buffer)) {
               // Backpressure handling - wait for drain
               await new Promise(resolve => nodeStream.once('drain', resolve));
            }
         }
      } catch (error) {
         Logger.error(`Error in stream conversion: ${error}`);
         nodeStream.destroy(error as Error);
      } finally {
         reader.releaseLock();
      }
   };
   
   // Start pumping immediately
   pump().catch(error => {
      Logger.error(`Pump failed: ${error}`);
      nodeStream.destroy(error);
   });
   
   return nodeStream;
}