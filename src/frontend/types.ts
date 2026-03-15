export interface ToolApproval {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  description: string;
  status: 'pending' | 'approved' | 'denied';
  schema?: {
    properties?: Record<string, { type?: string; description?: string; [key: string]: unknown }>;
    required?: string[];
  };
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool_approval';
  content: string;
  timestamp: Date;
  /** base64 data URLs of attached images/files, e.g. "data:image/png;base64,..." */
  imageUrls?: string[];
  /** Present when role === 'tool_approval' */
  approval?: ToolApproval;
  /** Generated image URLs/data-URLs from image generation models */
  generatedImageUrls?: string[];
}

/** Models that support image (vision) input */
const VISION_MODEL_PATTERNS = [
  /^gpt-4o/i,
  /^gpt-4.1/i,
  /^gpt-4-turbo/i,
  /^gpt-4-vision/i,
  /^o1/i,
  /^o3/i,
  /^claude-3/i,
  /^claude-opus/i,
  /^gemini/i,
  /llava/i,
  /bakllava/i,
  /vision/i,
  /omni/i,
];

export function isVisionModel(model: string): boolean {
  return VISION_MODEL_PATTERNS.some(pattern => pattern.test(model));
}

/** Dedicated image-generation models that always produce images (Images API) */
const IMAGE_GENERATION_MODEL_PATTERNS = [/^dall-e-/i, /^gpt-image-/i];

export function isImageGenerationModel(model: string): boolean {
  return IMAGE_GENERATION_MODEL_PATTERNS.some(p => p.test(model));
}

/** Chat models that can generate images via the Responses API image_generation tool */
const RESPONSES_API_IMAGE_MODEL_PATTERNS = [/^gpt-4o/i, /^gpt-4\.1/i, /^o3/i, /^gpt-5/i];

export function isResponsesAPIImageModel(model: string): boolean {
  return RESPONSES_API_IMAGE_MODEL_PATTERNS.some(p => p.test(model));
}

/** Returns true if the model can produce images in any form */
export function isImageCapableModel(model: string): boolean {
  return isImageGenerationModel(model) || isResponsesAPIImageModel(model);
}

export interface AuthContextValue {
  session: string | null;
  username: string | null;
  agentName: string;
  loginTitle?: string;
  darkMode: boolean;
  toggleDarkMode: () => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}
