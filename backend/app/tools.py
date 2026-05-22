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
        "Open a URL in the user's default web browser. Use this when "
        "the user asks to visit a website, open a search, or pull up "
        "any web page. Only http:// and https:// URLs are accepted; "
        "other schemes (file://, javascript:, etc.) are rejected by "
        "the executor for safety."
    ),
    parameters=genai.protos.Schema(
        type=genai.protos.Type.OBJECT,
        properties={
            "url": genai.protos.Schema(
                type=genai.protos.Type.STRING,
                description=(
                    "The full URL to open. Must start with http:// or "
                    "https://. Example: https://youtube.com"
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
