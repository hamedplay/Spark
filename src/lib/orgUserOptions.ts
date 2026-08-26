import type { OrgUnitGroup } from './useOrgUsers';

export function mapOrgGroupsToMultiSelectGroups(groups: OrgUnitGroup[]) {
  return groups.map(group => ({
    label: group.unit_name,
    options: group.users.map(user => {
      const subtitles: string[] = [];
      if (user.position_title) subtitles.push(user.position_title);
      const otherAssignments = user.assignments.filter(assignment => assignment.positionTitle && assignment.positionTitle !== user.position_title);
      if (otherAssignments.length) subtitles.push(otherAssignments.map(assignment => assignment.positionTitle).join('، '));
      return { id: user.user_id, name: user.full_name || '', sub: subtitles.join(' · ') };
    }),
  }));
}
