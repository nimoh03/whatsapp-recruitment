// NEW
"use client";
import { useEffect, useState } from 'react';
import { Candidate, Job } from '../../types';
import { supabase } from '../../lib/supabase';

export default function CandidateTable({ job, onBack, onSelectCandidate }: { job: Job, onBack: () => void, onSelectCandidate: (c: Candidate) => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchCandidates = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('candidates')
        .select('*')
        .eq('job_id', job.id)
        .order('updated_at', { ascending: false });

      if (!isMounted) return;
      if (error) {
        console.error('Fetch candidates error:', error.message);
      } else {
        setCandidates(data.map(row => ({
          id: row.id,
          name: row.name || row.phone,
          phone: row.phone,
          status: row.status,
          lastMessage: row.last_message || '',
          timestamp: new Date(row.updated_at).toLocaleString(),
          chatHistory: row.chat_history || [],
        })));
      }
      setLoading(false);
    };
    fetchCandidates();
    return () => { isMounted = false; };
  }, [job.id]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
      <header className="h-24 flex items-center px-10 gap-6">
        <button onClick={onBack} className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center text-xl hover:bg-gray-100 transition active:scale-90 border">←</button>
        <div>
          <h1 className="text-2xl font-black text-[#111b21]">{job.title}</h1>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{candidates.length} Total Candidates</p>
        </div>
      </header>
      <div className="px-10 pb-10">
        <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50/50 border-b">
              <tr>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Candidate</th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Last Message</th>
                <th className="px-8 py-5 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={4} className="px-8 py-10 text-center text-gray-400">Loading candidates…</td></tr>
              ) : candidates.length === 0 ? (
                <tr><td colSpan={4} className="px-8 py-10 text-center text-gray-400">No candidates yet for this job.</td></tr>
              ) : candidates.map(c => (
                <tr key={c.id} onClick={() => onSelectCandidate(c)} className="hover:bg-gray-50 cursor-pointer group">
                  <td className="px-8 py-6">
                    <p className="font-bold text-[#111b21]">{c.name}</p>
                    <p className="text-xs text-gray-400">{c.phone}</p>
                  </td>
                  <td className="px-8 py-6 uppercase">
                    <span className={`px-3 py-1 rounded-full text-[9px] font-black ${c.status === 'qualified' ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}`}>{c.status}</span>
                  </td>
                  <td className="px-8 py-6">
                    <p className="text-xs text-gray-500 italic">"{c.lastMessage}"</p>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <button className="text-[10px] font-black text-[#25D366] opacity-0 group-hover:opacity-100 uppercase tracking-widest">View Chat</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}