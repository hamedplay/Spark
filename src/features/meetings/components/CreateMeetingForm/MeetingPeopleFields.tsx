import { Users, Bell } from 'lucide-react';
import {
  MultiSelectField,
  type MultiSelectGroup,
  type MultiSelectValue,
} from './MultiSelectField';

export interface MeetingPeopleFieldsProps {
  groups: MultiSelectGroup[];

  participants: MultiSelectValue[];
  notifyUsers: MultiSelectValue[];

  onParticipantsChange: (participants: MultiSelectValue[]) => void;
  onNotifyUsersChange: (users: MultiSelectValue[]) => void;
}

export function MeetingPeopleFields({
  groups,
  participants,
  notifyUsers,
  onParticipantsChange,
  onNotifyUsersChange,
}: MeetingPeopleFieldsProps) {
  return (
    <>
      {/* Participants */}
      <div className="mt-6">
        <MultiSelectField
          label="شرکت‌کنندگان جلسه"
          icon={<Users className="w-4 h-4" />}
          placeholder="جستجوی کاربران سامانه..."
          options={[]}
          groups={groups}
          selected={participants}
          onAdd={(item) => onParticipantsChange([...participants, item])}
          onRemove={(id) => onParticipantsChange(participants.filter((item) => item.id !== id))}
          tagColor="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
        />
      </div>

      {/* Notify Users */}
      <div className="mt-5">
        <MultiSelectField
          label="مطلعین جلسه"
          icon={<Bell className="w-4 h-4" />}
          placeholder="جستجوی کاربران برای اطلاع‌رسانی..."
          options={[]}
          groups={groups}
          selected={notifyUsers}
          onAdd={(item) => onNotifyUsersChange([...notifyUsers, item])}
          onRemove={(id) => onNotifyUsersChange(notifyUsers.filter((item) => item.id !== id))}
          tagColor="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
        />
      </div>
    </>
  );
}
