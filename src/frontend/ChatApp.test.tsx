/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import React from 'react';
import ChatApp from './ChatApp';

// ---------------------------------------------------------------------------
// Mock child components to isolate ChatApp logic
// ---------------------------------------------------------------------------

jest.mock('./components/AuthProvider', () => ({
  AuthProvider: ({
    children,
    agentName,
  }: {
    children: React.ReactNode;
    agentName: string;
  }) => (
    <div data-testid="auth-provider" data-agent-name={agentName}>
      {children}
    </div>
  ),
}));

jest.mock('./components/ChatInterface', () => ({
  ChatInterface: () => <div data-testid="chat-interface">ChatInterface</div>,
}));

jest.mock('./components/LoginScreen', () => ({
  LoginScreen: () => <div data-testid="login-screen">LoginScreen</div>,
}));

// ---------------------------------------------------------------------------
// Mock useAuth so tests can control authentication state
// ---------------------------------------------------------------------------

const mockUseAuth = jest.fn();
jest.mock('./context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatApp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Smoke tests -----------------------------------------------------------

  it('renders without crashing when unauthenticated', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    expect(() => render(<ChatApp agentName="TestAgent" />)).not.toThrow();
  });

  it('renders without crashing when authenticated', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    expect(() => render(<ChatApp agentName="TestAgent" />)).not.toThrow();
  });

  // --- Route rendering -------------------------------------------------------

  it('shows LoginScreen when user is not authenticated', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    render(<ChatApp agentName="TestAgent" />);

    expect(screen.getByTestId('login-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-interface')).not.toBeInTheDocument();
  });

  it('shows ChatInterface when user is authenticated', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    render(<ChatApp agentName="TestAgent" />);

    expect(screen.getByTestId('chat-interface')).toBeInTheDocument();
    expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument();
  });

  // --- Authentication transitions --------------------------------------------

  it('switches from LoginScreen to ChatInterface when user authenticates', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    const { rerender } = render(<ChatApp agentName="TestAgent" />);

    expect(screen.getByTestId('login-screen')).toBeInTheDocument();

    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    rerender(<ChatApp agentName="TestAgent" />);

    expect(screen.getByTestId('chat-interface')).toBeInTheDocument();
    expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument();
  });

  it('switches from ChatInterface back to LoginScreen when user logs out', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    const { rerender } = render(<ChatApp agentName="TestAgent" />);

    expect(screen.getByTestId('chat-interface')).toBeInTheDocument();

    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    rerender(<ChatApp agentName="TestAgent" />);

    expect(screen.getByTestId('login-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-interface')).not.toBeInTheDocument();
  });

  // --- agentName prop --------------------------------------------------------

  it('passes agentName to AuthProvider', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    render(<ChatApp agentName="MyAgent" />);

    expect(screen.getByTestId('auth-provider')).toHaveAttribute(
      'data-agent-name',
      'MyAgent'
    );
  });

  it('forwards an updated agentName to AuthProvider on rerender', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    const { rerender } = render(<ChatApp agentName="AgentV1" />);

    expect(screen.getByTestId('auth-provider')).toHaveAttribute(
      'data-agent-name',
      'AgentV1'
    );

    rerender(<ChatApp agentName="AgentV2" />);

    expect(screen.getByTestId('auth-provider')).toHaveAttribute(
      'data-agent-name',
      'AgentV2'
    );
  });

  it('handles an empty agentName string', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    render(<ChatApp agentName="" />);

    expect(screen.getByTestId('auth-provider')).toHaveAttribute(
      'data-agent-name',
      ''
    );
  });

  // --- Theme / structure -----------------------------------------------------

  it('injects a CssBaseline <style> tag into the document head', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    render(<ChatApp agentName="TestAgent" />);

    // MUI CssBaseline inserts at least one <style> element
    expect(document.head.querySelector('style')).not.toBeNull();
  });

  it('wraps all content inside AuthProvider', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    render(<ChatApp agentName="TestAgent" />);

    const provider = screen.getByTestId('auth-provider');
    const loginScreen = screen.getByTestId('login-screen');

    expect(provider).toContainElement(loginScreen);
  });

  it('wraps ChatInterface inside AuthProvider when authenticated', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    render(<ChatApp agentName="TestAgent" />);

    const provider = screen.getByTestId('auth-provider');
    const chatInterface = screen.getByTestId('chat-interface');

    expect(provider).toContainElement(chatInterface);
  });
});
