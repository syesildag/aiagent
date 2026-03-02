import React from 'react';

// Jest mock: render children as plain text to avoid ESM issues
const ReactMarkdown = ({ children }: { children: React.ReactNode }) => (
  <span>{children}</span>
);

export default ReactMarkdown;
