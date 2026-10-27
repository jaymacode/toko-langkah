"""Typed errors for the assistant. Messages never include connection details or model output."""

from __future__ import annotations


class AssistantError(Exception):
    """Base class for assistant errors."""


class QueryParseError(AssistantError):
    """The user query cannot be parsed (wrong type or too long)."""


class StoreUnavailable(AssistantError):
    """The database could not answer. Callers must show a recoverable error, never a guess."""


class ToolRejected(AssistantError):
    """A tool call was refused before execution: unknown tool, invalid or extra arguments."""


class ToolBudgetExceeded(AssistantError):
    """The turn already used MAX_TOOL_CALLS tool executions."""


class AssistantUnavailable(AssistantError):
    """The turn cannot be answered now (provider timeout, rate limit, invalid output, no provider).

    `reason` is a short fixed label, safe to log. It is never shown with provider text.
    """

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason
