import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, CreditCard as Edit2, Users, ChevronDown, ChevronRight, X, Check, Building2, Crown, Briefcase, UserCheck, Search, Link2, Settings, RefreshCw as RefreshIcon, Wifi, WifiOff, Shield, Key, Database, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle2, ChevronUp, User } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

// ─── Types ───────────────────────────────────────────────────────────────────
interface OrgUnit {
  id: string;
  name: string;
  code: string | null;
  parent_id: string | null;
  manager_user_id: string | null;
  sort_order: number;
  created_at: string;
}

interface OrgPosition {
  id: string;
  unit_id: string | null;
  title: string;
  level: number;
  parent_position_id: string | null;
  sort_order: number;
  color: string;
  icon: string;
  created_at: string;
}

interface PositionMember {
  id: string;
  position_id: string;
  user_id: string;
  is_primary: boolean;
  assigned_at: string;
  profile?: { full_name: string | null; email: string | null; avatar_url: string | null; position: string | null; department: string | null };
}

interface Profile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  position: string | null;
  department: string | null;
  primary_position_id: string | null;
  primary_unit_id: string | null;
}

interface LevelDef {
  id?: string;
  level: number;
  label: string;
  color: string;
  icon: string;
  sort_order: number;
}

interface HrSsoConfig {
  id: string;
  config_type: 'hr' | 'sso';
  provider_name: string;
  base_url: string;
  api_key: string;
  client_id: string;
  client_secret: string;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  field_mappings: Record<string, string>;
  is_active: boolean;
}

interface OrgOrganization {
  id: string;
  name: string;
  short_name: string;
  description: string;
  logo_url: string;
  website: string;
}

