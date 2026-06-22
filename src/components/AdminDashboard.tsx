import React, { useState, useEffect } from 'react';
import { Users, Settings, BarChart3, Shield, UserCheck, UserX, Calendar, FileText, Database, Activity } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

interface UserProfile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  organization: string;
  position: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
}

interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  totalMeetings: number;
  totalTasks: number;
  totalNotes: number;
}

export function AdminDashboard() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [stats, setStats] = useState<AdminStats>({
    totalUsers: 0,
    activeUsers: 0,
    totalMeetings: 0,
    totalTasks: 0,
    totalNotes: 0
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'stats' | 'settings'>('users');

  useEffect(() => {
    fetchUsers();
    fetchStats();
  }, []);

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('خطا در دریافت لیست کاربران');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      // Get user stats
      const { count: totalUsers } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      const { count: activeUsers } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      // Get meeting stats
      const { count: totalMeetings } = await supabase
        .from('meetings')
        .select('*', { count: 'exact', head: true });

      // Get task stats
      const { count: totalTasks } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true });

      // Get notes stats
      const { count: totalNotes } = await supabase
        .from('notes')
        .select('*', { count: 'exact', head: true });

      setStats({
        totalUsers: totalUsers || 0,
        activeUsers: activeUsers || 0,
        totalMeetings: totalMeetings || 0,
        totalTasks: totalTasks || 0,
        totalNotes: totalNotes || 0
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: !currentStatus })
        .eq('user_id', userId);

      if (error) throw error;

      toast.success(currentStatus ? 'کاربر غیرفعال شد' : 'کاربر فعال شد');
      fetchUsers();
      fetchStats();
    } catch (error) {
      console.error('Error updating user status:', error);
      toast.error('خطا در به‌روزرسانی وضعیت کاربر');
    }
  };

  const toggleAdminStatus = async (userId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_admin: !currentStatus })
        .eq('user_id', userId);

      if (error) throw error;

      toast.success(currentStatus ? 'دسترسی ادمین حذف شد' : 'دسترسی ادمین اعطا شد');
      fetchUsers();
    } catch (error) {
      console.error('Error updating admin status:', error);
      toast.error('خطا در به‌روزرسانی دسترسی ادمین');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-blue-500" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">پنل مدیریت</h1>
          </div>
          <button
            onClick={() => window.history.back()}
            className="flex items-center gap-2 bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors"
          >
            بازگشت
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">کل کاربران</p>
                <h3 className="text-2xl font-bold dark:text-white">{stats.totalUsers}</h3>
              </div>
              <Users className="text-blue-500 w-8 h-8" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">کاربران فعال</p>
                <h3 className="text-2xl font-bold dark:text-white">{stats.activeUsers}</h3>
              </div>
              <Activity className="text-green-500 w-8 h-8" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">کل جلسات</p>
                <h3 className="text-2xl font-bold dark:text-white">{stats.totalMeetings}</h3>
              </div>
              <Calendar className="text-purple-500 w-8 h-8" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">کل اقدامات</p>
                <h3 className="text-2xl font-bold dark:text-white">{stats.totalTasks}</h3>
              </div>
              <BarChart3 className="text-orange-500 w-8 h-8" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">کل یادداشت‌ها</p>
                <h3 className="text-2xl font-bold dark:text-white">{stats.totalNotes}</h3>
              </div>
              <FileText className="text-yellow-500 w-8 h-8" />
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md mb-6">
          <div className="border-b border-gray-200 dark:border-gray-700">
            <nav className="flex space-x-8 px-6">
              <button
                onClick={() => setActiveTab('users')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'users'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  مدیریت کاربران
                </div>
              </button>
              <button
                onClick={() => setActiveTab('stats')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'stats'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" />
                  آمار سیستم
                </div>
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'settings'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5" />
                  تنظیمات
                </div>
              </button>
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'users' && (
              <div>
                <h3 className="text-lg font-semibold mb-4 dark:text-white">مدیریت کاربران</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          کاربر
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          سازمان
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          وضعیت
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          دسترسی ادمین
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          عملیات
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {users.map((user) => (
                        <tr key={user.id}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div>
                              <div className="text-sm font-medium text-gray-900 dark:text-white">
                                {user.full_name || 'بدون نام'}
                              </div>
                              <div className="text-sm text-gray-500 dark:text-gray-400">
                                {user.email}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {user.organization || 'بدون سازمان'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              user.is_active
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                            }`}>
                              {user.is_active ? 'فعال' : 'غیرفعال'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              user.is_admin
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                            }`}>
                              {user.is_admin ? 'ادمین' : 'کاربر عادی'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <div className="flex gap-2">
                              <button
                                onClick={() => toggleUserStatus(user.user_id, user.is_active)}
                                className={`inline-flex items-center px-3 py-1 rounded-md text-sm ${
                                  user.is_active
                                    ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-200'
                                    : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-200'
                                }`}
                              >
                                {user.is_active ? <UserX className="w-4 h-4 mr-1" /> : <UserCheck className="w-4 h-4 mr-1" />}
                                {user.is_active ? 'غیرفعال' : 'فعال'}
                              </button>
                              <button
                                onClick={() => toggleAdminStatus(user.user_id, user.is_admin)}
                                className={`inline-flex items-center px-3 py-1 rounded-md text-sm ${
                                  user.is_admin
                                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200'
                                    : 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-200'
                                }`}
                              >
                                <Shield className="w-4 h-4 mr-1" />
                                {user.is_admin ? 'حذف ادمین' : 'ادمین کردن'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'stats' && (
              <div>
                <h3 className="text-lg font-semibold mb-4 dark:text-white">آمار کلی سیستم</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                    <h4 className="font-medium text-gray-900 dark:text-white mb-2">آمار کاربران</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-300">کل کاربران:</span>
                        <span className="font-semibold dark:text-white">{stats.totalUsers}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-300">کاربران فعال:</span>
                        <span className="font-semibold text-green-600 dark:text-green-400">{stats.activeUsers}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-300">کاربران غیرفعال:</span>
                        <span className="font-semibold text-red-600 dark:text-red-400">{stats.totalUsers - stats.activeUsers}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                    <h4 className="font-medium text-gray-900 dark:text-white mb-2">آمار محتوا</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-300">جلسات:</span>
                        <span className="font-semibold dark:text-white">{stats.totalMeetings}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-300">اقدامات:</span>
                        <span className="font-semibold dark:text-white">{stats.totalTasks}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-300">یادداشت‌ها:</span>
                        <span className="font-semibold dark:text-white">{stats.totalNotes}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'settings' && (
              <div>
                <h3 className="text-lg font-semibold mb-4 dark:text-white">تنظیمات سیستم</h3>
                <div className="space-y-4">
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                    <h4 className="font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                      <Database className="w-5 h-5 inline mr-2" />
                      مدیریت دیتابیس
                    </h4>
                    <p className="text-yellow-700 dark:text-yellow-300 text-sm">
                      برای مدیریت دیتابیس، لطفاً به پنل Supabase مراجعه کنید.
                    </p>
                  </div>

                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">
                      <Settings className="w-5 h-5 inline mr-2" />
                      تنظیمات عمومی
                    </h4>
                    <p className="text-blue-700 dark:text-blue-300 text-sm">
                      تنظیمات سیستم از طریق متغیرهای محیطی قابل تغییر است.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}