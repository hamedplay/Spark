from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}')
    target.write_text(text.replace(old, new, 1))


replace_once(
    'src/components/Tasks/TasksWorkspaceChrome.tsx',
    "  onInProgress: () => void;\n  onCompleted: () => void;",
    "  onInProgress: () => void;\n  onOverdue: () => void;\n  onCompleted: () => void;",
)

replace_once(
    'src/components/Tasks/TasksWorkspaceChrome.tsx',
    '''      <div className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/10 p-4">\n        <div className="flex items-center justify-between"><span className="text-sm text-gray-500">سررسید گذشته</span><AlertTriangle className="w-4 h-4 text-red-500" /></div>\n        <div className="text-2xl font-bold mt-2 dark:text-white">{props.overdue}</div>\n      </div>''',
    '''      <button onClick={props.onOverdue} className="text-right rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/10 p-4">\n        <div className="flex items-center justify-between"><span className="text-sm text-gray-500">سررسید گذشته</span><AlertTriangle className="w-4 h-4 text-red-500" /></div>\n        <div className="text-2xl font-bold mt-2 dark:text-white">{props.overdue}</div>\n      </button>''',
)

replace_once(
    'src/components/Tasks/taskPageSelectors.ts',
    "    const matchesStatus = statusFilter === 'all' ||\n      (statusFilter === 'archived' ? task.archived : task.status === statusFilter && !task.archived);",
    "    const matchesStatus = statusFilter === 'all'\n      ? !task.archived\n      : statusFilter === 'archived'\n        ? task.archived\n        : statusFilter === 'completed'\n          ? task.status === 'completed'\n          : task.status === statusFilter && !task.archived;",
)

replace_once(
    'src/components/TasksPage.tsx',
    '''      <TaskMetricCards\n        assignedToMe={counters.assignedToMe}\n        inProgress={counters.inProgress}\n        overdue={counters.overdue}\n        completed={counters.completed}\n        onAssignedToMe={() => { clearExternalFilter(); setTaskTab('assigned_to_me'); setStatusFilter('all'); }}\n        onInProgress={() => { clearExternalFilter(); setTaskTab('all'); setStatusFilter('in_progress'); }}\n        onCompleted={() => { setFocusTaskId(null); setDashboardTaskView('completed'); setTaskTab('all'); setStatusFilter('all'); }}\n      />''',
    '''      <TaskMetricCards\n        assignedToMe={counters.assignedToMe}\n        inProgress={counters.inProgress}\n        overdue={counters.overdue}\n        completed={counters.completed}\n        onAssignedToMe={() => {\n          clearExternalFilter();\n          setSearchTerm('');\n          setPersonalProjectFilter('all');\n          setTaskTab('assigned_to_me');\n          setStatusFilter('all');\n        }}\n        onInProgress={() => {\n          clearExternalFilter();\n          setSearchTerm('');\n          setPersonalProjectFilter('all');\n          setTaskTab('all');\n          setStatusFilter('in_progress');\n        }}\n        onOverdue={() => {\n          setFocusTaskId(null);\n          setDashboardTaskView('overdue');\n          setSearchTerm('');\n          setPersonalProjectFilter('all');\n          setTaskTab('all');\n          setStatusFilter('all');\n        }}\n        onCompleted={() => {\n          setFocusTaskId(null);\n          setDashboardTaskView('completed');\n          setSearchTerm('');\n          setPersonalProjectFilter('all');\n          setTaskTab('all');\n          setStatusFilter('all');\n        }}\n      />''',
)