// ─── Spinner ─────────────────────────────────────────────────────────────────
function Spinner({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

// ─── Level helpers ────────────────────────────────────────────────────────────
const DEFAULT_LEVELS: LevelDef[] = [
  { level: 1, label: 'مدیرعامل', color: '#ef4444', icon: '👑', sort_order: 1 },
  { level: 2, label: 'معاون', color: '#f97316', icon: '⭐', sort_order: 2 },
  { level: 3, label: 'مدیر', color: '#3b82f6', icon: '💼', sort_order: 3 },
  { level: 4, label: 'رئیس اداره', color: '#8b5cf6', icon: '🏛️', sort_order: 4 },
  { level: 5, label: 'معاون اداره', color: '#06b6d4', icon: '📋', sort_order: 5 },
  { level: 6, label: 'کارشناس ارشد', color: '#10b981', icon: '🔧', sort_order: 6 },
  { level: 7, label: 'کارشناس', color: '#14b8a6', icon: '📊', sort_order: 7 },
  { level: 8, label: 'کارمند', color: '#6b7280', icon: '👤', sort_order: 8 },
];

function getLevelInfo(level: number, levels: LevelDef[]): LevelDef {
  return levels.find(l => l.level === level) || DEFAULT_LEVELS.find(l => l.level === level) || DEFAULT_LEVELS[DEFAULT_LEVELS.length - 1];
}

// ─── Org Chart Node ───────────────────────────────────────────────────────────
function OrgChartNode({
  position, allMembers, allPositions, units, levelDefs, depth,
  onEdit, onDelete, onAddChild, onAssign,
}: {
  position: OrgPosition;
  allMembers: PositionMember[];
  allPositions: OrgPosition[];
  units: OrgUnit[];
  levelDefs: LevelDef[];
  depth: number;
  onEdit: (p: OrgPosition) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onAssign: (positionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const children = allPositions.filter(p => p.parent_position_id === position.id);
  const posMembers = allMembers.filter(m => m.position_id === position.id);
  const lvl = getLevelInfo(position.level, levelDefs);
  const unit = units.find(u => u.id === position.unit_id) || null;
  const color = position.color || lvl.color;
  const icon = position.icon || lvl.icon;

  return (
    <div className="flex flex-col items-center select-none" style={{ minWidth: 0 }}>
      <div className="relative group flex flex-col items-center">
        <div
          className="relative bg-white dark:bg-gray-800 rounded-2xl border-2 shadow-md transition-all hover:shadow-xl"
          style={{ borderColor: color, minWidth: '170px', maxWidth: '220px' }}
        >
          {/* Level badge */}
          <div
            className="absolute -top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-bold text-white whitespace-nowrap"
            style={{ backgroundColor: color }}
          >
            {icon} {lvl.label}
          </div>

          <div className="px-4 pt-5 pb-3">
            <div className="text-center font-bold text-sm text-gray-800 dark:text-white mb-1.5 leading-tight">
              {position.title}
            </div>
            {unit && (
              <div className="text-center text-[10px] text-gray-400 dark:text-gray-500 mb-2 flex items-center justify-center gap-1">
                <Building2 className="w-3 h-3" />{unit.name}
              </div>
            )}

            {/* Members list - no assign button if members exist */}
            <div className="space-y-1.5 min-h-[28px]">
              {posMembers.length === 0 ? (
                <button
                  onClick={() => onAssign(position.id)}
                  className="w-full flex items-center justify-center gap-1 py-1.5 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 text-[11px] text-gray-400 hover:text-blue-500 hover:border-blue-400 transition-colors"
                >
                  <Plus className="w-3 h-3" /> تخصیص کاربر
                </button>
              ) : (
                posMembers.map(m => (
                  <div
                    key={m.id}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1 cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ backgroundColor: color + '18' }}
                    onClick={() => onAssign(position.id)}
                    title="مدیریت تخصیص"
                  >
                    {m.profile?.avatar_url ? (
                      <img src={m.profile.avatar_url} className="w-5 h-5 rounded-full object-cover shrink-0" alt="" />
                    ) : (
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                        style={{ backgroundColor: color }}
                      >
                        {(m.profile?.full_name || 'U').charAt(0)}
                      </div>
                    )}
                    <span className="text-[11px] text-gray-700 dark:text-gray-200 truncate flex-1 font-medium">
                      {m.profile?.full_name || m.profile?.email || 'کاربر'}
                    </span>
                    {m.is_primary && (
                      <span className="text-[9px] text-amber-500 font-bold shrink-0">★</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Hover actions */}
          <div className="absolute -top-2 -left-2 hidden group-hover:flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg px-1.5 py-1 z-10">
            <button onClick={() => onEdit(position)} className="p-1 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors" title="ویرایش">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onAddChild(position.id)} className="p-1 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg transition-colors" title="افزودن زیرمجموعه">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onDelete(position.id)} className="p-1 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors" title="حذف">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {children.length > 0 && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="mt-1 w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 hover:bg-gray-300 transition-colors z-10"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        )}
      </div>

      {expanded && children.length > 0 && (
        <div className="flex flex-col items-center mt-0">
          <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />
          {children.length > 1 && (
            <div className="relative w-full flex justify-center">
              <div className="h-px bg-gray-300 dark:bg-gray-600 absolute top-0"
                style={{ left: `calc(50% / ${children.length})`, right: `calc(50% / ${children.length})` }}
              />
            </div>
          )}
          <div className="flex items-start gap-8 mt-0">
            {children.map(child => (
              <div key={child.id} className="flex flex-col items-center">
                <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />
                <OrgChartNode
                  position={child}
                  allMembers={allMembers}
                  allPositions={allPositions}
                  units={units}
                  levelDefs={levelDefs}
                  depth={depth + 1}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onAddChild={onAddChild}
                  onAssign={onAssign}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Position Form Modal ──────────────────────────────────────────────────────
function PositionFormModal({
  initial, units, allPositions, levelDefs, onSave, onClose,
}: {
  initial: Partial<OrgPosition> | null;
  units: OrgUnit[];
  allPositions: OrgPosition[];
  levelDefs: LevelDef[];
  onSave: (data: Partial<OrgPosition>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<OrgPosition>>(
    initial || { title: '', level: 3, color: '#3b82f6', icon: '', sort_order: 0 }
  );
  const [saving, setSaving] = useState(false);

  const handleLevelChange = (level: number) => {
    const l = getLevelInfo(level, levelDefs);
    setForm(f => ({ ...f, level, color: l.color, icon: l.icon }));
  };

  const handleSubmit = async () => {
    if (!form.title?.trim()) { toast.error('عنوان سمت را وارد کنید'); return; }
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const sorted = [...levelDefs].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-blue-500" />
            {initial?.id ? 'ویرایش سمت' : 'افزودن سمت جدید'}
          </h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">عنوان سمت *</label>
            <input
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm"
              value={form.title || ''}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="مثال: مدیرعامل، معاون مالی، رئیس اداره منابع انسانی"
            />
          </div>

          {/* Level selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">سطح سازمانی</label>
            <div className="grid grid-cols-4 gap-2">
              {sorted.map(l => (
                <button
                  key={l.level}
                  onClick={() => handleLevelChange(l.level)}
                  className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all text-center ${form.level === l.level ? 'border-current shadow-md' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}
                  style={form.level === l.level ? { borderColor: l.color, backgroundColor: l.color + '15' } : {}}
                >
                  <span className="text-base">{l.icon}</span>
                  <span className="text-[9px] font-medium leading-tight" style={form.level === l.level ? { color: l.color } : { color: '#6b7280' }}>{l.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">بالادستی (مستقیم)</label>
            <select
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm"
              value={form.parent_position_id || ''}
              onChange={e => setForm(f => ({ ...f, parent_position_id: e.target.value || null }))}
            >
              <option value="">— ندارد (رده اول) —</option>
              {allPositions
                .filter(p => p.id !== form.id)
                .sort((a, b) => a.level - b.level)
                .map(p => {
                  const li = getLevelInfo(p.level, levelDefs);
                  return <option key={p.id} value={p.id}>{li.icon} {p.title} ({li.label})</option>;
                })}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">واحد / دپارتمان</label>
            <select
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm"
              value={form.unit_id || ''}
              onChange={e => setForm(f => ({ ...f, unit_id: e.target.value || null }))}
            >
              <option value="">— بدون واحد —</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">رنگ</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.color || '#3b82f6'}
                  onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  className="w-10 h-10 rounded-xl cursor-pointer border border-gray-200 dark:border-gray-600 p-0.5"
                />
                <input
                  className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                  value={form.color || ''}
                  onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">آیکن (ایموجی)</label>
              <input
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm"
                value={form.icon || ''}
                onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                placeholder="👑 ⭐ 💼"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">ترتیب نمایش</label>
            <input type="number"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm"
              value={form.sort_order ?? 0}
              onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
            />
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3 rounded-2xl font-semibold transition-colors"
          >
            {saving ? <Spinner className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {initial?.id ? 'ذخیره تغییرات' : 'افزودن سمت'}
          </button>
          <button onClick={onClose}
            className="px-5 py-3 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-2xl font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Assign User Modal ────────────────────────────────────────────────────────
function AssignUserModal({
  position, allProfiles, currentMembers, levelDefs, onAssign, onRemove, onClose, onRefreshProfiles,
}: {
  position: OrgPosition;
  allProfiles: Profile[];
  currentMembers: PositionMember[];
  levelDefs: LevelDef[];
  onAssign: (userId: string, isPrimary: boolean) => Promise<void>;
  onRemove: (memberId: string, userId: string) => Promise<void>;
  onClose: () => void;
  onRefreshProfiles: () => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUser, setNewUser] = useState({ full_name: '', email: '', password: '' });
  const [creatingUser, setCreatingUser] = useState(false);
  const lvl = getLevelInfo(position.level, levelDefs);
  const color = position.color || lvl.color;

  const handleCreateUser = async () => {
    if (!newUser.email.trim() || !newUser.password.trim()) {
      toast.error('ایمیل و رمز عبور الزامی است');
      return;
    }
    setCreatingUser(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: newUser.email.trim(),
        password: newUser.password.trim(),
        options: { data: { full_name: newUser.full_name } },
      });
      if (error) { toast.error(error.message); return; }
      if (data.user) {
        await supabase.from('profiles').upsert({
          user_id: data.user.id,
          email: newUser.email.trim(),
          full_name: newUser.full_name || null,
          is_active: true,
          is_admin: false,
        }, { onConflict: 'user_id' });
        toast.success('کاربر جدید ایجاد شد');
        setNewUser({ full_name: '', email: '', password: '' });
        setShowAddForm(false);
        await onRefreshProfiles();
        await onAssign(data.user.id, currentMembers.length === 0);
      }
    } finally {
      setCreatingUser(false);
    }
  };

  const assignedUserIds = new Set(currentMembers.map(m => m.user_id));
  const filtered = allProfiles.filter(p => {
    const q = search.toLowerCase();
    return p.full_name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q) || p.department?.toLowerCase().includes(q);
  });

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <UserCheck className="w-5 h-5" style={{ color }} />
            مدیریت کاربران: {position.title}
          </h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-xl">
            <X className="w-5 h-5" />
          </button>
        </div>

        {currentMembers.length > 0 && (
          <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">کاربران فعلی این سمت:</p>
            <div className="flex flex-wrap gap-2">
              {currentMembers.map(m => (
                <div key={m.id}
                  className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full border text-sm"
                  style={{ borderColor: color + '60', backgroundColor: color + '10' }}
                >
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ backgroundColor: color }}>
                    {(m.profile?.full_name || 'U').charAt(0)}
                  </div>
                  <span className="text-xs text-gray-700 dark:text-gray-200">{m.profile?.full_name || m.profile?.email}</span>
                  {m.is_primary && <span className="text-[9px] text-amber-500 font-bold">★</span>}
                  <button
                    onClick={async () => { setSaving(m.id); try { await onRemove(m.id, m.user_id); } finally { setSaving(null); } }}
                    disabled={saving === m.id}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    {saving === m.id ? <Spinner className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="px-6 py-3 shrink-0">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="جستجو در کاربران..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-2">
          {filtered.map(p => {
            const isAssigned = assignedUserIds.has(p.user_id);
            return (
              <div key={p.user_id}
                className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${isAssigned ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-200 dark:hover:border-blue-700'}`}
              >
                {p.avatar_url ? (
                  <img src={p.avatar_url} className="w-9 h-9 rounded-full object-cover shrink-0" alt="" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-blue-500" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{p.full_name || p.email}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {[p.position, p.department].filter(Boolean).join(' — ') || p.email}
                  </p>
                </div>
                {isAssigned ? (
                  <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-medium shrink-0">
                    <Check className="w-3.5 h-3.5" /> تخصیص یافته
                  </div>
                ) : (
                  <button
                    onClick={async () => { setSaving(p.user_id); try { await onAssign(p.user_id, currentMembers.length === 0); } finally { setSaving(null); } }}
                    disabled={saving === p.user_id}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-medium rounded-xl transition-colors shrink-0"
                  >
                    {saving === p.user_id ? <Spinner className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    انتخاب
                  </button>
                )}
              </div>
            );
          })}

          {filtered.length === 0 && !showAddForm && (
            <div className="flex flex-col items-center py-8 gap-3 text-gray-400">
              <User className="w-8 h-8 opacity-30" />
              <p className="text-sm">{search ? `کاربری با عبارت «${search}» یافت نشد` : 'هیچ کاربری وجود ندارد'}</p>
              <button
                onClick={() => { setShowAddForm(true); if (search) setNewUser(u => ({ ...u, full_name: search })); }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" /> افزودن کاربر جدید
              </button>
            </div>
          )}

          {showAddForm && (
            <div className="border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                  <Plus className="w-4 h-4" /> افزودن کاربر جدید
                </p>
                <button onClick={() => setShowAddForm(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="نام و نام خانوادگی"
                value={newUser.full_name}
                onChange={e => setNewUser(u => ({ ...u, full_name: e.target.value }))}
              />
              <input
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="ایمیل *" type="email" dir="ltr"
                value={newUser.email}
                onChange={e => setNewUser(u => ({ ...u, email: e.target.value }))}
              />
              <input
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="رمز عبور *" type="password" dir="ltr"
                value={newUser.password}
                onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
              />
              <div className="flex gap-2">
                <button onClick={handleCreateUser} disabled={creatingUser}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  {creatingUser ? <Spinner className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  ایجاد و تخصیص به سمت
                </button>
                <button onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm"
                >
                  انصراف
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Unit Form Modal ──────────────────────────────────────────────────────────
function UnitFormModal({ initial, allUnits, onSave, onClose }: {
  initial: Partial<OrgUnit> | null;
  allUnits: OrgUnit[];
  onSave: (data: Partial<OrgUnit>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<OrgUnit>>(initial || { name: '', code: '', sort_order: 0 });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.name?.trim()) { toast.error('نام واحد را وارد کنید'); return; }
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-amber-500" />
            {initial?.id ? 'ویرایش واحد' : 'افزودن واحد سازمانی'}
          </h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-xl"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">نام واحد *</label>
            <input className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-sm"
              value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="مثال: معاونت فناوری اطلاعات" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">کد واحد</label>
            <input className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-sm"
              value={form.code || ''} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
              placeholder="مثال: IT, HR, FIN" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">واحد بالادستی</label>
            <select className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-sm"
              value={form.parent_id || ''} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value || null }))}>
              <option value="">— ندارد —</option>
              {allUnits.filter(u => u.id !== form.id).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white py-3 rounded-2xl font-semibold transition-colors"
          >
            {saving ? <Spinner className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {initial?.id ? 'ذخیره' : 'افزودن'}
          </button>
          <button onClick={onClose} className="px-5 py-3 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-2xl font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">انصراف</button>
        </div>
      </div>
    </div>
  );
}

// ─── Level Manager Panel ──────────────────────────────────────────────────────
function LevelManagerPanel({ levelDefs, onRefresh }: { levelDefs: LevelDef[]; onRefresh: () => void }) {
  const [editing, setEditing] = useState<LevelDef | null>(null);
  const [form, setForm] = useState<LevelDef>({ level: 9, label: '', color: '#6b7280', icon: '👤', sort_order: 9 });
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const saveLevel = async () => {
    if (!form.label.trim()) { toast.error('نام سطح الزامی است'); return; }
    setSaving(true);
    try {
      if (editing?.id) {
        await supabase.from('org_level_definitions').update({ label: form.label, color: form.color, icon: form.icon, sort_order: form.sort_order }).eq('id', editing.id);
      } else {
        const { error } = await supabase.from('org_level_definitions').insert([{ level: form.level, label: form.label, color: form.color, icon: form.icon, sort_order: form.sort_order }]);
        if (error) { toast.error('خطا: ' + error.message); return; }
      }
      toast.success('سطح ذخیره شد');
      setEditing(null);
      setShowAdd(false);
      onRefresh();
    } finally { setSaving(false); }
  };

  const deleteLevel = async (id: string) => {
    if (!confirm('آیا از حذف این سطح مطمئنید؟')) return;
    await supabase.from('org_level_definitions').delete().eq('id', id);
    toast.success('سطح حذف شد');
    onRefresh();
  };

  const sorted = [...levelDefs].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <div>
          <h4 className="font-semibold text-gray-800 dark:text-white text-sm flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-500" />
            سطح‌بندی سازمانی
          </h4>
          <p className="text-xs text-gray-400 mt-0.5">تعریف و ویرایش سطوح سلسله‌مراتبی سازمان</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setEditing(null); setForm({ level: sorted.length + 1, label: '', color: '#6b7280', icon: '👤', sort_order: sorted.length + 1 }); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> افزودن سطح
        </button>
      </div>

      {(showAdd || editing) && (
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/10">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">نام سطح *</label>
              <input className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-sm"
                value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="مثال: رئیس اداره" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">شماره سطح</label>
              <input type="number" className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-sm"
                value={form.level} onChange={e => setForm(f => ({ ...f, level: parseInt(e.target.value) || 1 }))} min={1} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">آیکن</label>
              <input className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-sm"
                value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} placeholder="👑" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">رنگ</label>
              <div className="flex gap-2">
                <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  className="w-10 h-[38px] rounded-xl cursor-pointer border border-gray-200 dark:border-gray-600 p-0.5" />
                <input className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-xs font-mono"
                  value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={saveLevel} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
            >
              {saving ? <Spinner className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {editing ? 'ذخیره' : 'افزودن'}
            </button>
            <button onClick={() => { setEditing(null); setShowAdd(false); }}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm">
              انصراف
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {sorted.map(l => (
          <div key={l.level} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm" style={{ backgroundColor: l.color + '20' }}>
              <span>{l.icon}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800 dark:text-white">{l.label}</span>
                <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: l.color }}>
                  سطح {l.level}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setEditing(l); setShowAdd(false); setForm({ ...l }); }}
                className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              {l.id && (
                <button onClick={() => deleteLevel(l.id!)}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── HR/SSO Config Panel ──────────────────────────────────────────────────────
function HrSsoConfigPanel({ configs, onSave }: {
  configs: HrSsoConfig[];
  onSave: (config: Partial<HrSsoConfig>) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<'hr' | 'sso'>('hr');
  const hrConfig = configs.find(c => c.config_type === 'hr');
  const ssoConfig = configs.find(c => c.config_type === 'sso');
  const config = activeTab === 'hr' ? hrConfig : ssoConfig;

  const [form, setForm] = useState<Partial<HrSsoConfig>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (config) {
      setForm({ ...config });
    } else {
      setForm({ config_type: activeTab, provider_name: '', base_url: '', api_key: '', client_id: '', client_secret: '', sync_enabled: false, sync_interval_minutes: 60, is_active: false, field_mappings: {} });
    }
    setTestResult(null);
  }, [activeTab, config?.id]);

  const handleSave = async () => {
    setSaving(true);
    try { await onSave({ ...form, config_type: activeTab }); } finally { setSaving(false); }
  };

  const handleTest = async () => {
    if (!form.base_url) { toast.error('آدرس API را وارد کنید'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(form.base_url, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (res && res.ok) {
        setTestResult({ ok: true, msg: `اتصال موفق — وضعیت: ${res.status}` });
      } else {
        setTestResult({ ok: false, msg: res ? `خطا در اتصال — وضعیت: ${res.status}` : 'اتصال برقرار نشد (timeout یا CORS)' });
      }
    } finally { setTesting(false); }
  };

  const HR_PROVIDERS = ['همکاران سیستم', 'نرم‌افزار فردا', 'راهکار', 'سپیدار', 'سایر'];
  const SSO_PROVIDERS = ['Keycloak', 'Active Directory / LDAP', 'Azure AD', 'Okta', 'Google Workspace', 'سایر'];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <h4 className="font-semibold text-gray-800 dark:text-white text-sm flex items-center gap-2">
          <Settings className="w-4 h-4 text-blue-500" />
          یکپارچه‌سازی HR و SSO
        </h4>
        <p className="text-xs text-gray-400 mt-0.5">اتصال به سیستم‌های منابع انسانی و احراز هویت یکپارچه</p>
      </div>

      {/* Type tabs */}
      <div className="flex border-b border-gray-100 dark:border-gray-700">
        <button
          onClick={() => setActiveTab('hr')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${activeTab === 'hr' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
        >
          <Database className="w-4 h-4" /> سیستم HR
        </button>
        <button
          onClick={() => setActiveTab('sso')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${activeTab === 'sso' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
        >
          <Shield className="w-4 h-4" /> SSO / احراز هویت
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* Status badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {config?.is_active ? (
              <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1 rounded-full font-medium">
                <Wifi className="w-3.5 h-3.5" /> فعال
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full font-medium">
                <WifiOff className="w-3.5 h-3.5" /> غیرفعال
              </span>
            )}
            {config?.last_sync_at && (
              <span className="text-xs text-gray-400">
                آخرین همگام‌سازی: {new Date(config.last_sync_at).toLocaleString('fa-IR')}
              </span>
            )}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-gray-600 dark:text-gray-400">فعال‌سازی</span>
            <div className="relative">
              <input type="checkbox" className="sr-only peer"
                checked={form.is_active || false}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              />
              <div className="w-10 h-5 bg-gray-200 dark:bg-gray-600 peer-checked:bg-blue-600 rounded-full transition-colors" />
              <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow" />
            </div>
          </label>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
            {activeTab === 'hr' ? 'سیستم HR' : 'ارائه‌دهنده SSO'}
          </label>
          <select
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm"
            value={form.provider_name || ''}
            onChange={e => setForm(f => ({ ...f, provider_name: e.target.value }))}
          >
            <option value="">انتخاب کنید</option>
            {(activeTab === 'hr' ? HR_PROVIDERS : SSO_PROVIDERS).map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">آدرس API (Base URL)</label>
          <input
            type="url" dir="ltr"
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm"
            value={form.base_url || ''} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
            placeholder="https://hr.company.com/api/v1"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
            <Key className="w-3 h-3 inline ml-1" />
            {activeTab === 'hr' ? 'کلید API' : 'Client ID'}
          </label>
          <input
            type="text" dir="ltr"
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm font-mono"
            value={activeTab === 'hr' ? (form.api_key || '') : (form.client_id || '')}
            onChange={e => setForm(f => activeTab === 'hr' ? { ...f, api_key: e.target.value } : { ...f, client_id: e.target.value })}
            placeholder={activeTab === 'hr' ? 'sk-...' : 'client_id_...'}
          />
        </div>

        {activeTab === 'sso' && (
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              <Key className="w-3 h-3 inline ml-1" />Client Secret
            </label>
            <input
              type="password" dir="ltr"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm font-mono"
              value={form.client_secret || ''}
              onChange={e => setForm(f => ({ ...f, client_secret: e.target.value }))}
              placeholder="secret_..."
            />
          </div>
        )}

        {activeTab === 'hr' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">همگام‌سازی خودکار</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <div className="relative">
                  <input type="checkbox" className="sr-only peer"
                    checked={form.sync_enabled || false}
                    onChange={e => setForm(f => ({ ...f, sync_enabled: e.target.checked }))}
                  />
                  <div className="w-10 h-5 bg-gray-200 dark:bg-gray-600 peer-checked:bg-emerald-500 rounded-full transition-colors" />
                  <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-300">{form.sync_enabled ? 'فعال' : 'غیرفعال'}</span>
              </label>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">بازه همگام‌سازی (دقیقه)</label>
              <input type="number"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm"
                value={form.sync_interval_minutes || 60}
                onChange={e => setForm(f => ({ ...f, sync_interval_minutes: parseInt(e.target.value) || 60 }))}
                min={15} dir="ltr"
              />
            </div>
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div className={`flex items-center gap-2 p-3 rounded-xl text-sm ${testResult.ok ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
            {testResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            {testResult.msg}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            {saving ? <Spinner className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            ذخیره تنظیمات
          </button>
          <button onClick={handleTest} disabled={testing || !form.base_url}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-medium transition-colors"
          >
            {testing ? <Spinner className="w-4 h-4 animate-spin" /> : <RefreshIcon className="w-4 h-4" />}
            تست اتصال
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Hierarchical Position List ───────────────────────────────────────────────
function PositionRow({
  position, depth, allPositions, allMembers, units, levelDefs,
  onEdit, onDelete, onAssign,
}: {
  position: OrgPosition; depth: number;
  allPositions: OrgPosition[]; allMembers: PositionMember[];
  units: OrgUnit[]; levelDefs: LevelDef[];
  onEdit: (p: OrgPosition) => void;
  onDelete: (id: string) => void;
  onAssign: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showStaff, setShowStaff] = useState(false);
  const children = allPositions.filter(p => p.parent_position_id === position.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const posMembers = allMembers.filter(m => m.position_id === position.id);
  const lvl = getLevelInfo(position.level, levelDefs);
  const posUnit = units.find(u => u.id === position.unit_id);
  const color = position.color || lvl.color;
  const icon = position.icon || lvl.icon;

  return (
    <>
      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors group">
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5" style={{ paddingRight: `${depth * 24}px` }}>
            {children.length > 0 ? (
              <button onClick={() => setExpanded(v => !v)} className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors shrink-0">
                {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="font-medium text-gray-800 dark:text-white text-sm">{icon} {position.title}</span>
          </div>
        </td>
        <td className="px-4 py-2.5">
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium text-white whitespace-nowrap" style={{ backgroundColor: color }}>
            {lvl.label}
          </span>
        </td>
        <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 hidden sm:table-cell">{posUnit?.name || '—'}</td>
        <td className="px-4 py-2.5">
          <button
            onClick={() => setShowStaff(v => !v)}
            className="flex items-center gap-1 text-blue-500 hover:text-blue-700 font-medium text-sm whitespace-nowrap"
            title="مشاهده پرسنل"
          >
            <Users className="w-3.5 h-3.5" />
            {posMembers.length} نفر
            {posMembers.length > 0 && (showStaff ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
          </button>
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onAssign(position.id)} className="p-1.5 text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors" title="مدیریت پرسنل">
              <UserCheck className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onEdit(position)} className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors" title="ویرایش">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onDelete(position.id)} className="p-1.5 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors" title="حذف">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {showStaff && posMembers.length > 0 && (
        <tr>
          <td colSpan={5} className="px-4 pb-2 pt-0" style={{ paddingRight: `${depth * 24 + 44}px` }}>
            <div className="flex flex-wrap gap-2 py-2 px-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-gray-100 dark:border-gray-700">
              {posMembers.map(m => (
                <div key={m.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: color + '18', border: `1px solid ${color}40` }}>
                  {m.profile?.avatar_url ? (
                    <img src={m.profile.avatar_url} className="w-5 h-5 rounded-full object-cover" alt="" />
                  ) : (
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ backgroundColor: color }}>
                      {(m.profile?.full_name || 'U').charAt(0)}
                    </div>
                  )}
                  <span className="text-gray-700 dark:text-gray-200">{m.profile?.full_name || m.profile?.email || 'کاربر'}</span>
                  {m.is_primary && <span className="text-amber-500 text-[9px] font-bold">★</span>}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
      {expanded && children.map(child => (
        <PositionRow
          key={child.id} position={child} depth={depth + 1}
          allPositions={allPositions} allMembers={allMembers}
          units={units} levelDefs={levelDefs}
          onEdit={onEdit} onDelete={onDelete} onAssign={onAssign}
        />
      ))}
    </>
  );
}

function HierarchicalPositionList({
  positions, members, units, levelDefs, onEdit, onDelete, onAssign,
}: {
  positions: OrgPosition[]; members: PositionMember[];
  units: OrgUnit[]; levelDefs: LevelDef[];
  onEdit: (p: OrgPosition) => void;
  onDelete: (id: string) => void;
  onAssign: (id: string) => void;
}) {
  const roots = positions.filter(p => !p.parent_position_id).sort((a, b) => a.level - b.level || a.sort_order - b.sort_order);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      {positions.length === 0 ? (
        <div className="py-12 text-center text-gray-400 text-sm">سمتی تعریف نشده است</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <tr>
                <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">سمت</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">سطح</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 hidden sm:table-cell">واحد</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">پرسنل</th>
                <th className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {roots.map(pos => (
                <PositionRow
                  key={pos.id} position={pos} depth={0}
                  allPositions={positions} allMembers={members}
                  units={units} levelDefs={levelDefs}
                  onEdit={onEdit} onDelete={onDelete} onAssign={onAssign}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Org Permissions Panel ────────────────────────────────────────────────────

const ALL_PERMISSION_GROUPS = [
  { group: 'جلسات', color: '#3b82f6', keys: [
    { key: 'meetings',           label: 'مشاهده جلسات' },
    { key: 'meetings_create',    label: 'ایجاد جلسه' },
    { key: 'meetings_edit',      label: 'ویرایش جلسه' },
    { key: 'meetings_delete',    label: 'حذف جلسه' },
    { key: 'meetings_export',    label: 'خروجی جلسات (اکسل)' },
    { key: 'meetings_delegate',  label: 'واگذاری جلسه به دیگران' },
  ]},
  { group: 'تقویم', color: '#8b5cf6', keys: [
    { key: 'calendar',                  label: 'مشاهده تقویم' },
    { key: 'calendar_create_event',     label: 'ایجاد رویداد' },
    { key: 'calendar_create_occasion',  label: 'مدیریت مناسبت‌ها' },
    { key: 'calendar_subscribe',        label: 'دنبال‌کردن تقویم دیگران' },
  ]},
  { group: 'چت سازمانی', color: '#06b6d4', keys: [
    { key: 'chat',                    label: 'چت سازمانی' },
    { key: 'chat_send_urgent',        label: 'ارسال پیام فوری' },
    { key: 'chat_send_confidential',  label: 'ارسال پیام محرمانه' },
    { key: 'chat_forward_message',    label: 'ارسال پیام به دیگران' },
    { key: 'chat_delete_message',     label: 'حذف پیام چت' },
  ]},
  { group: 'کانال‌ها و گروه‌ها', color: '#10b981', keys: [
    { key: 'channels',                label: 'مشاهده کانال‌ها و گروه‌ها' },
    { key: 'channels_create_channel', label: 'ساخت کانال جدید' },
    { key: 'channels_create_group',   label: 'ساخت گروه جدید' },
    { key: 'channels_manage_members', label: 'مدیریت اعضای کانال/گروه' },
    { key: 'channels_delete',         label: 'حذف کانال/گروه' },
  ]},
  { group: 'ویدیو کنفرانس', color: '#f59e0b', keys: [
    { key: 'video_conference',        label: 'کنفرانس ویدیویی' },
    { key: 'video_create_room',       label: 'ایجاد اتاق کنفرانس' },
  ]},
  { group: 'اقدامات', color: '#ef4444', keys: [
    { key: 'tasks',         label: 'مشاهده اقدامات' },
    { key: 'tasks_create',  label: 'ایجاد اقدام' },
    { key: 'tasks_edit',    label: 'ویرایش اقدام' },
    { key: 'tasks_delete',  label: 'حذف اقدام' },
    { key: 'tasks_assign',  label: 'انتساب اقدام به دیگران' },
  ]},
  { group: 'یادداشت‌ها', color: '#f97316', keys: [
    { key: 'notes',         label: 'مشاهده یادداشت‌ها' },
    { key: 'notes_create',  label: 'ایجاد یادداشت' },
    { key: 'notes_edit',    label: 'ویرایش یادداشت' },
    { key: 'notes_delete',  label: 'حذف یادداشت' },
  ]},
  { group: 'مخاطبین', color: '#6366f1', keys: [
    { key: 'contacts',          label: 'مشاهده مخاطبین' },
    { key: 'contacts_create',   label: 'افزودن مخاطب' },
    { key: 'contacts_edit',     label: 'ویرایش مخاطب' },
    { key: 'contacts_delete',   label: 'حذف مخاطب' },
    { key: 'contacts_email',    label: 'مخاطبین ایمیل' },
    { key: 'contacts_share',    label: 'اشتراک‌گذاری مخاطب' },
  ]},
  { group: 'گزارش‌ها', color: '#84cc16', keys: [
    { key: 'reports',           label: 'مشاهده گزارشات' },
    { key: 'reports_export',    label: 'خروجی گزارش (اکسل)' },
    { key: 'reports_view_all',  label: 'مشاهده گزارش همه کاربران' },
  ]},
  { group: 'دستیار هوش مصنوعی', color: '#ec4899', keys: [
    { key: 'spark',             label: 'دستیار اسپارک' },
    { key: 'spark_meeting_req', label: 'درخواست جلسه از طریق اسپارک' },
  ]},
  { group: 'مدیریت سازمانی', color: '#64748b', keys: [
    { key: 'admin_panel',           label: 'پنل مدیریت' },
    { key: 'org_manage_structure',  label: 'مدیریت ساختار سازمانی' },
    { key: 'org_manage_permissions','label': 'مدیریت دسترسی‌های سازمانی' },
    { key: 'user_management',       label: 'مدیریت کاربران' },
    { key: 'system_config',         label: 'تنظیمات سیستم' },
    { key: 'notification_config',   label: 'تنظیمات اعلان‌ها' },
    { key: 'sms_config',            label: 'تنظیمات پیامک' },
    { key: 'backup_access',         label: 'پشتیبان‌گیری' },
    { key: 'audit_log',             label: 'گزارش تاریخچه عملیات' },
  ]},
];

interface LevelPermState { [permKey: string]: boolean }

function OrgPermissionsPanel({
  positions,
  levelDefs,
}: {
  positions: OrgPosition[];
  levelDefs: LevelDef[];
}) {
  const [mode, setMode] = useState<'level' | 'position'>('level');
  const [selectedLevel, setSelectedLevel] = useState<number>(1);
  const [selectedPositionId, setSelectedPositionId] = useState<string>('');
  const [perms, setPerms] = useState<LevelPermState>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const levels = [...levelDefs].sort((a, b) => a.level - b.level);

  const loadLevelPerms = async (level: number) => {
    setLoading(true);
    const { data } = await supabase.from('org_level_permissions').select('permission_key, granted').eq('level', level);
    const map: LevelPermState = {};
    for (const p of (data || [])) map[p.permission_key] = p.granted;
    setPerms(map);
    setLoading(false);
  };

  const loadPositionPerms = async (positionId: string) => {
    if (!positionId) return;
    setLoading(true);
    // ابتدا دسترسی‌های سطح پایه را بگیر
    const pos = positions.find(p => p.id === positionId);
    const levelMap: LevelPermState = {};
    if (pos) {
      const { data: ld } = await supabase.from('org_level_permissions').select('permission_key, granted').eq('level', pos.level);
      for (const p of (ld || [])) levelMap[p.permission_key] = p.granted;
    }
    // سپس override های پست خاص
    const { data: pd } = await supabase.from('org_position_permissions').select('permission_key, granted').eq('position_id', positionId);
    const overrideMap: LevelPermState = {};
    for (const p of (pd || [])) overrideMap[p.permission_key] = p.granted;
    setPerms({ ...levelMap, ...overrideMap });
    setLoading(false);
  };

  useEffect(() => {
    if (mode === 'level') loadLevelPerms(selectedLevel);
  }, [mode, selectedLevel]);

  useEffect(() => {
    if (mode === 'position' && selectedPositionId) loadPositionPerms(selectedPositionId);
  }, [mode, selectedPositionId]);

  const togglePerm = (key: string) => {
    setPerms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (mode === 'level') {
        for (const [key, granted] of Object.entries(perms)) {
          await supabase.from('org_level_permissions')
            .upsert({ level: selectedLevel, permission_key: key, granted }, { onConflict: 'level,permission_key' });
        }
        // حذف کلیدهایی که کاملاً نیستند
        const allKeys = ALL_PERMISSION_GROUPS.flatMap(g => g.keys.map(k => k.key));
        for (const key of allKeys) {
          if (!(key in perms)) {
            await supabase.from('org_level_permissions')
              .delete().eq('level', selectedLevel).eq('permission_key', key);
          }
        }
        toast.success('دسترسی‌های سطح ذخیره شد');
      } else if (selectedPositionId) {
        // فقط override ها را ذخیره کن (تفاوت با سطح پایه)
        const pos = positions.find(p => p.id === selectedPositionId);
        const levelMap: LevelPermState = {};
        if (pos) {
          const { data: ld } = await supabase.from('org_level_permissions').select('permission_key, granted').eq('level', pos.level);
          for (const p of (ld || [])) levelMap[p.permission_key] = p.granted;
        }
        // ابتدا همه override های قبلی را پاک کن
        await supabase.from('org_position_permissions').delete().eq('position_id', selectedPositionId);
        // فقط تفاوت‌ها را بنویس
        const overrides: { position_id: string; permission_key: string; granted: boolean }[] = [];
        for (const [key, granted] of Object.entries(perms)) {
          if (levelMap[key] !== granted) {
            overrides.push({ position_id: selectedPositionId, permission_key: key, granted });
          }
        }
        if (overrides.length > 0) {
          await supabase.from('org_position_permissions').insert(overrides);
        }
        toast.success('دسترسی‌های پست ذخیره شد');
      }
    } catch {
      toast.error('خطا در ذخیره');
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      {/* حالت انتخاب */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('level')}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${mode === 'level' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            دسترسی بر اساس سطح
          </button>
          <button
            onClick={() => setMode('position')}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${mode === 'position' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            override برای پست خاص
          </button>
        </div>

        {mode === 'level' ? (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">انتخاب سطح سازمانی:</p>
            <div className="flex flex-wrap gap-2">
              {levels.map(l => (
                <button
                  key={l.level}
                  onClick={() => setSelectedLevel(l.level)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${selectedLevel === l.level ? 'border-transparent text-white shadow-xs' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-300'}`}
                  style={selectedLevel === l.level ? { backgroundColor: l.color } : {}}
                >
                  <span>{l.icon}</span> {l.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">انتخاب پست سازمانی:</p>
            <select
              value={selectedPositionId}
              onChange={e => setSelectedPositionId(e.target.value)}
              className="w-full p-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-white"
            >
              <option value="">— پست را انتخاب کنید —</option>
              {[...positions].sort((a, b) => a.level - b.level || a.title.localeCompare(b.title)).map(p => {
                const lvl = getLevelInfo(p.level, levelDefs);
                return <option key={p.id} value={p.id}>{lvl.icon} {p.title} (سطح {p.level})</option>;
              })}
            </select>
            {selectedPositionId && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                تغییرات این بخش فقط روی این پست اعمال می‌شود و سطح پایه را تغییر نمی‌دهد.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ماتریس دسترسی‌ها */}
      {(mode === 'level' || selectedPositionId) && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          {loading ? (
            <div className="py-12 text-center text-gray-400 text-sm">در حال بارگذاری...</div>
          ) : (
            <>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {ALL_PERMISSION_GROUPS.map(group => {
                  const groupKeys = group.keys.map(k => k.key);
                  const allGranted = groupKeys.every(k => !!perms[k]);
                  const someGranted = groupKeys.some(k => !!perms[k]);
                  return (
                    <div key={group.group} className="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                      <div
                        className="px-3 py-2 flex items-center justify-between"
                        style={{ backgroundColor: group.color + '18', borderBottom: `2px solid ${group.color}33` }}
                      >
                        <span className="text-xs font-bold" style={{ color: group.color }}>{group.group}</span>
                        <button
                          onClick={() => {
                            const next = !allGranted;
                            setPerms(prev => {
                              const updated = { ...prev };
                              groupKeys.forEach(k => { updated[k] = next; });
                              return updated;
                            });
                          }}
                          className="text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors"
                          style={{
                            backgroundColor: allGranted ? group.color : someGranted ? group.color + '40' : '#e5e7eb',
                            color: allGranted ? '#fff' : someGranted ? group.color : '#9ca3af',
                          }}
                        >
                          {allGranted ? 'همه فعال' : someGranted ? 'ناقص' : 'همه غیرفعال'}
                        </button>
                      </div>
                      <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
                        {group.keys.map(item => (
                          <label key={item.key} className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                            <span className="text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
                            <div
                              onClick={() => togglePerm(item.key)}
                              className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${!perms[item.key] ? 'bg-gray-300 dark:bg-gray-600' : ''}`}
                              style={perms[item.key] ? { backgroundColor: group.color } : {}}
                            >
                              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${perms[item.key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="px-4 pb-4 flex gap-3 justify-end">
                <button
                  onClick={() => {
                    const allKeys = ALL_PERMISSION_GROUPS.flatMap(g => g.keys.map(k => k.key));
                    setPerms(Object.fromEntries(allKeys.map(k => [k, true])));
                  }}
                  className="px-4 py-2 text-sm font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 rounded-xl transition-colors"
                >
                  فعال‌سازی همه
                </button>
                <button
                  onClick={() => {
                    const allKeys = ALL_PERMISSION_GROUPS.flatMap(g => g.keys.map(k => k.key));
                    setPerms(Object.fromEntries(allKeys.map(k => [k, false])));
                  }}
                  className="px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 rounded-xl transition-colors"
                >
                  غیرفعال‌سازی همه
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  {saving ? 'در حال ذخیره...' : 'ذخیره دسترسی‌ها'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function OrgStructurePage() {
  const [org, setOrg] = useState<OrgOrganization | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [showOrgForm, setShowOrgForm] = useState(false);
  const [orgForm, setOrgForm] = useState({ name: '', short_name: '', description: '', logo_url: '', website: '' });
  const [orgSaving, setOrgSaving] = useState(false);
  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [positions, setPositions] = useState<OrgPosition[]>([]);
  const [members, setMembers] = useState<PositionMember[]>([]);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [levelDefs, setLevelDefs] = useState<LevelDef[]>(DEFAULT_LEVELS);
  const [hrSsoConfigs, setHrSsoConfigs] = useState<HrSsoConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<'chart' | 'list' | 'units' | 'permissions' | 'settings'>('chart');
  const [showPositionForm, setShowPositionForm] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Partial<OrgPosition> | null>(null);
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Partial<OrgUnit> | null>(null);
  const [assigningPositionId, setAssigningPositionId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: orgData }, { data: u }, { data: p }, { data: m }, { data: pr }, { data: ld }, { data: hc }] = await Promise.all([
        supabase.from('org_organizations').select('*').maybeSingle(),
        supabase.from('org_units').select('*').order('sort_order').order('name'),
        supabase.from('org_positions').select('*').order('level').order('sort_order').order('title'),
        supabase.from('org_position_members').select('*').order('is_primary', { ascending: false }),
        supabase.from('profiles').select('user_id,full_name,email,avatar_url,position,department,primary_position_id,primary_unit_id').order('full_name'),
        supabase.from('org_level_definitions').select('*').order('sort_order'),
        supabase.from('hr_sso_config').select('*'),
      ]);
      setOrg(orgData as OrgOrganization | null);
      setOrgLoading(false);
      const profilesByUserId = new Map((pr || []).map(p => [p.user_id, p]));
      const enrichedMembers = (m || []).map((mem: any) => ({
        ...mem,
        profile: profilesByUserId.get(mem.user_id) ?? null,
      }));
      setUnits(u || []);
      setPositions(p || []);
      setMembers(enrichedMembers as PositionMember[]);
      setAllProfiles(pr || []);
      if (ld && ld.length > 0) setLevelDefs(ld as LevelDef[]);
      setHrSsoConfigs((hc || []) as HrSsoConfig[]);
    } catch {
      toast.error('خطا در بارگذاری ساختار سازمانی');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Position CRUD ─────────────────────────────────────────────────────────
  const savePosition = async (data: Partial<OrgPosition>) => {
    if (data.id) {
      const { id, created_at, ...updateData } = data as any;
      const { error } = await supabase.from('org_positions').update(updateData).eq('id', data.id);
      if (error) { toast.error('خطا در ذخیره'); return; }
    } else {
      const { error } = await supabase.from('org_positions').insert([data]);
      if (error) { toast.error('خطا: ' + error.message); return; }
    }
    toast.success(data.id ? 'سمت ویرایش شد' : 'سمت افزوده شد');
    setShowPositionForm(false);
    setEditingPosition(null);
    fetchAll();
  };

  const deletePosition = async (id: string) => {
    if (!confirm('آیا از حذف این سمت مطمئنید؟ تمام تخصیص‌های مرتبط هم حذف می‌شوند.')) return;
    await supabase.from('org_positions').delete().eq('id', id);
    toast.success('سمت حذف شد');
    fetchAll();
  };

  // ── Unit CRUD ─────────────────────────────────────────────────────────────
  const saveUnit = async (data: Partial<OrgUnit>) => {
    if (data.id) {
      const { error } = await supabase.from('org_units').update(data).eq('id', data.id);
      if (error) { toast.error('خطا در ذخیره'); return; }
    } else {
      const { error } = await supabase.from('org_units').insert([data]);
      if (error) { toast.error('خطا در افزودن'); return; }
    }
    toast.success(data.id ? 'واحد ویرایش شد' : 'واحد افزوده شد');
    setShowUnitForm(false);
    setEditingUnit(null);
    fetchAll();
  };

  const deleteUnit = async (id: string) => {
    if (!confirm('آیا از حذف این واحد مطمئنید؟')) return;
    await supabase.from('org_units').delete().eq('id', id);
    toast.success('واحد حذف شد');
    fetchAll();
  };

  // ── Member assign/remove ──────────────────────────────────────────────────
  const assignUser = async (userId: string, isPrimary: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('org_position_members').insert([{
      position_id: assigningPositionId,
      user_id: userId,
      is_primary: isPrimary,
      assigned_by: user?.id,
    }]);
    if (error) { toast.error('خطا در تخصیص: ' + error.message); return; }
    if (isPrimary) {
      const pos = positions.find(p => p.id === assigningPositionId);
      await supabase.from('profiles').update({
        primary_position_id: assigningPositionId,
        primary_unit_id: pos?.unit_id || null,
        position: pos?.title || undefined,
        department: pos?.unit_id ? units.find(u => u.id === pos.unit_id)?.name || undefined : undefined,
        organization: org?.name || undefined,
      }).eq('user_id', userId);
    }
    toast.success('کاربر به سمت تخصیص یافت');
    fetchAll();
  };

  const removeMember = async (memberId: string, userId: string) => {
    await supabase.from('org_position_members').delete().eq('id', memberId);
    const remaining = members.filter(m => m.id !== memberId && m.user_id === userId);
    if (remaining.length === 0) {
      await supabase.from('profiles').update({ primary_position_id: null, primary_unit_id: null }).eq('user_id', userId);
    }
    toast.success('تخصیص حذف شد');
    fetchAll();
  };

  // ── HR/SSO save ───────────────────────────────────────────────────────────
  const saveHrSsoConfig = async (data: Partial<HrSsoConfig>) => {
    const existing = hrSsoConfigs.find(c => c.config_type === data.config_type);
    if (existing) {
      const { error } = await supabase.from('hr_sso_config').update({ ...data, updated_at: new Date().toISOString() }).eq('id', existing.id);
      if (error) { toast.error('خطا: ' + error.message); return; }
    } else {
      const { error } = await supabase.from('hr_sso_config').insert([data]);
      if (error) { toast.error('خطا: ' + error.message); return; }
    }
    toast.success('تنظیمات ذخیره شد');
    fetchAll();
  };

  const saveOrg = async () => {
    if (!orgForm.name.trim()) { toast.error('نام سازمان را وارد کنید'); return; }
    setOrgSaving(true);
    try {
      if (org) {
        const { error } = await supabase.from('org_organizations').update({ ...orgForm, updated_at: new Date().toISOString() }).eq('id', org.id);
        if (error) { toast.error('خطا در ذخیره: ' + error.message); return; }
      } else {
        const { error } = await supabase.from('org_organizations').insert([orgForm]);
        if (error) { toast.error('خطا در ایجاد: ' + error.message); return; }
      }
      toast.success('اطلاعات سازمان ذخیره شد');
      setShowOrgForm(false);
      fetchAll();
    } finally {
      setOrgSaving(false);
    }
  };

  const rootPositions = positions.filter(p => !p.parent_position_id);
  const assigningPosition = assigningPositionId ? positions.find(p => p.id === assigningPositionId) || null : null;
  const assigningMembers = assigningPositionId ? members.filter(m => m.position_id === assigningPositionId) : [];

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
        <p className="text-sm text-gray-500">در حال بارگذاری ساختار سازمانی...</p>
      </div>
    </div>
  );

  // If no organization defined yet, show setup screen
  if (!orgLoading && !org && !showOrgForm) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6" dir="rtl">
        <div className="w-20 h-20 rounded-3xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <Building2 className="w-10 h-10 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">سازمان تعریف نشده</h2>
          <p className="text-gray-500 dark:text-gray-400 max-w-md text-sm leading-relaxed">
            قبل از تعریف واحدها و سمت‌های سازمانی، ابتدا باید اطلاعات سازمان را وارد کنید.
            نام سازمان در پروفایل تمام کاربران نمایش داده می‌شود.
          </p>
        </div>
        <button
          onClick={() => { setOrgForm({ name: '', short_name: '', description: '', logo_url: '', website: '' }); setShowOrgForm(true); }}
          className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl text-sm font-semibold transition-colors shadow-lg"
        >
          <Plus className="w-5 h-5" />
          تعریف سازمان
        </button>
      </div>
    );
  }

  // Org form modal
  if (showOrgForm) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-amber-500" />
              {org ? 'ویرایش اطلاعات سازمان' : 'تعریف سازمان'}
            </h3>
            {org && <button onClick={() => setShowOrgForm(false)} className="p-2 text-gray-400 hover:text-gray-600 rounded-xl"><X className="w-5 h-5" /></button>}
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">نام سازمان *</label>
              <input
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-sm"
                value={orgForm.name}
                onChange={e => setOrgForm(f => ({ ...f, name: e.target.value }))}
                placeholder="مثال: شرکت نمونه"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">نام اختصاری</label>
              <input
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-sm"
                value={orgForm.short_name}
                onChange={e => setOrgForm(f => ({ ...f, short_name: e.target.value }))}
                placeholder="مثال: ن.ش"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">توضیحات</label>
              <textarea
                rows={3}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-sm resize-none"
                value={orgForm.description}
                onChange={e => setOrgForm(f => ({ ...f, description: e.target.value }))}
                placeholder="توضیح مختصر درباره سازمان"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">وبسایت</label>
              <input
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-sm"
                value={orgForm.website}
                onChange={e => setOrgForm(f => ({ ...f, website: e.target.value }))}
                placeholder="https://example.com"
                dir="ltr"
              />
            </div>
          </div>
          <div className="px-6 pb-6 flex gap-3">
            <button
              onClick={saveOrg}
              disabled={orgSaving}
              className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold text-sm transition-colors disabled:opacity-50"
            >
              {orgSaving ? 'در حال ذخیره...' : 'ذخیره سازمان'}
            </button>
            {org && (
              <button onClick={() => setShowOrgForm(false)} className="px-5 py-3 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">
                انصراف
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-800 dark:text-white">ساختار سازمانی</h2>
              {org && (
                <button onClick={() => { setOrgForm({ name: org.name, short_name: org.short_name || '', description: org.description || '', logo_url: org.logo_url || '', website: org.website || '' }); setShowOrgForm(true); }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs font-medium hover:bg-amber-100 transition-colors">
                  <Building2 className="w-3 h-3" />
                  {org.name}{org.short_name ? ` (${org.short_name})` : ''}
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {positions.length} سمت — {units.length} واحد — {members.length} تخصیص
            </p>
          </div>
        </div>
        {activeTab !== 'settings' && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => { setEditingUnit(null); setShowUnitForm(true); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition-colors"
            >
              <Building2 className="w-4 h-4" />
              <span className="hidden sm:inline">واحد جدید</span>
              <span className="sm:hidden">واحد</span>
            </button>
            <button
              onClick={() => { setEditingPosition(null); setShowPositionForm(true); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">سمت جدید</span>
              <span className="sm:hidden">سمت</span>
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-2xl overflow-x-auto">
        {[
          { key: 'chart', label: 'نمودار', icon: Link2 },
          { key: 'list', label: 'فهرست سمت‌ها', icon: Briefcase },
          { key: 'units', label: 'واحدها', icon: Building2 },
          { key: 'permissions', label: 'دسترسی‌ها', icon: Shield },
          { key: 'settings', label: 'تنظیمات', icon: Settings },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${activeTab === tab.key ? 'bg-white dark:bg-gray-900 text-gray-800 dark:text-white shadow-xs' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            <tab.icon className="w-4 h-4 shrink-0" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Chart Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'chart' && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 sm:p-6 overflow-x-auto">
          {rootPositions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                <Building2 className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500 dark:text-gray-400 text-sm text-center">
                هنوز سمتی تعریف نشده است.<br />با کلیک روی «سمت جدید» شروع کنید.
              </p>
              <button
                onClick={() => { setEditingPosition(null); setShowPositionForm(true); }}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" /> افزودن اولین سمت
              </button>
            </div>
          ) : (
            <div className="min-w-max mx-auto pb-4">
              <div className="flex gap-12 items-start justify-center">
                {rootPositions.sort((a, b) => a.sort_order - b.sort_order).map(pos => (
                  <OrgChartNode
                    key={pos.id}
                    position={pos}
                    allMembers={members}
                    allPositions={positions}
                    units={units}
                    levelDefs={levelDefs}
                    depth={0}
                    onEdit={p => { setEditingPosition(p); setShowPositionForm(true); }}
                    onDelete={deletePosition}
                    onAddChild={parentId => {
                      const parent = positions.find(p => p.id === parentId);
                      setEditingPosition({ parent_position_id: parentId, level: Math.min(levelDefs.length, (parent?.level || 1) + 1) });
                      setShowPositionForm(true);
                    }}
                    onAssign={setAssigningPositionId}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── List Tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'list' && (
        <HierarchicalPositionList
          positions={positions}
          members={members}
          units={units}
          levelDefs={levelDefs}
          onEdit={pos => { setEditingPosition(pos); setShowPositionForm(true); }}
          onDelete={deletePosition}
          onAssign={setAssigningPositionId}
        />
      )}

      {/* ── Units Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'units' && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          {units.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">
              <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
              واحد سازمانی تعریف نشده است
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                  <tr>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">نام واحد</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 hidden sm:table-cell">کد</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 hidden md:table-cell">بالادستی</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">سمت‌ها</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {units.map(unit => {
                    const parent = units.find(u => u.id === unit.parent_id);
                    const unitPositions = positions.filter(p => p.unit_id === unit.id);
                    return (
                      <tr key={unit.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-800 dark:text-white">{unit.name}</td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          {unit.code ? <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs font-mono">{unit.code}</span> : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">{parent?.name || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{unitPositions.length} سمت</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => { setEditingUnit(unit); setShowUnitForm(true); }} className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => deleteUnit(unit.id)} className="p-1.5 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Permissions Tab ────────────────────────────────────────────────── */}
      {activeTab === 'permissions' && (
        <OrgPermissionsPanel positions={positions} levelDefs={levelDefs} />
      )}

      {/* ── Settings Tab ───────────────────────────────────────────────────── */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          <LevelManagerPanel levelDefs={levelDefs} onRefresh={fetchAll} />
          <HrSsoConfigPanel configs={hrSsoConfigs} onSave={saveHrSsoConfig} />
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showPositionForm && (
        <PositionFormModal
          initial={editingPosition}
          units={units}
          allPositions={positions}
          levelDefs={levelDefs}
          onSave={savePosition}
          onClose={() => { setShowPositionForm(false); setEditingPosition(null); }}
        />
      )}

      {showUnitForm && (
        <UnitFormModal
          initial={editingUnit}
          allUnits={units}
          onSave={saveUnit}
          onClose={() => { setShowUnitForm(false); setEditingUnit(null); }}
        />
      )}

      {assigningPosition && (
        <AssignUserModal
          position={assigningPosition}
          allProfiles={allProfiles}
          currentMembers={assigningMembers}
          levelDefs={levelDefs}
          onAssign={assignUser}
          onRemove={removeMember}
          onClose={() => setAssigningPositionId(null)}
          onRefreshProfiles={fetchAll}
        />
      )}
    </div>
  );
}
