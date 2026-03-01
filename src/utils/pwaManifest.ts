export interface PwaManifest {
  name: string;
  short_name: string;
  description: string;
  display: string;
  orientation: string;
  background_color: string;
  theme_color: string;
  start_url: string;
  scope: string;
  icons: Array<{
    src: string;
    sizes: string;
    type: string;
    purpose: string;
  }>;
}

export function generateManifest(agentName: string): PwaManifest {
  return {
    name: `AI Agent Chat – ${agentName}`,
    short_name: 'AI Chat',
    description: `Chat with AI Agent: ${agentName}`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#1976d2',
    start_url: `/front/${agentName}`,
    scope: '/',
    icons: [
      {
        src: '/static/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/static/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/static/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
