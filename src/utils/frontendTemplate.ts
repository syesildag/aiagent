import * as fs from 'fs';
import * as path from 'path';

let cachedTemplate: string | null = null;

/**
 * Generate HTML template for React frontend
 */
export function generateFrontendHTML(_bundleJs: string, agentName: string): string {
  // Load template from file (cached after first read)
  if (!cachedTemplate) {
    const templatePath = path.join(__dirname, '../frontend/templates/index.html');
    cachedTemplate = fs.readFileSync(templatePath, 'utf-8');
  }
  
  // Replace placeholder with actual agent name
  return cachedTemplate.replace('{{AGENT_NAME}}', agentName);
}
