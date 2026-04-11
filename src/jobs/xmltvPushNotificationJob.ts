import webPush from 'web-push';
import { RecurrenceRule } from 'node-schedule';
import DbJobFactory from '../utils/dbJobFactory';
import Logger from '../utils/logger';
import { config } from '../utils/config';
import aiAgentPushSubscriptionRepository from '../entities/ai-agent-push-subscription';
import aiAgentScheduledPushNotificationRepository from '../entities/ai-agent-scheduled-push-notification';

/**
 * DB-backed job that fires every minute, checks for due push notifications,
 * and delivers them via the Web Push API (VAPID).
 *
 * This is the server-side counterpart to the client-side SW setTimeout approach.
 * Android kills service workers when the browser is backgrounded, so scheduled
 * notifications must be stored in the DB and sent from the server at the right time.
 *
 * Requires VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT in .env.
 * When these are absent the job is a no-op (graceful degradation).
 */
export default class XmltvPushNotificationJob extends DbJobFactory {

   protected override getJobName(): string {
      return 'xmltv-push-notifications';
   }

   protected override getSpec(): RecurrenceRule {
      const rule = new RecurrenceRule();
      rule.second = 0; // fire at the top of every minute
      return rule;
   }

   protected override async getJobBody(): Promise<void> {
      if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY || !config.VAPID_SUBJECT) {
         return; // VAPID not configured — skip silently
      }

      webPush.setVapidDetails(
         config.VAPID_SUBJECT,
         config.VAPID_PUBLIC_KEY,
         config.VAPID_PRIVATE_KEY,
      );

      const due = await aiAgentScheduledPushNotificationRepository.findDue(new Date());
      if (!due.length) return;

      Logger.info(`[XmltvPushNotificationJob] Sending ${due.length} notification(s)`);

      for (const n of due) {
         // Delete first so a crash during send doesn't cause a duplicate on the next tick
         await n.delete();

         const sub = await aiAgentPushSubscriptionRepository.findByEndpoint(n.getEndpoint());
         if (!sub) continue;

         const payload = JSON.stringify({
            title: n.getTitle(),
            body: n.getBody(),
            icon: n.getIcon() ?? '/static/icons/icon-192.png',
            url: n.getUrl() ?? '/xmltv',
         });

         try {
            await webPush.sendNotification(
               {
                  endpoint: sub.getEndpoint(),
                  keys: { p256dh: sub.getP256dh(), auth: sub.getAuth() },
               },
               payload,
            );
         } catch (err: any) {
            if (err?.statusCode === 410 || err?.statusCode === 404) {
               // Subscription expired or unsubscribed — clean up
               Logger.info(`[XmltvPushNotificationJob] Removing stale subscription: ${sub.getEndpoint().slice(0, 60)}…`);
               await aiAgentPushSubscriptionRepository.deleteByEndpoint(sub.getEndpoint());
            } else {
               Logger.warn(`[XmltvPushNotificationJob] Push failed for ${n.getId()}: ${err?.message}`);
            }
         }
      }
   }

   protected override getDefaultParams(): Record<string, unknown> {
      return { schedule: 'every minute' };
   }

}
