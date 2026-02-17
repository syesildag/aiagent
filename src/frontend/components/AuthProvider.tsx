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
