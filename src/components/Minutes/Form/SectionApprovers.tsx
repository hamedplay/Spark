import { Users, CircleCheck as CheckCircle2, CircleUser as UserCircle } from 'lucide-react';
import type { ApprovalMode } from '../types';
import type { DraftInternalParticipant, ProfileOption } from './types';

interface SectionApproversProps {
  approvalMode: ApprovalMode | '';
  internalParticipants: DraftInternalParticipant[];
  profiles: ProfileOption[];
  readOnly: boolean;
}

export function SectionApprovers({ approvalMode, internalParticipants, profiles, readOnly }: SectionApproversProps) {
  const profileLabel = (p: ProfileOption) => p.full_name || p.email || p.user_id;

  const eligibleApprovers = internalParticipants.filter(p => !!p.userId);

  return (
    <div className="space-y-5" dir="rtl">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        تأییدکنندگان
      </h2>

      {!approvalMode && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-xl p-4 text-sm text-amber-700 dark:text-amber-400">
          مدل تأیید هنوز انتخاب نشده است. در بخش «اطلاعات جلسه» مدل تأیید را انتخاب کنید.
        </div>
      )}

      {approvalMode === 'system' && (
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-400">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4" />
              <span className="font-medium">تأیید سیستمی</span>
            </div>
            <p className="leading-relaxed">
              صورت‌جلسه برای تمام شرکت‌کنندگان داخلی دارای حساب سامانه به‌صورت خودکار ارسال می‌شود. حضور در جلسه شرط افزودن به تأییدکنندگان نیست. پس از تأیید همه، تأیید دبیر و سپس رئیس جلسه برای انتشار لازم است.
            </p>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                تأییدکنندگان خودکار ({eligibleApprovers.length} نفر)
              </h3>
            </div>
            {eligibleApprovers.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                هیچ شرکت‌کننده داخلی با حساب کاربری وجود ندارد. ابتدا در بخش «شرکت‌کنندگان» افراد را اضافه کنید.
              </p>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                <ul className="divide-y divide-gray-50 dark:divide-gray-700">
                  {eligibleApprovers.map((p, idx) => {
                    const profile = profiles.find(x => x.user_id === p.userId);
                    const label = profile ? profileLabel(profile) : (p.nameSnapshot || p.userId);
                    const sublabelParts: string[] = [];
                    if (profile?.position) sublabelParts.push(profile.position);
                    if (p.orgUnitNameSnapshot) sublabelParts.push(p.orgUnitNameSnapshot);
                    return (
                      <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{label}</p>
                          {sublabelParts.length > 0 && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{sublabelParts.join(' — ')}</p>
                          )}
                        </div>
                        <span className="text-xs text-gray-400">تأیید سیستمی</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {approvalMode === 'in_person' && (
        <div className="space-y-4">
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/40 rounded-xl p-4 text-sm text-emerald-700 dark:text-emerald-400">
            <div className="flex items-center gap-2 mb-1">
              <UserCircle className="w-4 h-4" />
              <span className="font-medium">تأیید حضوری</span>
            </div>
            <p className="leading-relaxed">
              در تأیید حضوری، تأیید شرکت‌کنندگان سیستمی وجود ندارد و رکورد تأییدی ساخته نمی‌شود. دبیر تأیید می‌کند که صورت‌جلسه در جلسه حضوری تأیید شده، سپس رئیس جلسه آن را منتشر می‌کند.
            </p>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            لیست تأییدکنندگان در این روش نمایش داده نمی‌شود.
          </p>
        </div>
      )}

      {readOnly && approvalMode && (
        <p className="text-xs text-gray-400">
          مدل تأیید پس از اولین ارسال قابل تغییر نیست.
        </p>
      )}
    </div>
  );
}
