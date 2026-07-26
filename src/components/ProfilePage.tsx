import { useState, useEffect, useRef } from 'react';
import { Loader as Loader2, Save, CircleCheck as CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { empty, type Profile, type OrgPositionInfo, type SectionId } from './Profile/types';
import { SectionHeader } from './Profile/SectionHeader';
import { AvatarCard } from './Profile/AvatarCard';
import { PersonalInfoSection } from './Profile/PersonalInfoSection';
import { WorkInfoSection } from './Profile/WorkInfoSection';
import { BaleConnectSection } from './Profile/BaleConnectSection';
import { TelegramConnectSection } from './Profile/TelegramConnectSection';

export function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarProcessing, setAvatarProcessing] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [openSection, setOpenSection] = useState<SectionId>('personal');
  const [saved, setSaved] = useState(false);
  const [orgPositionInfo, setOrgPositionInfo] = useState<OrgPositionInfo | null>(null);
  const avatarPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { fetchProfile(); }, []);

  useEffect(() => {
    return () => { stopAvatarPoll(); };
  }, []);

  const fetchOrgInfo = async (positionId: string | null) => {
    const [{ data: posData }, { data: allPos }, { data: allUnits }, { data: orgData }] = await Promise.all([
      positionId
        ? supabase.from('org_positions').select('id,title,level,color,icon,unit_id,parent_position_id').eq('id', positionId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('org_positions').select('id,title,level,color,icon,unit_id').order('level'),
      supabase.from('org_units').select('id,name').order('name'),
      supabase.from('org_organizations').select('name').maybeSingle(),
    ]);
    if (posData) {
      const unit = (allUnits || []).find((u: any) => u.id === posData.unit_id);
      const parent = posData.parent_position_id
        ? (allPos || []).find((p: any) => p.id === posData.parent_position_id)
        : null;
      setOrgPositionInfo({
        id: posData.id, title: posData.title, level: posData.level,
        color: posData.color, icon: posData.icon,
        unit_name: unit?.name, parent_title: parent?.title,
      });
      if (orgData?.name) {
        setProfile(p => p ? { ...p, organization: orgData.name } : p);
      }
    } else {
      setOrgPositionInfo(null);
    }
  };

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('کاربر احراز هویت نشده است');

      const { data, error } = await supabase
        .from('profiles').select('*').eq('user_id', user.id).maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setProfile({ ...empty, ...data } as unknown as Profile);
        fetchOrgInfo(data.primary_position_id || null);
      } else {
        const newProfile = { ...empty, user_id: user.id, email: user.email ?? '' };
        const { data: created, error: ce } = await supabase
          .from('profiles').insert([newProfile]).select().single();
        if (ce) throw ce;
        setProfile(created as unknown as Profile);
      }
    } catch (error: any) {
      toast.error(error.message || 'خطا در دریافت پروفایل');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    try {
      const payload: Pick<Profile, 'full_name' | 'phone' | 'national_id' | 'birth_date' | 'gender' | 'city' | 'bio' | 'employee_id' | 'hire_date' | 'location'> & { updated_at: string } = {
        full_name: profile.full_name,
        phone: profile.phone,
        national_id: profile.national_id,
        birth_date: profile.birth_date ?? null,
        gender: profile.gender,
        city: profile.city,
        bio: profile.bio,
        employee_id: profile.employee_id,
        hire_date: profile.hire_date ?? null,
        location: profile.location,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('profiles').update(payload).eq('id', profile.id);
      if (error) throw error;
      toast.success('پروفایل با موفقیت ذخیره شد');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (error: any) {
      toast.error(error.message || 'خطا در ذخیره پروفایل');
    } finally {
      setSaving(false);
    }
  };

  const stopAvatarPoll = () => {
    if (avatarPollRef.current) { clearInterval(avatarPollRef.current); avatarPollRef.current = null; }
  };

  const startAvatarPoll = (jobId: string) => {
    stopAvatarPoll();
    const startTime = Date.now();
    const maxMs = 60_000;
    const intervalMs = 2_000;

    avatarPollRef.current = setInterval(async () => {
      if (Date.now() - startTime > maxMs) {
        stopAvatarPoll();
        setAvatarProcessing(false);
        toast.error('پردازش تصویر طولانی شد. لطفاً بعداً دوباره بررسی کنید.');
        return;
      }
      try {
        const { data, error } = await supabase
          .from('avatar_jobs')
          .select('status')
          .eq('id', jobId)
          .maybeSingle();
        if (error) throw error;
        if (!data) return;

        if (data.status === 'completed') {
          stopAvatarPoll();
          setAvatarProcessing(false);
          await fetchProfile();
          toast.success('تصویر پروفایل به‌روزرسانی شد');
        } else if (data.status === 'failed') {
          stopAvatarPoll();
          setAvatarProcessing(false);
          toast.error('پردازش تصویر ناموفق بود. لطفاً فایل دیگری امتحان کنید.');
        }
      } catch {
        // transient poll error — keep polling
      }
    }, intervalMs);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;

    stopAvatarPoll();

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('فقط فرمت‌های JPEG، PNG و WebP مجاز هستند');
      e.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('حجم فایل نباید بیشتر از ۲ مگابایت باشد');
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const { data, error } = await supabase.functions.invoke('avatar-upload', {
        body: formData,
      });

      if (error) throw error;
      if (!data?.job_id) throw new Error('پاسخ نامعتبر از سرور');

      setUploading(false);
      setAvatarProcessing(true);
      toast.success('تصویر ارسال شد. در حال پردازش...');
      startAvatarPoll(data.job_id);
    } catch (error: any) {
      setUploading(false);
      toast.error('خطا در آپلود تصویر. لطفاً دوباره تلاش کنید.');
    } finally {
      e.target.value = '';
    }
  };

  const set = (field: keyof typeof empty, value: string) =>
    setProfile(p => p ? { ...p, [field]: value } : p);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="w-10 h-10 animate-spin text-teal-500" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">پروفایل کاربری</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">اطلاعات حساب و سازمانی خود را مدیریت کنید</p>
      </div>

      <AvatarCard profile={profile} uploading={uploading} avatarProcessing={avatarProcessing} onAvatarUpload={handleAvatarUpload} />

      <form onSubmit={handleSave} className="space-y-4">
        {/* Personal info */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <SectionHeader id="personal" title="اطلاعات شخصی" subtitle="نام، مشخصات فردی، ارتباطی" openSection={openSection} onToggle={setOpenSection} />
          {openSection === 'personal' && <PersonalInfoSection profile={profile} set={set} />}
        </div>

        {/* Work/org section */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <SectionHeader id="work" title="اطلاعات سازمانی" subtitle="سازمان، سمت، واحد و مشخصات شغلی" openSection={openSection} onToggle={setOpenSection} />
          {openSection === 'work' && <WorkInfoSection profile={profile} orgPositionInfo={orgPositionInfo} set={set} />}
        </div>

        {/* Social / links */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <SectionHeader id="social" title="شبکه‌های اجتماعی و پیام‌رسان" subtitle="اتصال به پیام‌رسان‌های بله و تلگرام" openSection={openSection} onToggle={setOpenSection} />
          {openSection === 'social' && (
            <div className="p-6 space-y-5">
              <BaleConnectSection />
              <TelegramConnectSection />
            </div>
          )}
        </div>

        {/* Save */}
        <div className="flex justify-end pb-4">
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-8 py-2.5 rounded-xl font-medium transition disabled:opacity-60 shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" />
              : saved ? <CheckCircle2 className="w-4 h-4" />
              : <Save className="w-4 h-4" />}
            {saving ? 'در حال ذخیره...' : saved ? 'ذخیره شد' : 'ذخیره تغییرات'}
          </button>
        </div>
      </form>
    </div>
  );
}
