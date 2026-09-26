from __future__ import annotations

from architecture.controller import run_action


def handle_architecture_action(ui, action_id: str) -> None:
    result = run_action(action_id)
    ui.modal_text(result.title, list(result.lines))
    ui.last_task_status = "SUCCESS" if result.success else "FAILED"
    ui.message = f"{result.title}: {ui.last_task_status}"
    ui.dirty = True
