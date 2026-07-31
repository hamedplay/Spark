import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  SquareCheck as CheckSquare,
  ChartBar as FileBarChart2,
  StickyNote,
  Phone,
  Menu,
  ChevronRight,
  Calendar,
  MessageCircle,
  Video,
  Bot,
  MessagesSquare,
  FileText,
  ClipboardList,
  SquareCheck as DecisionIcon,
  TrendingUp,
  ChartBar as BarChart2,
  ChevronDown,
} from 'lucide-react';

import type {
  LayoutUserPermissions,
  PageId,
} from '../types';
import {
  getVisiblePrimaryNavigationItems,
  getVisibleMinutesNavigationItems,
  isMinutesPage,
  resolveActiveMinutesPage,
} from '../navigationMenu';

const ICON_MAP: Record<PageId, typeof LayoutDashboard> = {
  'meetings': LayoutDashboard,
  'calendar': Calendar,
  'chat': MessageCircle,
  'channels': MessagesSquare,
  'video-conference': Video,
  'tasks': CheckSquare,
  'notes': StickyNote,
  'contacts': Phone,
  'reports': FileBarChart2,
  'spark': Bot,
  'minutes-dashboard': LayoutDashboard,
  'minutes': FileText,
  'minutes-approvals': ClipboardList,
  'minutes-my-decisions': DecisionIcon,
  'minutes-followup': TrendingUp,
  'minutes-reports': BarChart2,
};

export interface LayoutSidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  isAdmin: boolean;
  sparkVisible: boolean;
  userPermissions: LayoutUserPermissions;
  isCollapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  isMobileMenuOpen: boolean;
  onMobileMenuOpenChange: (open: boolean) => void;
  accentColor: string;
}

export function LayoutSidebar({
  activePage,
  onNavigate,
  isAdmin,
  sparkVisible,
  userPermissions,
  isCollapsed,
  onCollapsedChange,
  isMobileMenuOpen,
  onMobileMenuOpenChange,
  accentColor,
}: LayoutSidebarProps) {
  const [isMinutesMenuOpen, setIsMinutesMenuOpen] =
    useState(() => isMinutesPage(activePage));

  useEffect(() => {
    if (isMinutesPage(activePage))
      setIsMinutesMenuOpen(true);
  }, [activePage]);

  const menuItems = getVisiblePrimaryNavigationItems({
    isAdmin,
    sparkVisible: !!sparkVisible,
    userPermissions,
  }).map((item) => ({
    ...item,
    icon: ICON_MAP[item.id],
  }));

  const visibleMinutesSubItems =
    getVisibleMinutesNavigationItems({
      isAdmin,
      sparkVisible: !!sparkVisible,
      userPermissions,
    }).map((item) => ({
      ...item,
      icon: ICON_MAP[item.id],
    }));

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() =>
          onMobileMenuOpenChange(!isMobileMenuOpen)
        }
        className="lg:hidden fixed z-50 p-1.5 bg-white dark:bg-gray-800 rounded-xl shadow-lg"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          right: 'max(0.75rem, env(safe-area-inset-right))',
        }}
      >
        <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
      </button>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => onMobileMenuOpenChange(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`${isCollapsed ? 'w-16' : 'w-52'} bg-white dark:bg-gray-800 shadow-lg transition-all duration-300 fixed lg:relative z-50 h-full flex flex-col ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        {/* Sidebar header: collapse toggle */}
        <div className="flex items-center justify-center px-3 h-14 border-b border-gray-100 dark:border-gray-700 flex-shrink-0 relative">
          <button
            onClick={() => {
              const next = !isCollapsed;
              onCollapsedChange(next);
              localStorage.setItem(
                'sidebar_collapsed',
                String(next)
              );
            }}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors hidden lg:flex flex-shrink-0"
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            ) : (
              <Menu className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            )}
          </button>
        </div>

        {/* Nav items */}
        <nav
          className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5"
          style={{
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              activePage === item.id ||
              (activePage === 'create-meeting' &&
                item.id === 'meetings');
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-2.5 py-2.5 rounded-xl transition-all text-sm font-medium ${
                  isCollapsed ? 'justify-center px-2' : 'px-2.5'
                } ${
                  isActive
                    ? 'shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/60 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
                style={
                  isActive
                    ? {
                        backgroundColor: accentColor + '18',
                        color: accentColor,
                      }
                    : {}
                }
                title={isCollapsed ? item.title : undefined}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {!isCollapsed && (
                  <span className="truncate">{item.title}</span>
                )}
              </button>
            );
          })}

          {/* ── صورت‌جلسات و مصوبات accordion ── */}
          {visibleMinutesSubItems.length > 0 && (
            <div>
              {/* Divider */}
              <div
                className={`${isCollapsed ? 'hidden' : 'flex'} items-center gap-1.5 px-2 pt-3 pb-1`}
              >
                <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700" />
                <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 whitespace-nowrap">
                  صورت‌جلسات
                </span>
                <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700" />
              </div>
              {isCollapsed && (
                <div className="h-px bg-gray-100 dark:bg-gray-700 mx-2 my-2" />
              )}

              {/* Parent button */}
              <button
                onClick={() => {
                  if (isCollapsed) {
                    onNavigate('minutes-dashboard');
                  } else {
                    setIsMinutesMenuOpen((v) => !v);
                  }
                }}
                className={`w-full flex items-center gap-2.5 py-2.5 rounded-xl transition-all text-sm font-medium ${
                  isCollapsed ? 'justify-center px-2' : 'px-2.5'
                } ${
                  isMinutesPage(activePage)
                    ? 'shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/60 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
                style={
                  isMinutesPage(activePage)
                    ? {
                        backgroundColor: accentColor + '18',
                        color: accentColor,
                      }
                    : {}
                }
                title={
                  isCollapsed
                    ? 'صورت‌جلسات و مصوبات'
                    : undefined
                }
              >
                <FileText className="w-5 h-5 flex-shrink-0" />
                {!isCollapsed && (
                  <>
                    <span className="truncate flex-1 text-right">
                      صورت‌جلسات و مصوبات
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${
                        isMinutesMenuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </>
                )}
              </button>

              {/* Submenu — animated expand/collapse */}
              {!isCollapsed && (
                <div
                  className="overflow-hidden transition-all duration-200"
                  style={{
                    maxHeight: isMinutesMenuOpen
                      ? `${visibleMinutesSubItems.length * 44}px`
                      : '0px',
                  }}
                >
                  <div className="pt-0.5 space-y-0.5">
                    {visibleMinutesSubItems.map((sub) => {
                      const SubIcon = sub.icon;
                      const mappedActive =
                        resolveActiveMinutesPage(activePage);
                      const isSubActive = mappedActive === sub.id;
                      return (
                        <button
                          key={sub.id}
                          onClick={() => onNavigate(sub.id)}
                          className={`w-full flex items-center gap-2.5 py-2 pr-7 pl-2.5 rounded-xl transition-all text-sm font-medium ${
                            isSubActive
                              ? 'shadow-sm'
                              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/60 hover:text-gray-800 dark:hover:text-gray-200'
                          }`}
                          style={
                            isSubActive
                              ? {
                                  backgroundColor: accentColor + '18',
                                  color: accentColor,
                                }
                              : {}
                          }
                        >
                          <SubIcon className="w-4 h-4 flex-shrink-0" />
                          <span className="truncate">
                            {sub.title}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </nav>
      </div>
    </>
  );
}
