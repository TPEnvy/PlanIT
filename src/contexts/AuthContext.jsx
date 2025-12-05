// src/contexts/AuthContext.jsx

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { auth } from "../server.js/firebase";

// Create context
const AuthContext = createContext(null);

// Hook to use in components
export function useAuth() {
  return useContext(AuthContext);
}

// Provider to wrap your app in main.jsx
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);      // current Firebase user
  const [loading, setLoading] = useState(true); // true until we know auth state

  // Listen to auth state changes once
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser || null);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Signup with email + password + send verification
  const signup = async (email, password) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    if (cred.user && !cred.user.emailVerified) {
      try {
        await sendEmailVerification(cred.user);
      } catch (err) {
        console.error("Error sending verification email:", err);
      }
    }

    return cred;
  };

  // Login
  const login = (email, password) => {
    return signInWithEmailAndPassword(auth, email, password);
  };

  // Logout
  const logout = () => {
    return signOut(auth);
  };

  const value = {
    user,
    loading,
    signup,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthContext;
