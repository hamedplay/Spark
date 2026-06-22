import React from 'react';
import { BarChart3, Users, CheckCircle, Clock, Bell } from 'lucide-react';

interface DashboardProps {
  totalMeetings: number;
  openMeetings: number;
  completedMeetings: number;
  pendingMeetingsCount?: number;
}

export function Dashboard({ totalMeetings, openMeetings, completedMeetings, pendingMeetingsCount = 0 }: DashboardProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">کل جلسات</p>
            <h3 className="text-2xl font-bold dark:text-white">{totalMeetings}</h3>
          </div>
          <BarChart3 className="text-blue-500 w-8 h-8" />
        </div>
      </div>
      
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">جلسات باز</p>
            <h3 className="text-2xl font-bold dark:text-white">{openMeetings}</h3>
          </div>
          <Clock className="text-yellow-500 w-8 h-8" />
        </div>
      </div>
      
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">جلسات تکمیل شده</p>
            <h3 className="text-2xl font-bold dark:text-white">{completedMeetings}</h3>
          </div>
          <CheckCircle className="text-green-500 w-8 h-8" />
        </div>
      </div>
      
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">جلسات در انتظار تایید</p>
            <h3 className="text-2xl font-bold dark:text-white">{pendingMeetingsCount}</h3>
          </div>
          <Bell className={`${pendingMeetingsCount > 0 ? 'text-red-500 animate-bounce' : 'text-gray-400 dark:text-gray-500'} w-8 h-8`} />
        </div>
      </div>
    </div>
  );
}