class WorkflowError(RuntimeError):
    """Base workflow error."""


class DuplicateOperationError(WorkflowError):
    pass


class UnknownDependencyError(WorkflowError):
    pass


class DependencyCycleError(WorkflowError):
    pass
