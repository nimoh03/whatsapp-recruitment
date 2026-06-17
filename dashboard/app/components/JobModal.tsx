"use client";
import React, { useState } from 'react';
import { supabase } from '../lib/supabase'; // Import our client

interface JobModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function JobModal({ isOpen, onClose }: JobModalProps) {
  // --- 1. SETTINGS & STEP LOGIC ---
  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [isLazyMode, setIsLazyMode] = useState<boolean>(false);
  
  // --- 2. FORM DATA STATE ---
  const [jobTitle, setJobTitle] = useState('');
  const [locations, setLocations] = useState<string[]>(['']);
  
  const [requirements, setRequirements] = useState<string[]>(['']);
  const [lazyRequirements, setLazyRequirements] = useState('');
  
  const [disqualifiers, setDisqualifiers] = useState<string[]>(['']);
  const [requiresTraining, setRequiresTraining] = useState<boolean>(false);
  
  const [vibe, setVibe] = useState<string>('pro');
  const [salaryMin, setSalaryMin] = useState<string>('');
  const [salaryMax, setSalaryMax] = useState<string>('');
  
  const [mustAsk, setMustAsk] = useState<string>('');
  const [actionType, setActionType] = useState('Send WhatsApp DM');
  const [actionValue, setActionValue] = useState('');

  // --- 3. HELPERS ---
  const addField = (list: string[], setList: React.Dispatch<React.SetStateAction<string[]>>) => {
    setList([...list, '']);
  };

  const updateField = (index: number, value: string, list: string[], setList: React.Dispatch<React.SetStateAction<string[]>>) => {
    const newList = [...list];
    newList[index] = value;
    setList(newList);
  };

  // --- 4. THE PUBLISH LOGIC ---
  const handlePublish = async () => {
    setLoading(true);
    
    // Get current user ID
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert("Please log in again.");
      return;
    }

    const payload = {
      recruiter_id: user.id,
      title: jobTitle,
      locations: locations.filter(l => l.trim() !== ''),
      requirements: isLazyMode ? [lazyRequirements] : requirements.filter(r => r.trim() !== ''),
      disqualifiers: disqualifiers.filter(d => d.trim() !== ''),
      requires_training: requiresTraining,
      vibe: vibe,
      salary_min: salaryMin ? parseInt(salaryMin) : null,
      salary_max: salaryMax ? parseInt(salaryMax) : null,
      must_ask_question: mustAsk,
      final_action_type: actionType,
      final_action_value: actionValue,
      is_active: true
    };

    const { error } = await supabase.from('jobs').insert([payload]);

