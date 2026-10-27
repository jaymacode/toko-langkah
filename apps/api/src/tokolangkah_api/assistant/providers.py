"""Build the configured planner. The rules planner needs nothing; openai needs the key and model."""

from __future__ import annotations

from decimal import Decimal
from typing import cast

import openai

from tokolangkah_api.assistant.errors import AssistantUnavailable
from tokolangkah_api.assistant.openai_planner import CALL_TIMEOUT_SECONDS, ChatLike, OpenAIPlanner
from tokolangkah_api.assistant.planner import Planner
from tokolangkah_api.assistant.rules_planner import RulesPlanner
from tokolangkah_api.assistant.spend import DbSpendLedger, Source, SpendPolicy, UnavailableLedger
from tokolangkah_api.settings import AssistantProvider, Settings


def build_planner(settings: Settings, *, source: Source = "chat") -> Planner:
    """Return the planner for the explicit provider. Raises AssistantUnavailable if none is set.

    `source` labels the spend ledger rows: "chat" for customer turns, "eval" for live evals.
    """
    provider = settings.assistant_provider
    if provider is None:
        raise AssistantUnavailable("no_provider")
    if provider is AssistantProvider.RULES:
        return RulesPlanner()
    api_key = settings.openai_api_key
    model = settings.openai_model
    if api_key is None or model is None:
        raise AssistantUnavailable("provider_not_configured")
    # SDK retries are off: the planner owns the bounded retry policy and the deadline.
    client = openai.OpenAI(
        api_key=api_key.get_secret_value(),
        max_retries=0,
        timeout=CALL_TIMEOUT_SECONDS,
    )
    url = settings.request_database_url()
    # Without a database the ledger cannot be read, so the guard refuses every call (fail closed).
    ledger = DbSpendLedger(url.get_secret_value()) if url is not None else UnavailableLedger()
    spend = SpendPolicy(
        source=source,
        ledger=ledger,
        budget_usd=Decimal(str(settings.live_eval_budget_usd)),
        price_input_per_mtok=settings.openai_price_input_per_mtok,
        price_output_per_mtok=settings.openai_price_output_per_mtok,
        max_output_tokens=settings.openai_max_output_tokens,
    )
    return OpenAIPlanner(cast(ChatLike, client), model=model, spend=spend)
