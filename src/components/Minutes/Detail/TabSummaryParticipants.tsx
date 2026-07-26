import type { MinuteDetail, InternalParticipantRow, ExternalParticipantRow } from './types';
import { EmptyState } from '../MinutesShared';
import { InvitationBadge, AttendanceBadge } from './Badges';

export function TabSummary({ minute }: { minute: MinuteDetail }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[
        { label: 'عنوان جلسه', value: minute.meeting_title_snapshot },
        { label: 'تاریخ جلسه', value: minute.meeting_date_snapshot },
        { label: 'دبیر جلسه', value: minute.secretary_name_snapshot },
        { label: 'رئیس جلسه', value: minute.chair_name_snapshot },
        { label: 'واحد سازمانی', value: minute.org_unit_name_snapshot || '—' },
        { label: 'موقعیت', value: minute.meeting_location_snapshot || '—' },
        { label: 'نوع جلسه', value: minute.meeting_type || '—' },
        { label: 'ساعت شروع', value: minute.meeting_start_time_snapshot || '—' },
        { label: 'ساعت پایان', value: minute.meeting_end_time_snapshot || '—' },
      ].map(item => (
        <div key={item.label} className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{item.label}</p>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.value}</p>
        </div>
      ))}
      {minute.notes && (
        <div className="col-span-1 sm:col-span-2 lg:col-span-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">یادداشت</p>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{minute.notes}</p>
        </div>
      )}
    </div>
  );
}

export function TabParticipants({ internal, external }: { internal: InternalParticipantRow[]; external: ExternalParticipantRow[] }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">شرکت‌کنندگان داخلی</h3>
        {internal.length === 0 ? (
          <EmptyState title="هنوز ثبت نشده" description="شرکت‌کننده داخلی ثبت نشده است." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                  {['نام','سمت','واحد','وضعیت دعوت','وضعیت حضور'].map(h => (
                    <th key={h} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {internal.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-gray-200">{p.name_snapshot}</td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.position_snapshot || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.org_unit_name_snapshot || '—'}</td>
                    <td className="px-3 py-2.5">
                      <InvitationBadge status={p.invitation_status} />
                    </td>
                    <td className="px-3 py-2.5">
                      {p.attendance_status ? <AttendanceBadge status={p.attendance_status} /> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">شرکت‌کنندگان خارجی</h3>
        {external.length === 0 ? (
          <EmptyState title="هنوز ثبت نشده" description="شرکت‌کننده خارجی ثبت نشده است." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                  {['نام','سازمان','سمت','موبایل','وضعیت حضور'].map(h => (
                    <th key={h} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {external.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-gray-200">{p.full_name}</td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.organization || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.position || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.mobile || '—'}</td>
                    <td className="px-3 py-2.5">{p.attendance_status ? <AttendanceBadge status={p.attendance_status} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
