import { useMemo, useState } from 'react';
import { ChevronLeft, ListChecks, Plus, Trash2 } from 'lucide-react';
import type { DraftAgendaItem, DraftDecision, OrgUnitOption, ProfileOption } from './types';
import { defaultDecision } from './defaults';
import { SelectField, TextareaField } from './fields';
import { PRIORITY_OPTIONS } from './options';
import { SearchableSelect } from './SearchableSelect';
import { JalaliDatePicker } from './JalaliDatePicker';
import { isDueBeforeStart } from '../../../lib/minutesDate';
import { formatClauseLabel, getDraftDecisionClauses, getParentDraftDecisions } from '../decisionHierarchy';

interface SectionDecisionsProps {
  decisions: DraftDecision[];
  setDecisions: React.Dispatch<React.SetStateAction<DraftDecision[]>>;
  profiles: ProfileOption[];
  profilesLoading: boolean;
  orgUnits: OrgUnitOption[];
  orgUnitsLoading: boolean;
  agendaItems: DraftAgendaItem[];
  externalParticipants: Array<{ id: string; participantId: string | null; fullName: string; organization: string; position: string; mobile?: string }>;
  readOnly?: boolean;
  onRemoveDecision?: (decisionId: string | null) => void;
}

type DecisionFieldValue = DraftDecision[keyof DraftDecision];

function copyExecutionFields(source: DraftDecision) {
  return {
    primaryOwnerUserId: source.primaryOwnerUserId,
    responsibleUnitId: source.responsibleUnitId,
    responsibleUnitNameSnapshot: source.responsibleUnitNameSnapshot,
    priority: source.priority,
    startDate: source.startDate,
    dueDate: source.dueDate,
    requiresFollowup: source.requiresFollowup,
    latestUpdate: source.latestUpdate,
    responsiblePartyType: source.responsiblePartyType,
    externalResponsibleParticipantId: source.externalResponsibleParticipantId,
    externalResponsibleNameSnapshot: source.externalResponsibleNameSnapshot,
    externalResponsibleOrganizationSnapshot: source.externalResponsibleOrganizationSnapshot,
    externalResponsiblePositionSnapshot: source.externalResponsiblePositionSnapshot,
  } satisfies Partial<DraftDecision>;
}

