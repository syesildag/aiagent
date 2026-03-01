import React, { useCallback, useState } from 'react';
import { AuthContext } from '../context/AuthContext';

interface AuthProviderProps {
  children: React.ReactNode;
  agentName: string;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ 
  children,
  agentName 
}) => {
  const [session, setSession] = useState<string | null>(
    sessionStorage.getItem('session')
  );
  const [username, setUsername] = useState<string | null>(
    sessionStorage.getItem('username')
  );

  const login = useCallback(async (username: string, password: string) => {
    const credentials = btoa(`${username}:${password}`);
    const response = await fetch('/login', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Authentication failed');
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
        login,
        logout,
        isAuthenticated: !!session,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
