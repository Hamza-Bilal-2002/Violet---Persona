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


OPEN_APP = genai.protos.FunctionDeclaration(
    name="open_app",
    description=(
        "Open a desktop application on the user's PC by name. Use "
        "this when the user asks to launch, start, or open any app "
        "installed on their machine — Spotify, Discord, Chrome, "
        "VS Code, Steam, Notepad, etc.\n\n"
        "Pass the common brand name; the executor resolves it via "
        "the Windows App Paths registry and Store-app handlers (the "
        "same lookup the Run dialog uses). Examples:\n"
        "  Spotify -> spotify\n"
        "  Discord -> discord\n"
        "  Chrome  -> chrome\n"
        "  VS Code -> code\n"
        "  Notepad -> notepad\n"
        "  Steam   -> steam\n\n"
        "Disambiguation:\n"
        "- If the user is asking for a WEBSITE or web service (e.g. "
        "  'open YouTube', 'open Gmail', 'open Twitter'), use "
        "  open_url instead — open_app is for desktop apps only.\n"
        "- If both are plausible (e.g. 'open Spotify' could mean the "
        "  desktop app or spotify.com), prefer open_app — the user "
        "  usually wants the installed app for media/audio things."
    ),
    parameters=genai.protos.Schema(
        type=genai.protos.Type.OBJECT,
        properties={
            "name": genai.protos.Schema(
                type=genai.protos.Type.STRING,
                description=(
                    "App name — usually a single word or short "
                    "phrase. Allowed characters: letters, digits, "
                    "spaces, period, hyphen, underscore."
                ),
            ),
        },
        required=["name"],
    ),
)


TOOL_DECLARATIONS = [OPEN_URL, OPEN_APP]


# Single Tool wrapper passed to GenerativeModel(tools=[...]). One
# Tool can group multiple FunctionDeclarations; we keep them all
# under one Tool entry until we have a reason to partition them.

TOOL = genai.protos.Tool(function_declarations=TOOL_DECLARATIONS)
