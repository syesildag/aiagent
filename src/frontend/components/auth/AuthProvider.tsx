import React, { useCallback, useEffect, useState } from 'react';
import { AuthContext } from './AuthContext';

interface AuthProviderProps {
  children: React.ReactNode;
  agentName: string;
  loginTitle?: string;
  darkMode: boolean;
  toggleDarkMode: () => void;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({
  children,
  agentName,
  loginTitle,
  darkMode,
  toggleDarkMode,
}) => {
  const [session, setSession] = useState<string | null>(
    sessionStorage.getItem('session')
  );
  const [username, setUsername] = useState<string | null>(
    sessionStorage.getItem('username')
  );

  // Validate the session stored in sessionStorage against the backend on mount.
  // If it has expired (401), clear it so the user sees the login screen instead
  // of a broken ChatInterface. Fails open on network errors.
  useEffect(() => {
    if (!session) return;
    fetch('/session/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    })
      .then((res) => {
        if (res.status === 401) logout();
      })
      .catch(() => {/* network error — fail open */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once on mount only

  const login = useCallback(async (username: string, password: string) => {
    const credentials = btoa(`${username}:${password}`);
    let response: Response;
    try {
      response = await fetch('/login', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
    } catch {
      throw new Error('Connection error — please try again');
    }

    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Invalid username or password' : 'Login failed');
    }

    const data = await response.json();
    setSession(data.session);
    setUsername(username);
    sessionStorage.setItem('session', data.session);
    sessionStorage.setItem('username', username);
    // Hard-reload so the new window never contains the password field.
    // Android Chrome sets FLAG_SECURE for any window that rendered
    // <input type="password">, which blocks screenshots for the session.
    // A reload lands directly on ChatInterface (session is in sessionStorage),
    // so FLAG_SECURE is never applied to the post-login window.
    window.location.reload();
  }, []);

  const logout = useCallback(async () => {
    if (session) {
      try {
        await fetch('/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session }),
        });
      } catch (error) {
        console.error('Logout error:', error);
      }
    }
    window.speechSynthesis.cancel();
    setSession(null);
    setUsername(null);
    sessionStorage.removeItem('session');
    sessionStorage.removeItem('username');
  }, [session]);

  return (
    <AuthContext.Provider
      value={{
        session,
        username,
        agentName,
        loginTitle,
        darkMode,
        toggleDarkMode,
        login,
        logout,
        isAuthenticated: !!session,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
