"use client";
export default function Sidebar({ activeTab, setActiveTab }: { activeTab: string, setActiveTab: (t: 'jobs' | 'settings') => void }) {
  return (
    <nav className="w-20 bg-[#111b21] flex flex-col items-center py-8 gap-10 text-white shrink-0 h-screen sticky top-0">
      <div className="w-12 h-12 bg-[#25D366] rounded-2xl flex items-center justify-center font-black text-xl shadow-lg shadow-[#25D366]/20">R</div>
      
      <button 
        onClick={() => setActiveTab('jobs')}
        className={`p-3 rounded-xl transition-all ${activeTab === 'jobs' ? 'bg-[#25D366] shadow-lg' : 'opacity-40 hover:opacity-100 hover:bg-white/10'}`}
      >
        📁
      </button>
      
      <button 
        onClick={() => setActiveTab('settings')}
        className={`p-3 rounded-xl transition-all ${activeTab === 'settings' ? 'bg-[#25D366] shadow-lg' : 'opacity-40 hover:opacity-100 hover:bg-white/10'}`}
      >
        ⚙️
      </button>
    </nav>
  );
}