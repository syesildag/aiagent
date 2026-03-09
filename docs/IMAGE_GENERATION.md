# Image Generation

## Overview

The AI Agent chat interface supports image generation through two distinct code paths depending on the selected model. The behavior is model-dependent:

| Model type | Examples | API used | Behavior |
|---|---|---|---|
| Dedicated image models | `dall-e-3`, `dall-e-2`, `gpt-image-1` | OpenAI Images API | Every prompt generates an image |
| Chat + image models | `gpt-4.1`, `gpt-4o`, `o3`, `gpt-5` | OpenAI Responses API | Normal chat; model generates images when asked |

## Requirements

- **Provider**: `LLM_PROVIDER=openai` — image generation is only supported by the OpenAI provider.
- **API Key**: A valid `OPENAI_API_KEY` with access to the desired model.
- **Model access**: Your API key must have access to the chosen image generation model (e.g. `dall-e-3`, `gpt-image-1`). Check your [OpenAI account](https://platform.openai.com) for access.

## Usage

### Dedicated Image Models (dall-e-3, dall-e-2, gpt-image-1)

1. Select `dall-e-3`, `dall-e-2`, or `gpt-image-1` from the model picker in the chat interface.
2. The input placeholder changes to **"Describe the image you want to generate..."**.
3. The file attachment button is hidden (these models do not accept image inputs).
4. Every prompt generates an image — no text response is returned.
5. The generated image appears in the assistant message bubble.
6. Hover over the message to reveal a **Download** button.

**Example prompts:**
```
A photorealistic sunset over ocean waves, golden hour lighting
A minimalist logo for a tech startup, flat design, blue and white
An oil painting of a cat wearing a astronaut suit
```

### Chat Models with Image Generation (gpt-4.1, gpt-4o, o3, gpt-5)

1. Select `gpt-4.1` (or another supported model) from the model picker.
2. The input placeholder changes to **"Ask anything, or say 'draw' to generate an image..."**.
3. Regular chat works as normal — the model responds with text.
4. When you ask the model to draw or generate something, it uses the `image_generation` built-in tool and returns an image alongside any explanatory text.
5. MCP tool calls (e.g. web search, memory) continue to work normally in the same conversation.

**Example prompts for image generation:**
```
Draw a sunset over ocean waves with golden hour lighting
Generate an illustration of a robot reading a book
Create a logo for a tech startup — minimal, blue and white
```

**Example prompts that return text only:**
```
What is the capital of France?
Summarize the latest news
How do I reverse a linked list?
```

## Architecture

### Backend

Image generation is handled inside `MCPServerManager.chatWithLLM()` via two early-exit branches that run before the standard agentic loop:

```
chatWithLLM()
  ├─ isImageGenerationModel(model)?    → OpenAIProvider.generateImage()  → ImageGenerationResult
  ├─ isResponsesAPIImageModel(model)?  → chatWithResponsesAPILoop()       → MixedContentResult | string
  └─ otherwise                         → existing Chat Completions agentic loop
```

**Track 1 — Images API** (`dall-e-3`, `dall-e-2`, `gpt-image-1`):
- Calls `POST /v1/images/generations`
- `dall-e-3` / `dall-e-2`: returns a URL (`response_format: "url"`)
- `gpt-image-1`: returns base64 (`response_format: "b64_json"`) as a `data:image/png;base64,...` data-URL
- Default size: `1024x1024`

**Track 2 — Responses API** (`gpt-4.1`, `gpt-4o`, `o3`, `gpt-5`):
- Calls `POST /v1/responses` with `tools: [{ type: "image_generation", size: "1024x1024", quality: "medium" }, ...mcpFunctionTools]`
- Parses the `output[]` array for `message` (text), `image_generation_call` (image), and `function_call` (MCP tool) items
- MCP function calls are executed via the existing `handleToolCall()` mechanism and results sent back via `previous_response_id` chaining
- Returns `MixedContentResult` when images are present, or a plain string when only text is returned

### NDJSON Stream Event

A new event type is emitted on the chat stream:

```json
{ "t": "image", "v": "<url_or_data_url>" }
```

The `v` field contains either:
- An OpenAI CDN URL (expires after 1 hour) for `dall-e-3` / `dall-e-2`
- A `data:image/png;base64,...` data-URL for `gpt-image-1` and Responses API models

Multiple `t: "image"` events can be emitted in a single response (e.g. when a Responses API model generates several images).

### Frontend

**Model detection** (`src/frontend/types.ts`):
```ts
isImageGenerationModel(model)   // dall-e-*, gpt-image-* → dedicated images API
isResponsesAPIImageModel(model) // gpt-4o, gpt-4.1, o3, gpt-5 → Responses API
isImageCapableModel(model)      // either of the above
```

**`ChatInterface.tsx`** handles `t: "image"` events by appending the URL to `message.generatedImageUrls[]` on the assistant message.

**`ChatMessage.tsx`** renders `generatedImageUrls` as `<img>` elements above the text content in assistant messages, with a download button on hover.

### Return Types

```ts
// Dedicated image models → every prompt returns this
type ImageGenerationResult = { kind: 'image'; urls: string[] };

// Responses API models → when model generates images alongside text
type MixedContentResult = { kind: 'mixed'; text: string; imageUrls: string[] };
```

## Model Classifier Patterns

The model type is determined by regex pattern matching. To add a new image-capable model, update the patterns in:

- **Backend**: `src/mcp/llmProviders.ts` — `IMAGE_GENERATION_MODEL_PATTERNS` or `RESPONSES_API_IMAGE_MODEL_PATTERNS`
- **Frontend**: `src/frontend/types.ts` — same constants

```ts
// Images API (always generates image, no text)
const IMAGE_GENERATION_MODEL_PATTERNS = [/^dall-e-/i, /^gpt-image-/i];

// Responses API (chat + optional image generation)
const RESPONSES_API_IMAGE_MODEL_PATTERNS = [/^gpt-4o/i, /^gpt-4\.1/i, /^o3/i, /^gpt-5/i];
```

## Conversation Persistence

Generated images are not stored in the `ai_agent_conversation_messages` database table. A text placeholder is persisted instead:

```
[Generated image: <first 60 chars of prompt>]
```

This keeps the conversation history browsable without storing large binary blobs or expiring URLs.

## Provider Behavior

The Track 2 (Responses API) branch uses a combined condition to dispatch:

```ts
if (isResponsesAPIImageModel(this.model) && isResponsesAPICapable(this.llmProvider)) {
  // Responses API path — image generation available
}
// otherwise: falls through to standard Chat Completions agentic loop
```

This means provider capability and model name are checked together:

| Provider | Model | Behavior |
|---|---|---|
| OpenAI | `gpt-4.1`, `gpt-4o`, `o3`, `gpt-5` | Responses API → image generation enabled |
| GitHub Copilot | `gpt-4.1`, `gpt-4o` | Falls through → normal Chat Completions (no images) |
| Ollama | any | Falls through → normal Chat Completions (no images) |
| Any provider | `dall-e-3`, `dall-e-2`, `gpt-image-1` | Images API (Track 1) — throws if provider lacks `generateImage()` |

This design avoids errors when non-OpenAI providers use model names that happen to match the Responses API patterns (e.g. GitHub Copilot serving `gpt-4o`).

## Limitations

- Image generation is only available when `LLM_PROVIDER=openai`.
- Ollama and GitHub Copilot providers silently fall back to standard chat when a Responses-API-capable model name is used — no images are generated but no error is thrown.
- OpenAI CDN URLs returned by `dall-e-3`/`dall-e-2` expire after approximately 1 hour. Download the image immediately if you need to keep it.
- Image generation via the Responses API uses `gpt-image-1` internally (OpenAI routes automatically); the model charged to your account may differ from the chat model selected.
- The Responses API image generation tool defaults to `1024x1024` at `medium` quality. These can be changed in `chatWithResponsesAPILoop()` in `src/mcp/mcpManager.ts`.
