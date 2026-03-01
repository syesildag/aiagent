export interface ToolApproval {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  description: string;
  status: 'pending' | 'approved' | 'denied';
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

export interface AuthContextValue {
  session: string | null;
  username: string | null;
  agentName: string;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}
