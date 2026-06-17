"use client";
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) alert(error.message);
      else {
        alert("Account created! You can now log in.");
        setIsSignUp(false);
      }
    } else {
      const { error, data } = await supabase.auth.signInWithPassword({ email, password });
      
      if (error) {
        alert(error.message);
      } else if (data.user) {
        // Since we use createBrowserClient, cookies are now set automatically.
        // A hard refresh ensures the middleware picks up the new cookie.
        window.location.href = '/';
      }
    }
    setLoading(false);
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white p-10 rounded-[32px] shadow-xl border border-gray-100">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-[#25D366] rounded-2xl flex items-center justify-center font-black text-2xl text-white shadow-lg mb-4 italic text-center">R</div>
          <h1 className="text-2xl font-black text-[#111b21]">WA Recruit</h1>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">
            {isSignUp ? "Sign Up" : "Login"}
          </p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <input 
            required type="email" placeholder="Email" 
            className="w-full p-4 bg-gray-50 rounded-2xl outline-none focus:ring-2 focus:ring-[#25D366]"
            onChange={(e) => setEmail(e.target.value)}
          />
          <input 
            required type="password" placeholder="Password" 
            className="w-full p-4 bg-gray-50 rounded-2xl outline-none focus:ring-2 focus:ring-[#25D366]"
            onChange={(e) => setPassword(e.target.value)}
          />
          <button 
            disabled={loading}
            className="w-full bg-[#111b21] text-white py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-black transition disabled:opacity-50"
          >
            {loading ? "Processing..." : isSignUp ? "Create Account" : "Enter Dashboard"}
          </button>
        </form>
        
        <div className="text-center mt-8">
          <button type="button" onClick={() => setIsSignUp(!isSignUp)} className="text-xs font-bold text-gray-400 hover:text-[#25D366]">
            {isSignUp ? "Already a member? Login" : "New recruiter? Sign Up"}
          </button>
        </div>
      </div>
    </div>
  );
}