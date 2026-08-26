import { useState } from 'react';
import { Plus, Trash2, CreditCard as Edit2, ChevronDown, ChevronRight, Building2 } from 'lucide-react';
import type { OrgPosition, PositionMember, OrgUnit, LevelDef } from './types';
import { getLevelInfo } from './utils';

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
                      <img src={m.profile.avatar_url} className="w-5 h-5 rounded-full object-cover flex-shrink-0" alt="" />
                    ) : (
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                        style={{ backgroundColor: color }}
                      >
                        {(m.profile?.full_name || 'U').charAt(0)}
                      </div>
                    )}
                    <span className="text-[11px] text-gray-700 dark:text-gray-200 truncate flex-1 font-medium">
                      {m.profile?.full_name || m.profile?.email || 'کاربر'}
                    </span>
                    {m.is_primary && (
                      <span className="text-[9px] text-amber-500 font-bold flex-shrink-0">★</span>
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

export { OrgChartNode };