export function SectionDecisions({
  decisions, setDecisions,
  profiles, profilesLoading,
  orgUnits, orgUnitsLoading,
  agendaItems,
  externalParticipants,
  readOnly,
  onRemoveDecision,
}: SectionDecisionsProps) {
  const [openDecisionId, setOpenDecisionId] = useState<string | null>(null);
  const [agendaPickerOpenId, setAgendaPickerOpenId] = useState<string | null>(null);

  const parents = useMemo(() => getParentDraftDecisions(decisions), [decisions]);

  const update = (id: string, field: keyof DraftDecision, value: DecisionFieldValue) =>
    setDecisions(list => list.map(row => (row.id === id ? { ...row, [field]: value } : row)));

  const addIndependent = () => {
    const newDecision = defaultDecision();
    setDecisions(list => [...list, newDecision]);
    setOpenDecisionId(newDecision.id);
  };

  const addClause = (parent: DraftDecision) => {
    if (!parent.decisionId) return;
    const siblings = getDraftDecisionClauses(decisions, parent.decisionId);
    const clause: DraftDecision = {
      ...defaultDecision(),
      parentDecisionId: parent.decisionId,
      clauseOrder: siblings.length + 1,
      meetingAgendaItemId: parent.meetingAgendaItemId,
      agendaResultId: parent.agendaResultId,
      ...(siblings.length === 0 ? copyExecutionFields(parent) : {}),
    };
    setDecisions(list => [...list, clause]);
  };

  const removeParent = (parent: DraftDecision) => {
    const children = getDraftDecisionClauses(decisions, parent.decisionId);
    if (onRemoveDecision) {
      for (const row of [parent, ...children]) {
        if (row.decisionId) onRemoveDecision(row.decisionId);
      }
    }
    const ids = new Set([parent.id, ...children.map(child => child.id)]);
    setDecisions(list => list.filter(row => !ids.has(row.id)));
    if (openDecisionId === parent.id) setOpenDecisionId(null);
    if (agendaPickerOpenId === parent.id) setAgendaPickerOpenId(null);
  };

  const removeClause = (parent: DraftDecision, clause: DraftDecision) => {
    const siblings = getDraftDecisionClauses(decisions, parent.decisionId);
    if (clause.decisionId && onRemoveDecision) onRemoveDecision(clause.decisionId);
    setDecisions(list => {
      const withoutClause = list.filter(row => row.id !== clause.id);
      const remaining = siblings.filter(row => row.id !== clause.id);
      return withoutClause.map(row => {
        if (row.id === parent.id && remaining.length === 0) {
          return { ...row, ...copyExecutionFields(clause) };
        }
        if (row.parentDecisionId === parent.decisionId) {
          const newOrder = remaining.findIndex(item => item.id === row.id) + 1;
          return newOrder > 0 ? { ...row, clauseOrder: newOrder } : row;
        }
        return row;
      });
    });
  };

  const usersDisabled = profilesLoading || profiles.length === 0 || !!readOnly;
  const orgUnitsDisabled = orgUnitsLoading || !!readOnly;
  const profileLabel = (profile: ProfileOption) => profile.full_name || profile.username || profile.user_id;
  const ownerOptions = profiles.map(profile => ({
    value: profile.user_id,
    label: profileLabel(profile),
    sublabel: profile.position || undefined,
  }));

  const dateErrors = useMemo(() => {
    const errors: Record<string, { due?: string }> = {};
    for (const decision of decisions) {
      if (decision.startDate && decision.dueDate && isDueBeforeStart(decision.startDate, decision.dueDate)) {
        errors[decision.id] = { due: 'مهلت انجام نمی‌تواند قبل از تاریخ شروع باشد.' };
      }
    }
    return errors;
  }, [decisions]);

  const buildResponsibleUnitOptions = (item: DraftDecision) => {
    const options = orgUnits.map(unit => ({ value: unit.id, label: unit.name }));
    if (item.responsibleUnitId && !orgUnits.some(unit => unit.id === item.responsibleUnitId)) {
      options.push({ value: item.responsibleUnitId, label: item.responsibleUnitNameSnapshot || 'واحد حذفشده' });
    }
    return options;
  };

  const availableAgendaItems = agendaItems.filter(item => item.title.trim());

  const renderExecutionFields = (item: DraftDecision, prefix: string) => (
    <>
      <div className="sm:col-span-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نوع مسئول</label>
        <select
          value={item.responsiblePartyType}
          onChange={event => {
            const newType = event.target.value as 'internal' | 'external';
            update(item.id, 'responsiblePartyType', newType);
            if (newType === 'internal') {
              update(item.id, 'externalResponsibleParticipantId', null);
              update(item.id, 'externalResponsibleNameSnapshot', '');
              update(item.id, 'externalResponsibleOrganizationSnapshot', '');
              update(item.id, 'externalResponsiblePositionSnapshot', '');
            } else {
              update(item.id, 'primaryOwnerUserId', '');
            }
          }}
          disabled={!!readOnly}
          className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-60"
        >
          <option value="internal">داخل سازمان</option>
          <option value="external">خارج سازمان</option>
        </select>
      </div>

      {item.responsiblePartyType === 'internal' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">واحد مسئول</label>
          {orgUnitsDisabled && orgUnits.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-gray-400 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700">در حال بارگذاری...</div>
          ) : (
            <SearchableSelect
              id={`${prefix}-unit-${item.id}`}
              value={item.responsibleUnitId || ''}
              options={buildResponsibleUnitOptions(item)}
              onChange={value => {
                const unitId = value || null;
                const unit = orgUnits.find(candidate => candidate.id === unitId);
                update(item.id, 'responsibleUnitId', unitId);
                update(item.id, 'responsibleUnitNameSnapshot', unit?.name || '');
              }}
              placeholder="— بدون واحد —"
              searchPlaceholder="جستجوی واحد سازمانی..."
              emptyText="واحدی یافت نشد"
              disabled={!!readOnly}
            />
          )}
        </div>
      )}

      {item.responsiblePartyType === 'internal' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            مسئول <span className="text-red-500">*</span>
          </label>
          {usersDisabled ? (
            <div className="px-3 py-2.5 text-sm text-gray-400 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700">در حال بارگذاری...</div>
          ) : (
            <SearchableSelect
              id={`${prefix}-owner-${item.id}`}
              value={item.primaryOwnerUserId}
              options={ownerOptions}
              onChange={value => update(item.id, 'primaryOwnerUserId', value)}
              placeholder="انتخاب مسئول"
              searchPlaceholder="جستجو بر اساس نام یا سمت..."
              emptyText="کاربری یافت نشد"
              disabled={!!readOnly}
            />
          )}
        </div>
      )}

      {item.responsiblePartyType === 'external' && (
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            مسئول خارج سازمان <span className="text-red-500">*</span>
          </label>
          {externalParticipants.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-gray-400 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700">
              شرکت‌کننده خارج سازمانی برای این صورت‌جلسه ثبت نشده است.
            </div>
          ) : (
            <SearchableSelect
              id={`${prefix}-ext-owner-${item.id}`}
              value={item.externalResponsibleParticipantId || ''}
              options={externalParticipants.map(participant => ({
                value: participant.participantId ?? '',
                label: participant.fullName,
                sublabel: [participant.organization, participant.position, participant.mobile].filter(Boolean).join(' — '),
              }))}
              onChange={value => {
                const participant = externalParticipants.find(candidate => candidate.participantId === value);
                update(item.id, 'externalResponsibleParticipantId', value || null);
                update(item.id, 'externalResponsibleNameSnapshot', participant?.fullName || '');
                update(item.id, 'externalResponsibleOrganizationSnapshot', participant?.organization || '');
                update(item.id, 'externalResponsiblePositionSnapshot', participant?.position || '');
              }}
              placeholder="انتخاب از شرکت‌کنندگان خارج سازمان"
              searchPlaceholder="جستجو بر اساس نام..."
              emptyText="شخصی یافت نشد"
              disabled={!!readOnly}
            />
          )}
          {item.externalResponsibleNameSnapshot && !externalParticipants.some(participant => participant.participantId === item.externalResponsibleParticipantId) && (
            <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              فرد خارجی ثبت‌شده: {item.externalResponsibleNameSnapshot}
              {item.externalResponsibleOrganizationSnapshot ? ` — ${item.externalResponsibleOrganizationSnapshot}` : ''}
            </div>
          )}
        </div>
      )}

      <div>
        <label htmlFor={`${prefix}-start-${item.id}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تاریخ شروع</label>
        <JalaliDatePicker
          id={`${prefix}-start-${item.id}`}
          value={item.startDate || null}
          onChange={value => update(item.id, 'startDate', value ?? '')}
          disabled={!!readOnly}
          placeholder="انتخاب تاریخ شروع"
        />
      </div>
      <div>
        <label htmlFor={`${prefix}-due-${item.id}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">مهلت انجام</label>
        <JalaliDatePicker
          id={`${prefix}-due-${item.id}`}
          value={item.dueDate || null}
          onChange={value => update(item.id, 'dueDate', value ?? '')}
          disabled={!!readOnly}
          minDate={item.startDate || null}
          placeholder="انتخاب مهلت انجام"
          error={dateErrors[item.id]?.due}
        />
      </div>
      <SelectField
        id={`${prefix}-priority-${item.id}`}
        label="اولویت"
        options={PRIORITY_OPTIONS}
        value={item.priority}
        onChange={value => update(item.id, 'priority', value)}
        disabled={!!readOnly}
      />
      <div className="sm:col-span-2 flex items-center gap-3">
        <label htmlFor={`${prefix}-followup-${item.id}`} className="flex items-center gap-2 cursor-pointer select-none">
          <input
            id={`${prefix}-followup-${item.id}`}
            type="checkbox"
            checked={item.requiresFollowup}
            onChange={event => update(item.id, 'requiresFollowup', event.target.checked)}
            disabled={!!readOnly}
            className="w-4 h-4 rounded accent-blue-600 disabled:opacity-60"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">نیازمند پیگیری</span>
        </label>
      </div>
    </>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">مصوبات</h2>
        {!readOnly && (
          <button type="button" onClick={addIndependent} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> افزودن مصوبه
          </button>
        )}
      </div>

      {readOnly && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 rounded-xl p-3 text-sm text-blue-700 dark:text-blue-400">
          این صورت‌جلسه در وضعیت قابل ویرایش نیست؛ بخش مصوبات فقط خواندنی است.
        </div>
      )}

      {parents.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
          هیچ مصوبه‌ای ثبت نشده است. {!readOnly && 'برای افزودن روی «افزودن مصوبه» کلیک کنید.'}
        </div>
      )}

      {parents.map((item, index) => {
        const isOpen = openDecisionId === item.id;
        const isAgendaPickerOpen = agendaPickerOpenId === item.id;
        const clauses = getDraftDecisionClauses(decisions, item.decisionId);
        return (
          <div key={item.id} className="border border-gray-200 dark:border-gray-600 rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenDecisionId(isOpen ? null : item.id)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-right"
            >
              <ChevronLeft className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? '-rotate-90' : ''}`} />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">مصوبه {index + 1}</span>
              {item.title && <span className="text-sm text-gray-500 dark:text-gray-400 truncate flex-1 text-right">— {item.title}</span>}
              {clauses.length > 0 && <span className="text-xs text-blue-600 dark:text-blue-400">{clauses.length.toLocaleString('fa-IR')} بند</span>}
              <div className="flex-1" />
              {!readOnly && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={event => { event.stopPropagation(); removeParent(item); }}
                  onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); removeParent(item); } }}
                  className="p-1 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  aria-label="حذف مصوبه"
                >
                  <Trash2 className="w-4 h-4" />
                </span>
              )}
            </button>

            {isOpen && (
              <div className="p-4 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">عنوان مصوبه</label>
                    <div className="flex items-center gap-1">
                      <input
                        id={`dec-title-${item.id}`}
                        type="text"
                        placeholder="عنوان مصوبه را وارد کنید"
                        value={item.title}
                        onChange={event => update(item.id, 'title', event.target.value)}
                        disabled={!!readOnly}
                        className="flex-1 px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white disabled:opacity-60"
                      />
                      {!readOnly && availableAgendaItems.length > 0 && (
                        <div className="relative">
                          <button type="button" title="انتخاب عنوان از دستور جلسات" onClick={() => setAgendaPickerOpenId(isAgendaPickerOpen ? null : item.id)} className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                            <ListChecks className="w-4 h-4" />
                          </button>
                          {isAgendaPickerOpen && (
                            <div className="absolute left-0 top-full mt-1 z-50 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg overflow-hidden">
                              <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">انتخاب عنوان از دستور جلسات</div>
                              <ul className="max-h-48 overflow-y-auto divide-y divide-gray-50 dark:divide-gray-700">
                                {availableAgendaItems.map((agenda, agendaIndex) => (
                                  <li key={agenda.id}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        update(item.id, 'title', agenda.title);
                                        update(item.id, 'meetingAgendaItemId', agenda.meetingAgendaItemId || null);
                                        setAgendaPickerOpenId(null);
                                      }}
                                      className="w-full text-right px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                                    >
                                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">{agendaIndex + 1}.</span>{agenda.title}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <TextareaField id={`dec-desc-${item.id}`} label="متن مصوبه" rows={3} value={item.description} onChange={value => update(item.id, 'description', value)} />
                  </div>

                  {clauses.length === 0 ? renderExecutionFields(item, 'dec') : (
                    <div className="sm:col-span-2 rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
                      این مصوبه دارای بند اجرایی است؛ مسئول، واحد، زمان‌بندی، اولویت و وضعیت اجرایی در سطح بندها مدیریت می‌شود.
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">بندهای اجرایی</h3>
                      <p className="mt-0.5 text-xs text-gray-400">هر بند مسئول و زمان‌بندی مستقل دارد و در شمارش مصوبات، مصوبه جداگانه محسوب نمی‌شود.</p>
                    </div>
                    {!readOnly && (
                      <button type="button" onClick={() => addClause(item)} className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/20">
                        <Plus className="w-3.5 h-3.5" /> افزودن بند
                      </button>
                    )}
                  </div>

                  {clauses.map(clause => (
                    <div key={clause.id} className="rounded-xl border border-gray-200 bg-gray-50/50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatClauseLabel(clause.clauseOrder)}</span>
                        {!readOnly && (
                          <button type="button" onClick={() => removeClause(item, clause)} className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20" aria-label="حذف بند">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">متن بند <span className="text-red-500">*</span></label>
                          <textarea
                            value={clause.title}
                            onChange={event => update(clause.id, 'title', event.target.value)}
                            disabled={!!readOnly}
                            rows={3}
                            placeholder="متن بند اجرایی را وارد کنید"
                            className="w-full resize-y rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-gray-600 dark:bg-gray-700 dark:text-white disabled:opacity-60"
                          />
                        </div>
                        {renderExecutionFields(clause, 'clause')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
