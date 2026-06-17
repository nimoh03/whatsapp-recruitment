"use client";
import React, { useState, useEffect } from 'react';
import Sidebar from './components/dashboard/Sidebar';
import JobCard from './components/dashboard/JobCard';
import CandidateTable from './components/dashboard/CandidateTable';
import ChatWidget from './components/dashboard/ChatWidget';
import JobModal from './components/JobModal';
import { Job, Candidate } from './types';
import { supabase } from './lib/supabase'; // Import Supabase

export default function RecruiterHub() {
  const [activeTab, setActiveTab] = useState<'jobs' | 'settings'>('jobs');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [activeChat, setActiveChat] = useState<Candidate | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // --- REAL DATA STATE ---
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [geminiKey, setGeminiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSaved, setSettingsSaved] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // --- FETCH JOBS FROM SUPABASE ---
  const fetchJobs = async () => {
    setLoading(true);
    
    // 1. Get the current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 2. Fetch jobs for this recruiter
    // Lead Dev Note: We also need to get the count of candidates later, 
    // but for now let's get the jobs and set default stats to 0.
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('recruiter_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Fetch error:", error.message);
    } else {
      // Map the DB data to our UI Job interface
      const formattedJobs: Job[] = data.map(dbJob => ({
        id: dbJob.id,
        title: dbJob.title,
        location: dbJob.locations ? dbJob.locations[0] : 'Remote',
        candidatesCount: 0, // We will hook this up to real counts next
        stats: { screening: 0, qualified: 0, disqualified: 0, attention: 0 }
      }));
      setJobs(formattedJobs);
    }
    setLoading(false);
  };

  const fetchSettings = async () => {
    setSettingsLoading(true);
    setSettingsError('');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSettingsError('Unable to load profile settings. Please login again.');
      setSettingsLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('gemini_key, groq_key')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Fetch settings error:', error.message);
      setSettingsError('Unable to load saved keys.');
      setSettingsLoading(false);
      return;
    }

    setGeminiKey(data?.gemini_key || '');
    setGroqKey(data?.groq_key || '');
    setSettingsLoading(false);
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    setSettingsSaved(null);
    setSettingsError('');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSettingsError('Unable to identify the current user.');
      setSavingSettings(false);
      return;
    }

    const { error } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        gemini_key: geminiKey.trim(),
        groq_key: groqKey.trim(),
      }, { onConflict: 'id' });

    if (error) {
      console.error('Save settings error:', error.message);
      setSettingsError('Unable to save keys.');
    } else {
      setSettingsSaved('Keys saved successfully.');
    }

    setSavingSettings(false);
  };

  useEffect(() => {
    fetchJobs();
    fetchSettings();
  }, []);

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'settings' ? (
          <div className="flex-1 overflow-y-auto p-10">
            <header className="mb-8">
              <h1 className="text-3xl font-black text-[#111b21]">Bot Settings</h1>
              <p className="text-sm text-gray-500 mt-2">Save your Gemini and Groq keys here. The WhatsApp bot reads these values from your Supabase profile.</p>
            </header>

            <div className="max-w-3xl">
              <div className="bg-white p-8 rounded-4xl shadow-sm border border-gray-100 space-y-6">
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-gray-600">Gemini API Key</label>
                  <textarea
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    rows={3}
                    className="w-full mt-3 p-4 border border-gray-200 rounded-3xl bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/30"
                    placeholder="Enter your Gemini API key"
                  />
                  <p className="text-xs text-gray-400 mt-2">Used for intent filtering and response generation when Gemini is enabled.</p>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-gray-600">Groq API Key</label>
                  <textarea
                    value={groqKey}
                    onChange={(e) => setGroqKey(e.target.value)}
                    rows={3}
                    className="w-full mt-3 p-4 border border-gray-200 rounded-3xl bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/30"
                    placeholder="Enter your Groq API key"
                  />
                  <p className="text-xs text-gray-400 mt-2">Used for Groq model calls when Groq is selected as a provider.</p>
                </div>

                {settingsError ? (
                  <div className="text-sm text-red-600">{settingsError}</div>
                ) : settingsSaved ? (
                  <div className="text-sm text-green-600">{settingsSaved}</div>
                ) : null}

                <div className="flex flex-wrap gap-3 items-center">
                  <button
                    onClick={saveSettings}
                    disabled={savingSettings}
                    className="bg-[#25D366] text-white font-black px-8 py-3 rounded-full shadow-lg hover:bg-[#1fa854] disabled:opacity-50"
                  >
                    {savingSettings ? 'Saving...' : 'Save Keys'}
                  </button>
                  {settingsLoading && (
                    <span className="text-sm text-gray-500">Loading saved keys…</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : selectedJob ? (
          <CandidateTable 
            job={selectedJob} 
            onBack={() => setSelectedJob(null)} 
            onSelectCandidate={(c) => setActiveChat(c)}
          />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <header className="h-24 flex items-center justify-between px-10">
              <div>
                <h1 className="text-2xl font-black text-[#111b21]">My Job Bots</h1>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Managing {jobs.length} Active bots</p>
              </div>
              <button 
                onClick={() => setIsModalOpen(true)} 
                className="bg-[#25D366] text-white px-8 py-3 rounded-full font-black shadow-lg shadow-[#25D366]/20 transition-transform hover:scale-105 active:scale-95"
              >
                + POST NEW JOB
              </button>
            </header>
            
            {loading ? (
              <div className="flex-1 flex items-center justify-center h-64">
                <div className="w-10 h-10 border-4 border-gray-200 border-t-[#25D366] rounded-full animate-spin"></div>
              </div>
            ) : jobs.length === 0 ? (
              <div className="p-10 text-center">
                <div className="bg-white p-12 rounded-[40px] shadow-sm border border-dashed border-gray-300">
                  <p className="text-gray-400 font-bold">No job bots created yet.</p>
                  <button onClick={() => setIsModalOpen(true)} className="mt-4 text-[#25D366] font-black uppercase text-xs tracking-widest hover:underline">
                    Create your first bot →
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {jobs.map(j => (
                  <JobCard key={j.id} job={j} onClick={() => setSelectedJob(j)} />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <ChatWidget candidate={activeChat} onClose={() => setActiveChat(null)} />
      <JobModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}