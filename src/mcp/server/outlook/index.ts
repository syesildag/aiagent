#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  CreateEventSchema,
  SendEmailSchema,
  ListEventsQuerySchema,
  ListEmailsQuerySchema,
  SearchPeopleQuerySchema,
  GetScheduleQuerySchema,
  FindMeetingTimesQuerySchema,
  AddAttendeesToEventSchema,
} from "./types.js";
import { graphClient, formatGraphError } from "./graphClient.js";
import Logger from "../../../utils/logger.js";

async function main(): Promise<void> {
  try {
    const server = new McpServer({
      name: "outlook-mcp",
      version: "1.0.0",
    });

    // =========================================================================
    // Calendar Tools
    // =========================================================================

    server.registerTool(
      "listCalendarEvents",
      {
        title: "List Calendar Events",
        description: "Lists the user's calendar events for a specified time range",
        inputSchema: z.object(ListEventsQuerySchema.shape).passthrough(),
      } as any,
      async (params: any) => {
        try {
          const events = await graphClient.listEvents({
            startDateTime: params.startDateTime,
            endDateTime: params.endDateTime,
            top: params.top,
            orderBy: params.orderBy,
          });

          const formattedEvents = events.map(event => {
            const startDate = new Date(event.start.dateTime);
            const endDate = new Date(event.end.dateTime);
            return {
              id: event.id,
              subject: event.subject,
              start: startDate.toLocaleString(),
              end: endDate.toLocaleString(),
              timeZone: event.start.timeZone,
              location: event.location?.displayName || "No location",
              isAllDay: event.isAllDay || false,
              attendees: event.attendees?.map((a: any) => a.emailAddress.address).join(", ") || "No attendees",
              preview: event.bodyPreview || "",
            };
          });

          return { content: [{ type: "text" as const, text: JSON.stringify(formattedEvents, null, 2) }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] listCalendarEvents error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error listing calendar events: ${msg}` }], isError: true };
        }
      }
    );

    server.registerTool(
      "createCalendarEvent",
      {
        title: "Create Calendar Event",
        description: "Creates a new calendar event. Ensure availability and user confirmation before sending invites.",
        inputSchema: z.object(CreateEventSchema.shape).passthrough(),
      } as any,
      async (params: any) => {
        try {
          const createdEvent = await graphClient.createEvent(params);
          return { content: [{ type: "text" as const, text: JSON.stringify(createdEvent, null, 2) }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] createCalendarEvent error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error creating calendar event: ${msg}` }], isError: true };
        }
      }
    );

    server.registerTool(
      "getCalendarEvent",
      {
        title: "Get Calendar Event",
        description: "Gets details of a specific calendar event",
        inputSchema: z.object({
          eventId: z.string().describe("ID of the event to retrieve"),
        }).passthrough(),
      } as any,
      async (params: any) => {
        try {
          const event = await graphClient.getEvent(params.eventId);
          return { content: [{ type: "text" as const, text: JSON.stringify(event, null, 2) }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] getCalendarEvent error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error getting calendar event: ${msg}` }], isError: true };
        }
      }
    );

    server.registerTool(
      "updateCalendarEvent",
      {
        title: "Update Calendar Event",
        description: "Updates an existing calendar event",
        inputSchema: z.object({
          eventId: z.string().describe("ID of the event to update"),
          ...Object.fromEntries(
            Object.entries(CreateEventSchema.shape).map(([key, schema]) => [
              key,
              (schema as z.ZodType<any>).optional(),
            ])
          ),
        }).passthrough(),
      } as any,
      async (params: any) => {
        try {
          const { eventId, ...updateData } = params;
          const updatedEvent = await graphClient.updateEvent(eventId, updateData);
          return { content: [{ type: "text" as const, text: JSON.stringify(updatedEvent, null, 2) }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] updateCalendarEvent error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error updating calendar event: ${msg}` }], isError: true };
        }
      }
    );

    server.registerTool(
      "deleteCalendarEvent",
      {
        title: "Delete Calendar Event",
        description: "Deletes a calendar event",
        inputSchema: z.object({
          eventId: z.string().describe("ID of the event to delete"),
        }).passthrough(),
      } as any,
      async (params: any) => {
        try {
          await graphClient.deleteEvent(params.eventId);
          return { content: [{ type: "text" as const, text: `Event ${params.eventId} successfully deleted` }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] deleteCalendarEvent error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error deleting calendar event: ${msg}` }], isError: true };
        }
      }
    );

    server.registerTool(
      "addAttendeesToCalendarEvent",
      {
        title: "Add Attendees To Calendar Event",
        description:
          "Adds one or more attendees to an existing calendar event. Fetches the event, merges new attendees " +
          "with existing ones (avoiding duplicates), and updates the event.",
        inputSchema: z.object(AddAttendeesToEventSchema.shape).passthrough(),
      } as any,
      async (params: any) => {
        try {
          const updatedEvent = await graphClient.addAttendeesToEvent(params.eventId, params.attendees);
          return { content: [{ type: "text" as const, text: JSON.stringify(updatedEvent, null, 2) }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] addAttendeesToCalendarEvent error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error adding attendees to calendar event: ${msg}` }], isError: true };
        }
      }
    );

    // =========================================================================
    // Email Tools
    // =========================================================================

    server.registerTool(
      "listEmails",
      {
        title: "List Emails",
        description: "Lists the user's emails from a specified folder",
        inputSchema: z.object(ListEmailsQuerySchema.shape).passthrough(),
      } as any,
      async (params: any) => {
        try {
          const emails = await graphClient.listEmails({
            top: params.top,
            folder: params.folder || "inbox",
            orderBy: params.orderBy,
            filter: params.filter,
            select: params.select,
          });

          const formattedEmails = emails.map((email: any) => ({
            id: email.id,
            subject: email.subject || "(No Subject)",
            from: email.from?.emailAddress.address || "Unknown",
            fromName: email.from?.emailAddress.name,
            received: email.receivedDateTime ? new Date(email.receivedDateTime).toLocaleString() : "Unknown",
            isRead: email.isRead,
            importance: email.importance || "normal",
            hasAttachments: email.hasAttachments || false,
            preview: email.bodyPreview || "",
          }));

          return { content: [{ type: "text" as const, text: JSON.stringify(formattedEmails, null, 2) }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] listEmails error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error listing emails: ${msg}` }], isError: true };
        }
      }
    );

    server.registerTool(
      "getEmail",
      {
        title: "Get Email",
        description: "Gets details of a specific email message",
        inputSchema: z.object({
          messageId: z.string().describe("ID of the email message to retrieve"),
        }).passthrough(),
      } as any,
      async (params: any) => {
        try {
          const email = await graphClient.getEmail(params.messageId);
          return { content: [{ type: "text" as const, text: JSON.stringify(email, null, 2) }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] getEmail error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error getting email: ${msg}` }], isError: true };
        }
      }
    );

    server.registerTool(
      "sendEmail",
      {
        title: "Send Email",
        description: "Sends a new email message",
        inputSchema: z.object(SendEmailSchema.shape).passthrough(),
      } as any,
      async (params: any) => {
        try {
          await graphClient.sendEmail(params);
          return { content: [{ type: "text" as const, text: "Email successfully sent" }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] sendEmail error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error sending email: ${msg}` }], isError: true };
        }
      }
    );

    server.registerTool(
      "createDraft",
      {
        title: "Create Draft",
        description: "Creates a draft email message without sending it",
        inputSchema: z.object(SendEmailSchema.shape).passthrough(),
      } as any,
      async (params: any) => {
        try {
          const draft = await graphClient.createDraft(params);
          return { content: [{ type: "text" as const, text: JSON.stringify(draft, null, 2) }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] createDraft error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error creating draft email: ${msg}` }], isError: true };
        }
      }
    );

    server.registerTool(
      "markEmailAsRead",
      {
        title: "Mark Email As Read",
        description: "Marks an email message as read",
        inputSchema: z.object({
          messageId: z.string().describe("ID of the email message to mark as read"),
        }).passthrough(),
      } as any,
      async (params: any) => {
        try {
          await graphClient.markAsRead(params.messageId);
          return { content: [{ type: "text" as const, text: `Email ${params.messageId} marked as read` }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] markEmailAsRead error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error marking email as read: ${msg}` }], isError: true };
        }
      }
    );

    server.registerTool(
      "markEmailAsUnread",
      {
        title: "Mark Email As Unread",
        description: "Marks an email message as unread",
        inputSchema: z.object({
          messageId: z.string().describe("ID of the email message to mark as unread"),
        }).passthrough(),
      } as any,
      async (params: any) => {
        try {
          await graphClient.markAsUnread(params.messageId);
          return { content: [{ type: "text" as const, text: `Email ${params.messageId} marked as unread` }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] markEmailAsUnread error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error marking email as unread: ${msg}` }], isError: true };
        }
      }
    );

    server.registerTool(
      "deleteEmail",
      {
        title: "Delete Email",
        description: "Deletes an email message",
        inputSchema: z.object({
          messageId: z.string().describe("ID of the email message to delete"),
        }).passthrough(),
      } as any,
      async (params: any) => {
        try {
          await graphClient.deleteEmail(params.messageId);
          return { content: [{ type: "text" as const, text: `Email ${params.messageId} successfully deleted` }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] deleteEmail error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error deleting email: ${msg}` }], isError: true };
        }
      }
    );

    // =========================================================================
    // People Tools
    // =========================================================================

    server.registerTool(
      "searchPeople",
      {
        title: "Search People",
        description: "Searches for people relevant to the current user (colleagues, contacts, etc.)",
        inputSchema: z.object(SearchPeopleQuerySchema.shape).passthrough(),
      } as any,
      async (params: any) => {
        try {
          const people = await graphClient.searchPeople({
            searchTerm: params.searchTerm,
            filter: params.filter,
            select: params.select,
            top: params.top,
          });

          const formattedPeople = people.map((person: any) => {
            const primaryEmail =
              person.scoredEmailAddresses?.length > 0 ? person.scoredEmailAddresses[0].address : "";
            const personClass = person.personType?.class || "Unknown";
            const personSubclass = person.personType?.subclass || "";
            return {
              id: person.id,
              displayName: person.displayName || "Unknown",
              email: primaryEmail,
              jobTitle: person.jobTitle || "",
              department: person.department || "",
              type: `${personClass}${personSubclass ? ` (${personSubclass})` : ""}`,
            };
          });

          return { content: [{ type: "text" as const, text: JSON.stringify(formattedPeople, null, 2) }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] searchPeople error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error searching people: ${msg}` }], isError: true };
        }
      }
    );

    server.registerTool(
      "getPerson",
      {
        title: "Get Person",
        description: "Gets details of a specific person by ID",
        inputSchema: z.object({
          personId: z.string().describe("ID of the person to retrieve"),
        }).passthrough(),
      } as any,
      async (params: any) => {
        try {
          const person = await graphClient.getPerson(params.personId);
          return { content: [{ type: "text" as const, text: JSON.stringify(person, null, 2) }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] getPerson error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error getting person: ${msg}` }], isError: true };
        }
      }
    );

    // =========================================================================
    // Schedule Tools
    // =========================================================================

    server.registerTool(
      "getSchedule",
      {
        title: "Get Schedule",
        description: "Gets free/busy schedule information for specified users",
        inputSchema: z.object(GetScheduleQuerySchema.shape).passthrough(),
      } as any,
      async (params: any) => {
        try {
          const scheduleInfo = await graphClient.getSchedule(params);

          const availabilityMap: Record<string, string> = {
            "0": "free",
            "1": "tentative",
            "2": "busy",
            "3": "out of office",
            "4": "working elsewhere",
          };

          const formattedSchedule = scheduleInfo.map((schedule: any) => ({
            userId: schedule.scheduleId,
            availability: schedule.availabilityView.split("").map((s: string) => availabilityMap[s] || "unknown"),
            detailedItems: schedule.scheduleItems || [],
          }));

          return { content: [{ type: "text" as const, text: JSON.stringify(formattedSchedule, null, 2) }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] getSchedule error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error getting schedule: ${msg}` }], isError: true };
        }
      }
    );

    server.registerTool(
      "findMeetingTimes",
      {
        title: "Find Meeting Times",
        description: "Finds suitable meeting times for a group of attendees. Correct e-mail addresses are required.",
        inputSchema: z.object(FindMeetingTimesQuerySchema.shape).passthrough(),
      } as any,
      async (params: any) => {
        try {
          const suggestions = await graphClient.findMeetingTimes(params);

          const formattedSuggestions = suggestions.map((suggestion: any) => ({
            startTime: new Date(suggestion.meetingTimeSlot.start.dateTime).toLocaleString(),
            endTime: new Date(suggestion.meetingTimeSlot.end.dateTime).toLocaleString(),
            timeZone: suggestion.meetingTimeSlot.start.timeZone,
            confidence: suggestion.confidence || 0,
            organizerAvailability: suggestion.organizerAvailability || "unknown",
            attendeeAvailability: suggestion.attendeeAvailability?.map((a: any) => ({
              attendee: a.attendee.emailAddress.address,
              availability: a.availability,
            })) || [],
          }));

          return { content: [{ type: "text" as const, text: JSON.stringify(formattedSuggestions, null, 2) }] };
        } catch (err) {
          const msg = await formatGraphError(err);
          Logger.error(`[outlook-mcp] findMeetingTimes error: ${msg}`);
          return { content: [{ type: "text" as const, text: `Error finding meeting times: ${msg}` }], isError: true };
        }
      }
    );

    // =========================================================================
    // Resources
    // =========================================================================

    server.registerResource(
      "calendar",
      "https://graph.microsoft.com/v1.0/me/calendar/events",
      {
        title: "Calendar",
        description: "Current user's calendar events",
        mimeType: "application/json",
      },
      async (uri) => {
        const events = await graphClient.listEvents({});
        return {
          contents: [{
            uri: uri.toString(),
            text: JSON.stringify(events),
            mimeType: "application/json",
          }],
        };
      }
    );

    server.registerResource(
      "inbox",
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages",
      {
        title: "Inbox",
        description: "Current user's inbox messages",
        mimeType: "application/json",
      },
      async (uri) => {
        const emails = await graphClient.listEmails({ folder: "inbox" });
        return {
          contents: [{
            uri: uri.toString(),
            text: JSON.stringify(emails),
            mimeType: "application/json",
          }],
        };
      }
    );

    // =========================================================================
    // Prompts
    // =========================================================================

    server.registerPrompt(
      "outlook-schedule-meeting-prompt",
      {
        title: "Schedule Meeting",
        description: "A prompt to schedule a meeting with multiple attendees.",
        argsSchema: {
          param: z.string().optional().describe("Not used"),
        },
      } as any,
      async () => ({ messages: [] })
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
    Logger.info("[outlook-mcp] Outlook MCP server started");

  } catch (error) {
    Logger.error("[outlook-mcp] Failed to start:", error);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(): Promise<void> {
  Logger.info("[outlook-mcp] Shutting down...");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((error) => {
  Logger.error("[outlook-mcp] Unhandled error:", error);
  process.exit(1);
});
