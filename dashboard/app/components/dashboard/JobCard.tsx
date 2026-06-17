import { Job } from '../../types';

export default function JobCard({ job, onClick }: { job: Job, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100 hover:border-[#25D366] transition-all cursor-pointer group relative overflow-hidden"
    >
      <div className="absolute top-4 right-4 text-[#25D366] opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0 font-bold text-[10px] uppercase italic">View Candidates →</div>
      
      <h3 className="font-black text-2xl text-[#111b21] group-hover:text-[#25D366] transition-colors leading-tight">{job.title}</h3>
      <p className="text-gray-400 font-bold text-sm mt-1">{job.location}</p>

      <div className="mt-8 grid grid-cols-2 gap-3">
         <div className="bg-green-50 p-4 rounded-2xl border border-green-100 text-center">
            <p className="text-[10px] font-black text-green-600 uppercase tracking-tighter">Qualified</p>
            <p className="text-xl font-black text-green-700">{job.stats.qualified}</p>
         </div>
         <div className="bg-orange-50 p-4 rounded-2xl border border-orange-100 text-center">
            <p className="text-[10px] font-black text-orange-600 uppercase tracking-tighter">Attention</p>
            <p className="text-xl font-black text-orange-700">{job.stats.attention}</p>
         </div>
      </div>
    </div>
  );
}