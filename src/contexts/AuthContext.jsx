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
import { auth, firebaseInitError } from "../server.js/firebase";

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
    if (!auth) {
      setUser(null);
      setLoading(false);
      return undefined;
    }

    const fallbackTimer = window.setTimeout(() => {
      setLoading(false);
    }, 8000);

    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        window.clearTimeout(fallbackTimer);
        setUser(firebaseUser || null);
        setLoading(false);
      },
      (error) => {
        window.clearTimeout(fallbackTimer);
        console.error("Firebase auth state error:", error);
        setUser(null);
        setLoading(false);
      }
    );

    return () => {
      window.clearTimeout(fallbackTimer);
      unsubscribe();
    };
  }, []);

  // Signup with email + password + send verification
  const signup = async (email, password) => {
    if (!auth) {
      throw new Error(firebaseInitError || "Firebase auth is unavailable.");
    }

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
    if (!auth) {
      return Promise.reject(
        new Error(firebaseInitError || "Firebase auth is unavailable.")
      );
    }

    return signInWithEmailAndPassword(auth, email, password);
  };

  // Logout
  const logout = () => {
    if (!auth) {
      return Promise.resolve();
    }

    return signOut(auth);
  };

  const value = {
    user,
    loading,
    signup,
    login,
    logout,
    firebaseError: firebaseInitError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthContext;
