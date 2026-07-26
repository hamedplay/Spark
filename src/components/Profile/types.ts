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

export const JALAALI_MONTHS_FA = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

export const inp = 'w-full pr-9 pl-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition text-sm';
export const inpDisabled = inp + ' bg-gray-50 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed';

export type SectionId = 'personal' | 'work' | 'social' | 'calendar';
