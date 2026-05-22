"""
Tool declarations for Gemini function calling.

Each FunctionDeclaration in TOOL_DECLARATIONS is the *schema* that
Gemini sees at request time — the model uses these to decide when
and how to call a tool. The *execution* of every tool lives in
electron/tools/, never in this container. The backend's only job is
to declare the schema, forward function_call frames to the renderer
over the existing /chat/ws WebSocket, and pipe each result back to
Gemini in the next message.

Adding a tool:
  1. Append a FunctionDeclaration here (schema only).
  2. Implement electron/tools/<name>.js.
  3. Register it in electron/tools/index.js.
"""

from __future__ import annotations

import google.generativeai as genai


# ---- declarations -----------------------------------------------------------

OPEN_URL = genai.protos.FunctionDeclaration(
    name="open_url",
    description=(
        "Open a URL in the user's default web browser. Use this "
        "whenever the user asks to visit, pull up, launch, or go to "
        "any website, search, video, channel, or article.\n\n"
        "If the user names a site by brand or short name (e.g. "
        "'twitch', 'github', 'reddit', 'twitter', 'amazon', 'gmail'), "
        "you are responsible for constructing the canonical URL "
        "yourself — do NOT ask the user for a full URL. Examples:\n"
        "  twitch  -> https://twitch.tv\n"
        "  github  -> https://github.com\n"
        "  reddit  -> https://reddit.com\n"
        "  gmail   -> https://mail.google.com\n"
        "  youtube -> https://youtube.com\n\n"
        "For 'open <site> <something>' (e.g. 'open github microsoft'), "
        "navigate to the most likely page (https://github.com/microsoft). "
        "When in doubt, prefer a working search URL on that site over "
        "asking for clarification.\n\n"
        "Only http:// and https:// URLs are accepted; other schemes "
        "(file://, javascript:, etc.) are rejected by the executor."
    ),
    parameters=genai.protos.Schema(
        type=genai.protos.Type.OBJECT,
        properties={
            "url": genai.protos.Schema(
                type=genai.protos.Type.STRING,
                description=(
                    "Full canonical URL starting with http:// or "
                    "https://. The model constructs this from the "
                    "user's request — never pass a bare brand name."
                ),
            ),
        },
        required=["url"],
    ),
)


TOOL_DECLARATIONS = [OPEN_URL]


# Single Tool wrapper passed to GenerativeModel(tools=[...]). One
# Tool can group multiple FunctionDeclarations; we keep them all
# under one Tool entry until we have a reason to partition them.

TOOL = genai.protos.Tool(function_declarations=TOOL_DECLARATIONS)
