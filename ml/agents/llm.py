"""One LLM client for the whole project: explainer, chat and the agents (Phase B).

Gemini (preferred) or OpenAI, chosen by which key is set, both through the OpenAI SDK: Gemini is
reached through its OpenAI-compatible endpoint, so the same messages and the same tool-calling
format work for both. Every call raises on failure; callers decide how to fall back, so the demo
never depends on the network. Check a key with `python -m ml.agents.llm`.

Fail fast: one attempt with a short timeout, and after any failure the LLM is paused for
COOLDOWN_S (available() is False), so explanations and chat use their offline template at once
instead of waiting on a provider that just failed. It is tried again after the pause.

Cost: Gemini's thinking tokens are billed as output, the expensive side. Every Gemini call asks
for a medium thinking level (`reasoning_effort`, override with GEMINI_REASONING_EFFORT; empty = the
model's default), and the short-text calls (explanation, chat) are capped at
SHORT_REPLY_MAX_TOKENS. A reply cut off by that cap comes back empty, so callers use their template.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Any

log = logging.getLogger(__name__)

PROVIDERS = (
    {
        "name": "gemini",
        "key_env": "GEMINI_API_KEY",
        "model_env": "GEMINI_MODEL",
        "default_model": "gemini-3.8-flash",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        # Mapped to Gemini's thinking_level. Some Gemini 3 models reject "medium" on this
        # endpoint; a rejected call pauses the LLM and callers use their template, so set
        # GEMINI_REASONING_EFFORT=low if the key check (`python -m ml.agents.llm`) fails.
        "effort_env": "GEMINI_REASONING_EFFORT",
        "default_effort": "medium",
    },
    {
        "name": "openai",
        "key_env": "OPENAI_API_KEY",
        "model_env": "OPENAI_MODEL",
        "default_model": "gpt-4o-mini",
        "base_url": None,  # the SDK's default
        # gpt-4o-mini is not a reasoning model and rejects reasoning_effort: never sent.
        "effort_env": None,
        "default_effort": None,
    },
)
# Output cap for the explanation (one sentence) and chat (<= 120 words), thinking included.
SHORT_REPLY_MAX_TOKENS = 1024
# A fast-model explanation takes 1-3 s; much slower is worse for the demo than the template.
TIMEOUT_S = 10.0
# The SDK retries twice by default, which tripled the wait on a stalled provider. One attempt only.
MAX_RETRIES = 0
# After a failure, skip the LLM for this long. 0.0 = not paused (time.monotonic() is always above).
COOLDOWN_S = 120.0
_cooldown_until = 0.0


def _paused() -> bool:
    return time.monotonic() < _cooldown_until


def provider() -> dict | None:
    """{name, api_key, model, base_url, effort} of the first provider whose key is set, else None.

    effort is the reasoning_effort to send, or None to send none.
    """
    for p in PROVIDERS:
        key = os.getenv(p["key_env"], "").strip()
        if key:
            model = os.getenv(p["model_env"], "").strip() or p["default_model"]
            effort = p["default_effort"]
            if p["effort_env"] is not None and p["effort_env"] in os.environ:
                effort = os.environ[p["effort_env"]].strip() or None  # empty = model default
            return {
                "name": p["name"],
                "api_key": key,
                "model": model,
                "base_url": p["base_url"],
                "effort": effort,
            }
    return None


def available() -> bool:
    """A key is set and the LLM isn't paused after a recent failure."""
    return provider() is not None and not _paused()


def complete(
    messages: list[dict], tools: list[dict] | None = None, max_tokens: int | None = None
) -> dict:
    """One chat completion: {"content": str, "tool_calls": [{id, name, arguments}], "truncated"}.

    `tools` are OpenAI-style function schemas (see ml.pipeline.tools.schemas()). Arguments come
    back already parsed from JSON. `max_tokens` caps the reply; truncated is True when the cap
    cut it off. Raises RuntimeError with no key, and any SDK error as is.
    """
    from openai import OpenAI  # imported here so the offline path never needs the SDK

    global _cooldown_until
    p = provider()
    if p is None:
        raise RuntimeError("llm.complete: no GEMINI_API_KEY or OPENAI_API_KEY is set")
    if _paused():
        raise RuntimeError("llm.complete: paused after a recent failure; using the fallback")
    client = OpenAI(
        api_key=p["api_key"], base_url=p["base_url"], timeout=TIMEOUT_S, max_retries=MAX_RETRIES
    )
    kwargs: dict[str, Any] = {"model": p["model"], "messages": messages}
    if tools:
        kwargs["tools"] = tools
    if p["effort"]:
        kwargs["reasoning_effort"] = p["effort"]
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    try:
        choice = client.chat.completions.create(**kwargs).choices[0]
        message = choice.message
    except Exception:
        _cooldown_until = time.monotonic() + COOLDOWN_S
        log.exception(
            "llm.complete failed (provider=%s, model=%s); pausing the LLM for %.0f s",
            p["name"],
            p["model"],
            COOLDOWN_S,
        )
        raise
    calls = []
    for call in getattr(message, "tool_calls", None) or []:
        try:
            arguments = json.loads(call.function.arguments or "{}")
        except json.JSONDecodeError:
            log.warning(
                "llm.complete: tool %s sent arguments that are not JSON", call.function.name
            )
            arguments = {}
        calls.append({"id": call.id, "name": call.function.name, "arguments": arguments})
    return {
        "content": (message.content or "").strip(),
        "tool_calls": calls,
        "truncated": getattr(choice, "finish_reason", None) == "length",
    }


def chat(system: str, user: str) -> str:
    """Plain question -> short text, for the explainer and the chat.

    Capped at SHORT_REPLY_MAX_TOKENS. A reply the cap cut off returns "" (logged), so the caller
    uses its template rather than half a sentence. That is not a provider failure: no pause.
    """
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    reply = complete(messages, max_tokens=SHORT_REPLY_MAX_TOKENS)
    if reply["truncated"]:
        log.warning(
            "llm.chat: reply cut off at %d tokens; using the template", SHORT_REPLY_MAX_TOKENS
        )
        return ""
    return reply["content"]


def main() -> int:
    """Check the configured key with one tiny call and say clearly what is wrong if it fails."""
    p = provider()
    if p is None:
        print("No GEMINI_API_KEY or OPENAI_API_KEY in the environment (load .env first).")
        return 1
    try:
        reply = chat("Reply with the single word: ok", "ping")
    except Exception as exc:  # noqa: BLE001 - this is a diagnostic: show any failure
        print(f"{p['name']} / {p['model']}: FAILED -> {type(exc).__name__}: {str(exc)[:300]}")
        return 1
    print(f"{p['name']} / {p['model']}: OK -> {reply!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
