// src/pages/Login.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { auth } from "../server.js/firebase";

export default function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError("");

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setError("Please enter your email and password.");
      return;
    }

    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, trimmedEmail, password);
      navigate("/dashboard");
    } catch (err) {
      console.error("Email login error:", err);
      const code = err.code || "";

      if (code.includes("auth/wrong-password") || code.includes("wrong-password")) {
        setError("Incorrect password.");
      } else if (code.includes("auth/user-not-found") || code.includes("user-not-found")) {
        setError("Account not found.");
      } else if (code.includes("auth/invalid-email") || code.includes("invalid-email")) {
        setError("Invalid email format.");
      } else if (code.includes("auth/too-many-requests")) {
        setError("Too many attempts. Please try again later.");
      } else {
        setError(err.message || "Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      navigate("/dashboard");
    } catch (err) {
      console.error("Google login error:", err);
      setError("Google login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-500 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 border border-green-100">

        {/* Title */}
        <h1 className="text-3xl font-bold text-emerald-700 mb-2">Welcome Back</h1>
        <p className="text-gray-600 mb-6 text-sm">
          Sign in to your productivity dashboard
        </p>

        {/* Error Display */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-100 text-red-700 p-2 text-sm">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-emerald-700">Email</label>
            <input
              type="email"
              required
              className="w-full mt-1 p-3 border rounded-lg focus:ring-2 focus:ring-emerald-400 outline-none text-sm"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-emerald-700">Password</label>
            <input
              type="password"
              required
              className="w-full mt-1 p-3 border rounded-lg focus:ring-2 focus:ring-emerald-400 outline-none text-sm"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        {/* Divider */}
        <div className="flex items-center my-6">
          <div className="flex-grow border-t border-gray-200"></div>
          <span className="mx-2 text-sm text-gray-500">or</span>
          <div className="flex-grow border-t border-gray-200"></div>
        </div>

        {/* Google Sign-in */}
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full py-3 border rounded-lg flex items-center justify-center gap-2 hover:bg-gray-50 transition disabled:opacity-60"
        >
          <img
            src="https://www.svgrepo.com/show/355037/google.svg"
            alt="Google"
            className="w-5 h-5"
          />
          <span className="text-sm font-medium">Continue with Google</span>
        </button>

        {/* Signup redirect */}
        <p className="text-center text-sm text-gray-600 mt-6">
          Don't have an account?{" "}
          <button
            onClick={() => navigate("/signup")}
            className="text-emerald-700 font-medium hover:underline"
          >
            Create one
          </button>
        </p>
      </div>
    </div>
  );
}
