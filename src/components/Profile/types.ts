export interface OrgPositionInfo {
  id: string;
  title: string;
  level: number;
  color: string;
  icon: string;
  unit_name?: string;
  parent_title?: string;
}

export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  username: string;
  phone: string;
  organization: string;
  position: string;
  location: string;
  bio: string;
  avatar_url: string;
  national_id: string;
  birth_date: string;
  gender: string;
  city: string;
  department: string;
  employee_id: string;
  hire_date: string;
  bale_chat_id: string;
  primary_position_id: string | null;
  primary_unit_id: string | null;
  created_at: string;
  updated_at: string;
}

export const empty: Omit<Profile, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  full_name: '', email: '', username: '', phone: '', organization: '', position: '',
  location: '', bio: '', avatar_url: '', national_id: '', birth_date: '',
  gender: '', city: '', department: '', employee_id: '', hire_date: '',
  bale_chat_id: '',
  primary_position_id: null, primary_unit_id: null,
};

export const LEVEL_LABELS: Record<number, string> = {
  1: 'مدیرعامل', 2: 'معاون', 3: 'مدیر', 4: 'کارشناس', 5: 'کارمند',
};

export const inp = 'h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-9 text-xs text-slate-800 placeholder-slate-400 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500';
export const inpDisabled = inp + ' cursor-not-allowed border-slate-200 bg-slate-50 text-slate-500 opacity-90 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400';
