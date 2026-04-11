import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import { auth, firebaseInitError } from "../server.js/firebase";
import { useAuth } from "../contexts/AuthContext";
import PageTransition from "../components/PageTransition";

export default function Signup() {
  const navigate = useNavigate();
  const { signup } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password || !confirmPassword) {
      setError("Please fill in all fields.");
      return;
    }

    if (password !== confirmPassword) {
      return setError("Passwords do not match.");
    }

    if (password.length < 6) {
      return setError("Password must be at least 6 characters.");
    }

    setLoading(true);

    try {
      await signup(trimmedEmail, password);
      navigate("/check-email");
    } catch (err) {
      console.error("Signup error:", err);
      const code = err.code || "";

      if (code.includes("email-already-in-use")) {
        setError("Email already registered.");
      } else if (code.includes("invalid-email")) {
        setError("Invalid email format.");
      } else if (code.includes("weak-password")) {
        setError("Password must be at least 6 characters.");
      } else {
        setError("Signup failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
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
      console.error("Google signup error:", err);
      setError(
        "Google sign-in failed. Make sure this domain is authorized in Firebase Authentication."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageTransition>
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-500 p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 border border-green-100">
          <h1 className="text-3xl font-bold text-emerald-700 mb-2">
            Create Account
          </h1>
          <p className="text-gray-600 mb-6 text-sm">
            Sign up to start organizing your tasks
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

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-emerald-700">
                Email
              </label>
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
              <label className="text-sm font-medium text-emerald-700">
                Password
              </label>
              <input
                type="password"
                required
                className="w-full mt-1 p-3 border rounded-lg focus:ring-2 focus:ring-emerald-400 outline-none text-sm"
                placeholder="********"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-emerald-700">
                Confirm Password
              </label>
              <input
                type="password"
                required
                className="w-full mt-1 p-3 border rounded-lg focus:ring-2 focus:ring-emerald-400 outline-none text-sm"
                placeholder="********"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition disabled:opacity-60"
            >
              {loading ? "Creating account..." : "Sign Up"}
            </button>
          </form>

          <div className="flex items-center my-6">
            <div className="flex-grow border-t border-gray-200"></div>
            <span className="mx-2 text-sm text-gray-500">or</span>
            <div className="flex-grow border-t border-gray-200"></div>
          </div>

          <button
            onClick={handleGoogleSignup}
            disabled={loading}
            className="w-full py-3 border rounded-lg flex items-center justify-center gap-2 hover:bg-gray-50 transition disabled:opacity-60"
          >
            <img
              src="https://www.svgrepo.com/show/355037/google.svg"
              alt="Google"
              className="w-5 h-5"
            />
            <span className="text-sm font-medium">Sign Up with Google</span>
          </button>

          <p className="text-center text-sm text-gray-600 mt-6">
            Already have an account?{" "}
            <button
              onClick={() => navigate("/login")}
              className="text-emerald-700 font-medium hover:underline"
            >
              Sign In
            </button>
          </p>
        </div>
      </div>
    </PageTransition>
  );
}
