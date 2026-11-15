"""ML-10: the shared LLM client fails fast, so a broken provider never slows the demo down.

No real key or network: openai.OpenAI is replaced by a fake that records how it was built.
"""

import pytest

from ml.agents import llm


class _FakeClient:
    """Stands in for openai.OpenAI; `fail` makes every completion raise."""

    built: list[dict] = []
    sent: list[dict] = []  # the arguments of every completion request
    fail = False
    finish_reason = "stop"

    def __init__(self, **kwargs):
        _FakeClient.built.append(kwargs)
        self.chat = self
        self.completions = self

    def create(self, **kwargs):
        _FakeClient.sent.append(kwargs)
        if _FakeClient.fail:
            raise TimeoutError("synthetic provider timeout")
        message = type("Message", (), {"content": "ok", "tool_calls": None})()
        choice = type(
            "Choice", (), {"message": message, "finish_reason": _FakeClient.finish_reason}
        )
        return type("Reply", (), {"choices": [choice()]})()


@pytest.fixture(autouse=True)
def fake_provider(monkeypatch):
    import openai

    _FakeClient.built, _FakeClient.sent, _FakeClient.fail = [], [], False
    _FakeClient.finish_reason = "stop"
    monkeypatch.setattr(openai, "OpenAI", _FakeClient)
    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-test-key")
    monkeypatch.delenv("GEMINI_REASONING_EFFORT", raising=False)
    monkeypatch.setattr(llm, "_cooldown_until", 0.0)


def test_client_has_a_short_timeout_and_no_automatic_retries() -> None:
    assert llm.chat("system", "user") == "ok"
    built = _FakeClient.built[-1]
    assert built["max_retries"] == 0  # the SDK default (2) tripled the wait on a stalled provider
    assert built["timeout"] == llm.TIMEOUT_S <= 10


def test_a_failure_pauses_the_llm_so_callers_use_their_template_at_once(monkeypatch) -> None:
    clock = [1000.0]
    monkeypatch.setattr(llm.time, "monotonic", lambda: clock[0])
    _FakeClient.fail = True
    with pytest.raises(TimeoutError):
        llm.chat("system", "user")
    assert llm.available() is False  # rag.py and the agents check this and use the template
    built = len(_FakeClient.built)
    with pytest.raises(RuntimeError, match="paused"):
        llm.chat("system", "user")
    assert len(_FakeClient.built) == built  # no new request while paused


def test_the_llm_is_tried_again_after_the_pause(monkeypatch) -> None:
    clock = [1000.0]
    monkeypatch.setattr(llm.time, "monotonic", lambda: clock[0])
    _FakeClient.fail = True
    with pytest.raises(TimeoutError):
        llm.chat("system", "user")
    clock[0] += llm.COOLDOWN_S
    _FakeClient.fail = False
    assert llm.available() is True
    assert llm.chat("system", "user") == "ok"


def test_gemini_asks_for_medium_thinking_and_short_replies_are_capped() -> None:
    llm.chat("system", "user")
    sent = _FakeClient.sent[-1]
    assert sent["reasoning_effort"] == "medium"  # thinking tokens are billed as output
    assert sent["max_tokens"] == llm.SHORT_REPLY_MAX_TOKENS


def test_agent_calls_get_medium_thinking_but_no_output_cap() -> None:
    llm.complete([{"role": "user", "content": "plan"}], tools=[])
    sent = _FakeClient.sent[-1]
    assert sent["reasoning_effort"] == "medium" and "max_tokens" not in sent


def test_reasoning_effort_can_be_changed_or_left_to_the_model(monkeypatch) -> None:
    monkeypatch.setenv("GEMINI_REASONING_EFFORT", "high")
    llm.chat("system", "user")
    assert _FakeClient.sent[-1]["reasoning_effort"] == "high"
    monkeypatch.setenv("GEMINI_REASONING_EFFORT", "")
    llm.chat("system", "user")
    assert "reasoning_effort" not in _FakeClient.sent[-1]


def test_openai_never_gets_reasoning_effort(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY")
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-test-key")
    llm.chat("system", "user")
    assert "reasoning_effort" not in _FakeClient.sent[-1]  # gpt-4o-mini rejects it


def test_a_reply_cut_off_by_the_cap_is_empty_so_callers_use_the_template() -> None:
    _FakeClient.finish_reason = "length"
    assert llm.chat("system", "user") == ""
    assert llm.available() is True  # a long reply is not a provider failure: no pause


def test_without_a_key_nothing_changes(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert llm.available() is False
    with pytest.raises(RuntimeError, match="no GEMINI_API_KEY"):
        llm.chat("system", "user")
