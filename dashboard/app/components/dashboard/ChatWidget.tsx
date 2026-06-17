import { Candidate } from '../../types';

export default function ChatWidget({ candidate, onClose }: { candidate: Candidate | null, onClose: () => void }) {
  if (!candidate) return null;

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[500px] bg-white rounded-3xl shadow-2xl border border-gray-200 flex flex-col z-50 animate-in slide-in-from-bottom-10">
      {/* Header */}
      <div className="p-4 bg-[#111b21] text-white rounded-t-3xl flex justify-between items-center">
        <div className="flex items-center gap-3">
           <div className="w-8 h-8 bg-[#25D366] rounded-full flex items-center justify-center font-bold">L</div>
           <div>
             <p className="text-xs font-bold leading-none">{candidate.name}</p>
             <p className="text-[9px] opacity-60">Status: {candidate.status}</p>
           </div>
        </div>
        <button onClick={onClose} className="text-xl opacity-50 hover:opacity-100">×</button>
      </div>

      {/* Messages */}
     // NEW
<div className="flex-1 bg-[#f0f2f5] p-4 overflow-y-auto space-y-3">
  {candidate.chatHistory.length === 0 ? (
    <p className="text-xs text-gray-400 text-center mt-10">No messages yet.</p>
  ) : candidate.chatHistory.map((m, i) => (
    <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
      <div className={`p-3 rounded-2xl shadow-sm max-w-[80%] text-xs font-medium ${m.role === 'user' ? 'bg-white rounded-tl-none' : 'bg-[#dcf8c6] rounded-tr-none'}`}>
        {m.content}
      </div>
    </div>
  ))}
</div>

      {/* Footer */}
      <div className="p-4 bg-white rounded-b-3xl border-t">
        <button className="w-full bg-[#111b21] text-white py-2 rounded-xl text-[10px] font-black uppercase tracking-widest">Open in WhatsApp</button>
      </div>
    </div>
  );
}