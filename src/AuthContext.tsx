import React, { createContext, useState, useEffect, ReactNode, useMemo, useCallback } from 'react';
import { User, RolePermissions, UserSettings } from './types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  permissions: RolePermissions | null;
  settings: UserSettings | null;
  login: (token: string, user: User, permissions: RolePermissions, settings: UserSettings) => void;
  logout: () => void;
  updateSettings: (settings: UserSettings) => void;
  updatePermissions: (permissions: RolePermissions) => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<RolePermissions | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    const storedPermissions = localStorage.getItem('permissions');
    const storedSettings = localStorage.getItem('settings');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      if (storedPermissions) setPermissions(JSON.parse(storedPermissions));
      
      // Ensure default light theme
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
      
      if (storedSettings) {
        setSettings(JSON.parse(storedSettings));
      } else {
        setSettings({ theme: 'light' });
      }
    } else {
      // Not logged in, ensure default light theme
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
  }, []);

  // Ensure theme is always light
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  }, []);

  useEffect(() => {
    if (!token) return;

    const fetchPermissions = async () => {
      try {
        const response = await fetch('/api/me/permissions', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const newPermissions = await response.json();
          setPermissions(prev => {
            if (JSON.stringify(prev) === JSON.stringify(newPermissions)) return prev;
            localStorage.setItem('permissions', JSON.stringify(newPermissions));
            return newPermissions;
          });
        }
      } catch (error) {
        console.error('Failed to fetch permissions', error);
      }
    };

    fetchPermissions();
    const interval = setInterval(fetchPermissions, 60000); // Increased to 60 seconds

    window.addEventListener('permissions-updated', fetchPermissions);

    return () => {
      clearInterval(interval);
      window.removeEventListener('permissions-updated', fetchPermissions);
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;

    const fetchUserProfile = async () => {
      try {
        const response = await fetch('/api/users', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const allUsers = await response.json();
          const latestMe = allUsers.find((u: any) => u.id === user?.id);
          if (latestMe) {
            if (latestMe.is_active === 0 || latestMe.is_active === false) {
              // User deactivated
              setToken(null);
              setUser(null);
              localStorage.clear();
              window.location.href = '/login';
              return;
            }
            setUser(prev => {
              const updatedUser = { ...prev, ...latestMe } as User;
              if (JSON.stringify(updatedUser) === JSON.stringify(prev)) return prev;
              localStorage.setItem('user', JSON.stringify(updatedUser));
              return updatedUser;
            });
          } else {
            // User deleted
            setToken(null);
            setUser(null);
            localStorage.clear();
            window.location.href = '/login';
          }
        }
      } catch (error) {
        console.error('Failed to fetch user profile', error);
      }
    };

    fetchUserProfile();
    const interval = setInterval(fetchUserProfile, 60000); // Increased to 60 seconds

    window.addEventListener('users-updated', fetchUserProfile);

    return () => {
      clearInterval(interval);
      window.removeEventListener('users-updated', fetchUserProfile);
    };
  }, [token, user?.id]);

  const login = useCallback((newToken: string, newUser: User, newPermissions: RolePermissions, newSettings: UserSettings) => {
    setToken(newToken);
    setUser(newUser);
    setPermissions(newPermissions);
    setSettings(newSettings);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    localStorage.setItem('permissions', JSON.stringify(newPermissions));
    localStorage.setItem('settings', JSON.stringify(newSettings));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setPermissions(null);
    setSettings({ theme: 'light' });
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('permissions');
    localStorage.removeItem('settings');
  }, []);

  const updateSettings = useCallback((newSettings: UserSettings) => {
    setSettings(newSettings);
    localStorage.setItem('settings', JSON.stringify(newSettings));
  }, []);

  const updatePermissions = useCallback((newPermissions: RolePermissions) => {
    setPermissions(newPermissions);
    localStorage.setItem('permissions', JSON.stringify(newPermissions));
  }, []);

  const contextValue = useMemo(() => ({
    user, 
    token, 
    permissions, 
    settings, 
    login, 
    logout, 
    updateSettings,
    updatePermissions,
    isAuthenticated: !!token 
  }), [user, token, permissions, settings, login, logout, updateSettings, updatePermissions]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
