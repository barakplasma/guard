import { createContext, useContext, useEffect, useState } from 'react';
import { pb } from './pocketbase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(pb.authStore.record);

  useEffect(() => pb.authStore.onChange((_token, record) => setUser(record)), []);

  const value = {
    user,
    isCommander: user?.role === 'commander',
    login: (email, password) => pb.collection('users').authWithPassword(email, password),
    signup: async (email, password, name) => {
      await pb.collection('users').create({
        email,
        password,
        passwordConfirm: password,
        name,
      });
      return pb.collection('users').authWithPassword(email, password);
    },
    logout: () => pb.authStore.clear(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
