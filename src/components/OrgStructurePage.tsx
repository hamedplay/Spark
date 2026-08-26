import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, CreditCard as Edit2, Building2, Link2, Briefcase, Shield, Settings } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import type { OrgUnit, OrgPosition, PositionMember, Profile, LevelDef, HrSsoConfig, OrgOrganization } from './OrgStructure/types';
import { DEFAULT_LEVELS } from './OrgStructure/utils';
import { OrgChartNode } from './OrgStructure/OrgChartNode';
import { PositionFormModal } from './OrgStructure/PositionFormModal';
import { AssignUserModal } from './OrgStructure/AssignUserModal';
import { UnitFormModal } from './OrgStructure/UnitFormModal';
import { LevelManagerPanel } from './OrgStructure/LevelManagerPanel';
import { HrSsoConfigPanel } from './OrgStructure/HrSsoConfigPanel';
import { HierarchicalPositionList } from './OrgStructure/HierarchicalPositionList';
import { OrgPermissionsPanel } from './OrgStructure/OrgPermissionsPanel';
import { OrgFormModal, type OrgFormState } from './OrgStructure/OrgFormModal';
import { usePermissions } from '../context/PermissionsContext';

export function OrgStructurePage() {
  const { hasPermission } = usePermissions();
  const canManagePermissions = hasPermission('config_users.org_structure.permissions');
  const [org, setOrg] = useState<OrgOrganization | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [showOrgForm, setShowOrgForm] = useState(false);
  const [orgForm, setOrgForm] = useState<OrgFormState>({ name: '', short_name: '', description: '', logo_url: '', website: '' });
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
      <OrgFormModal
        org={org}
        form={orgForm}
        setForm={setOrgForm}
        saving={orgSaving}
        onSave={saveOrg}
        onClose={() => setShowOrgForm(false)}
      />
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
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
        ].filter(tab => tab.key !== 'permissions' || canManagePermissions).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${activeTab === tab.key ? 'bg-white dark:bg-gray-900 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            <tab.icon className="w-4 h-4 flex-shrink-0" />
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
      {activeTab === 'permissions' && canManagePermissions && (
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
