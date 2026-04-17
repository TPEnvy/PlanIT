import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import { auth, firebaseInitError } from "../server.js/firebase";
import { useAuth } from "../contexts/AuthContext";
import PageTransition from "../components/PageTransition";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!email || !password) {
      setError("Please enter email and password.");
      return;
    }

    setLoading(true);

    try {
      const userCredential = await login(email, password);
      const user = userCredential.user;

      if (!user.emailVerified) {
        setError("Please verify your email before logging in.");
        navigate("/check-email");
        return;
      }

      navigate("/dashboard");
    } catch (err) {
      console.error("Login error:", err);
      setError("Invalid email or password.");
    }

    setLoading(false);
  };

  const handlePasswordReset = async () => {
    setError("");
    setMessage("");

    if (!auth) {
      setError(firebaseInitError || "Firebase auth is unavailable.");
      return;
    }

    if (!email) {
      setError("Enter your email to reset password.");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      setMessage("Password reset email sent. Check your inbox.");
    } catch (err) {
      console.error("Reset error:", err);
      setError("Failed to send reset email.");
    }
  };

  const handleGoogleLogin = async () => {
    if (!auth) {
      setError(firebaseInitError || "Firebase auth is unavailable.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        const code = err?.code || "";

        if (
          code.includes("popup-blocked") ||
          code.includes("popup-closed-by-user") ||
          code.includes("cancelled-popup-request")
        ) {
          await signInWithRedirect(auth, provider);
          return;
        }

        throw err;
      }

      navigate("/dashboard");
    } catch (err) {
      console.error("Google login error:", err);
      setError(
        "Google sign-in failed. Make sure this domain is authorized in Firebase Authentication."
      );
    }

    setLoading(false);
  };

  return (
    <PageTransition>
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-500 p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 border border-green-100">
          <h1 className="text-3xl font-bold text-emerald-700 mb-2">
            Welcome Back
          </h1>

          <p className="text-gray-600 mb-6 text-sm">
            Login to manage your tasks
          </p>

          {firebaseInitError && (
            <div className="mb-4 rounded-lg bg-amber-100 text-amber-800 p-3 text-sm">
              Firebase environment variables are missing on this deployment.
              The app is using its built-in fallback Firebase config instead.
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg bg-red-100 text-red-700 p-2 text-sm">
              {error}
            </div>
          )}

          {message && (
            <div className="mb-4 rounded-lg bg-green-100 text-green-700 p-2 text-sm">
              {message}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-emerald-700">
                Email
              </label>

              <input
                type="email"
                autoComplete="email"
                required
                className="w-full mt-1 p-3 border rounded-lg focus:ring-2 focus:ring-emerald-400 outline-none text-sm"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-emerald-700">
                Password
              </label>

              <input
                type="password"
                autoComplete="current-password"
                required
                className="w-full mt-1 p-3 border rounded-lg focus:ring-2 focus:ring-emerald-400 outline-none text-sm"
                placeholder="********"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition disabled:opacity-60"
            >
              {loading ? "Logging in..." : "Login"}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={handlePasswordReset}
              className="text-sm text-emerald-700 hover:underline"
            >
              Forgot Password?
            </button>
          </div>

          <div className="flex items-center my-6">
            <div className="flex-grow border-t border-gray-200"></div>
            <span className="mx-2 text-sm text-gray-500">or</span>
            <div className="flex-grow border-t border-gray-200"></div>
          </div>

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

          <p className="text-center text-sm text-gray-600 mt-6">
            Don't have an account?{" "}
            <button
              onClick={() => navigate("/signup")}
              className="text-emerald-700 font-medium hover:underline"
            >
              Sign Up
            </button>
          </p>
        </div>
      </div>
    </PageTransition>
  );
}
