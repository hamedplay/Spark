import { Search, Plus, Bell } from 'lucide-react';
import { Dashboard } from '../../../components/Dashboard';
import { MeetingCard } from '../../../components/MeetingCard';
import { PendingMeetingsModal } from '../../../components/MeetingCard/PendingMeetingsModal';
import { checkPermission } from '../../permissions';
import type { MeetingsPageProps } from '../types/meetingsPage';

export function MeetingsPage(props: MeetingsPageProps) {
  const {
    meetings, pendingMeetingsCount, fetchMeetings, fetchPendingMeetingsCount,
    searchTerm, setSearchTerm, statusFilter, setStatusFilter,
    priorityFilter, setPriorityFilter,
    showPendingMeetingsModal, setShowPendingMeetingsModal,
    setActivePage, setPendingSchedule,
    isAdmin, userPermissions,
  } = props;

  const filteredMeetings = meetings.filter(meeting => {
    const matchesSearch = meeting.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         meeting.representative.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || meeting.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || meeting.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const stats = {
    totalMeetings: meetings.length,
    openMeetings: meetings.filter(m => m.status === 'open').length,
    completedMeetings: meetings.filter(m => m.status === 'archived').length,
    pendingMeetingsCount: pendingMeetingsCount
  };

  const hasPermission = (key: string): boolean => checkPermission(key, isAdmin, userPermissions);

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold dark:text-white">درخواست جلسات</h2>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={() => setShowPendingMeetingsModal(true)}
            className="flex items-center gap-2 bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition-colors w-full sm:w-auto justify-center relative"
          >
            <Bell className="w-5 h-5" />
            جلسات در انتظار تایید
            {pendingMeetingsCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs w-5 h-5 flex items-center justify-center rounded-full">
                {pendingMeetingsCount}
              </span>
            )}
          </button>
          {hasPermission('meetings_create') && (
            <button
              onClick={() => setActivePage('create-meeting')}
              className="flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors w-full sm:w-auto justify-center"
            >
              <Plus className="w-5 h-5" />
              جلسه جدید
            </button>
          )}
        </div>
      </div>

      <Dashboard {...stats} />

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="جستجو..."
            className="w-full pl-4 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as 'all' | 'high' | 'medium' | 'low')}
          className="w-full sm:w-auto px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
        >
          <option value="all">همه اولویت‌ها</option>
          <option value="high">اولویت بالا</option>
          <option value="medium">اولویت متوسط</option>
          <option value="low">اولویت پایین</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'open' | 'archived')}
          className="w-full sm:w-auto px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
        >
          <option value="all">همه جلسات</option>
          <option value="open">جلسات باز</option>
          <option value="archived">جلسات بایگانی شده</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredMeetings.map(meeting => (
          <MeetingCard
            key={meeting.id}
            meeting={meeting}
            onUpdate={fetchMeetings}
            onScheduleInCalendar={(m) => {
              setPendingSchedule({ meetingId: m.id, meeting: m });
              setActivePage('calendar');
            }}
          />
        ))}
      </div>

      {showPendingMeetingsModal && (
        <PendingMeetingsModal
          onClose={() => setShowPendingMeetingsModal(false)}
          onUpdate={() => {
            void fetchMeetings();
            void fetchPendingMeetingsCount();
          }}
        />
      )}
    </>
  );
}
