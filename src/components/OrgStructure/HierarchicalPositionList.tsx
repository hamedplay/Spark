import { useState } from 'react';
import { Trash2, CreditCard as Edit2, ChevronDown, ChevronRight, ChevronUp, Users, UserCheck } from 'lucide-react';
import type { OrgPosition, PositionMember, OrgUnit, LevelDef } from './types';
import { getLevelInfo } from './utils';

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
              <button onClick={() => setExpanded(v => !v)} className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0">
                {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            ) : (
              <span className="w-5 flex-shrink-0" />
            )}
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
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

export { HierarchicalPositionList };