    if (error) {
      alert("Error: " + error.message);
    } else {
      alert("🚀 Job Bot Published Successfully!");
      onClose();
      window.location.reload(); // Refresh to see the new job on dashboard
    }
    setLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-6 border-b flex justify-between items-center bg-[#f0f2f5] rounded-t-3xl text-center">
          <div>
            <h2 className="text-xl font-black text-[#3b4a54]">Create New Job Bot</h2>
            <p className="text-xs font-bold text-[#25D366] uppercase tracking-widest">Step {step} of 5</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-3xl font-light">&times;</button>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1.5 bg-gray-100">
          <div className="h-full bg-[#25D366] transition-all duration-500" style={{ width: `${(step / 5) * 100}%` }}></div>
        </div>

        {/* Body */}
        <div className="p-8 overflow-y-auto flex-1">
          
          {step === 1 && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              <h3 className="font-black text-lg text-[#111b21]">Basic Info & Locations</h3>
              <input 
                type="text" 
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="Job Title (e.g. Software Engineer)" 
                className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-[#25D366]" 
              />
              
              <div className="space-y-3">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Target Locations</label>
                {locations.map((loc, i) => (
                  <input key={i} value={loc} onChange={(e) => updateField(i, e.target.value, locations, setLocations)} placeholder="City or Region" className="w-full p-3 border rounded-xl" />
                ))}
                <button onClick={() => addField(locations, setLocations)} className="text-[#25D366] text-xs font-bold hover:underline">+ Add another location</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              <div className="flex justify-between items-center">
                <h3 className="font-black text-lg text-[#111b21]">Requirements</h3>
                <button onClick={() => setIsLazyMode(!isLazyMode)} className="text-[10px] bg-[#111b21] text-white px-3 py-1.5 rounded-full font-black uppercase tracking-tighter">
                  {isLazyMode ? "✨ List Mode" : "😴 Lazy Mode"}
                </button>
              </div>

              {isLazyMode ? (
                <textarea 
                  rows={8} 
                  value={lazyRequirements}
                  onChange={(e) => setLazyRequirements(e.target.value)}
                  placeholder="Paste requirements here..." 
                  className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-[#25D366]"
                ></textarea>
              ) : (
                <div className="space-y-3">
                  {requirements.map((req, i) => (
                    <input key={i} value={req} onChange={(e) => updateField(i, e.target.value, requirements, setRequirements)} placeholder="e.g. 2 years React experience" className="w-full p-3 border rounded-xl" />
                  ))}
                  <button onClick={() => addField(requirements, setRequirements)} className="text-[#25D366] text-xs font-bold">+ Add requirement</button>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              <h3 className="font-black text-lg text-[#111b21]">Screening Criteria</h3>
              <div className="space-y-3">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Automatic Disqualifiers</label>
                {disqualifiers.map((dis, i) => (
                  <input key={i} value={dis} onChange={(e) => updateField(i, e.target.value, disqualifiers, setDisqualifiers)} placeholder="e.g. No personal laptop" className="w-full p-3 border rounded-xl" />
                ))}
                <button onClick={() => addField(disqualifiers, setDisqualifiers)} className="text-red-500 text-xs font-bold">+ Add rejection rule</button>
              </div>

              <div className="p-5 bg-gray-50 rounded-2xl flex items-center justify-between border border-gray-100">
                <span className="text-sm font-bold text-[#111b21]">Provide Training?</span>
                <div className="flex bg-white rounded-xl p-1 border">
                  <button onClick={() => setRequiresTraining(false)} className={`px-5 py-2 rounded-lg text-[10px] font-black transition ${!requiresTraining ? 'bg-[#111b21] text-white' : 'text-gray-400'}`}>NO</button>
                  <button onClick={() => setRequiresTraining(true)} className={`px-5 py-2 rounded-lg text-[10px] font-black transition ${requiresTraining ? 'bg-[#25D366] text-white' : 'text-gray-400'}`}>YES</button>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              <h3 className="font-black text-lg text-[#111b21]">Vibe & Compensation</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: 'pro', label: '👔 Professional' },
                  { id: 'casual', label: '🇳🇬 Casual' },
                  { id: 'hype', label: '⚡ Energetic' },
                  { id: 'strict', label: '🧐 Strict' },
                ].map((v) => (
                  <button 
                    key={v.id}
                    onClick={() => setVibe(v.id)}
                    className={`p-4 rounded-2xl border-2 text-left transition ${vibe === v.id ? 'border-[#25D366] bg-[#25D366]/5' : 'border-gray-100 hover:border-gray-200'}`}
                  >
                    <p className={`font-black text-sm ${vibe === v.id ? 'text-[#25D366]' : 'text-gray-400'}`}>{v.label}</p>
                  </button>
                ))}
              </div>
              <div className="pt-4 border-t border-dashed">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 block">Monthly Salary (₦)</label>
                <div className="flex items-center gap-3">
                  <input type="number" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} placeholder="Min" className="w-full p-3 bg-gray-50 rounded-xl outline-none" />
                  <input type="number" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} placeholder="Max" className="w-full p-3 bg-gray-50 rounded-xl outline-none" />
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              <h3 className="font-black text-lg text-[#111b21]">Final Action</h3>
              <div className="p-5 bg-amber-50 rounded-2xl border border-amber-100">
                <label className="text-xs font-black text-amber-900 uppercase tracking-widest mb-2 block">Must-Ask Question</label>
                <input 
                  type="text" 
                  value={mustAsk} 
                  onChange={(e) => setMustAsk(e.target.value)}
                  placeholder="e.g. Do you have a bike?" 
                  className="w-full p-3 bg-white rounded-xl border border-amber-200 outline-none" 
                />
              </div>
              <select 
                value={actionType}
                onChange={(e) => setActionType(e.target.value)}
                className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none font-bold text-sm"
              >
                <option>Send WhatsApp DM</option>
                <option>Join Group Link</option>
                <option>Upload CV</option>
              </select>
              <input 
                type="text" 
                value={actionValue}
                onChange={(e) => setActionValue(e.target.value)}
                placeholder="Paste link or number here" 
                className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none" 
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-8 border-t flex justify-between bg-gray-50 rounded-b-3xl">
          <button 
            disabled={step === 1 || loading} 
            onClick={() => setStep(step - 1)}
            className="px-6 py-2 font-black text-xs uppercase tracking-widest text-gray-300 hover:text-gray-600 disabled:opacity-0 transition"
          >
            Back
          </button>
          
          <button 
            disabled={loading}
            onClick={() => step < 5 ? setStep(step + 1) : handlePublish()}
            className={`px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition transform active:scale-95 shadow-xl ${step === 5 ? 'bg-[#25D366] text-white' : 'bg-[#111b21] text-white'}`}
          >
            {loading ? "Publishing..." : step === 5 ? "Publish Job Bot" : "Next Step"}
          </button>
        </div>
      </div>
    </div>
  );
}