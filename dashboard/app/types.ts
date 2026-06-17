export interface Candidate {
  id: string;
  name: string;
  phone: string;
  status: 'screening' | 'qualified' | 'disqualified' | 'needs_attention';
  lastMessage: string;
  timestamp: string;
  chatHistory: { role: 'user' | 'assistant'; content: string }[];
}

export interface Job {
  id: string;
  title: string;
  location: string;
  candidatesCount: number;
  stats: {
    screening: number;
    qualified: number;
    disqualified: number;
    attention: number;
  };
}