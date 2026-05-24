"""
Tool declarations for OpenAI function calling.

Each entry in TOOL_DECLARATIONS is a "function tool" dict consumed
by openai chat.completions.create(..., tools=TOOL_DECLARATIONS).
The shape is plain JSON Schema wrapped in
{"type": "function", "function": {...}}.

Execution lives in electron/tools/ — the backend only declares
schemas, forwards tool_call payloads to the renderer over the
existing /chat/ws WebSocket, and pipes each result back to the
model in the next message.

Adding a tool:
  1. Append a function-tool dict here.
  2. Implement electron/tools/<name>.js.
  3. Register it in electron/tools/index.js.
"""

from __future__ import annotations


# ---- declarations -----------------------------------------------------------

OPEN_URL = {
    "type": "function",
    "function": {
        "name": "open_url",
        "description": (
            "Open a URL in the user's default web browser. Use this "
            "whenever the user asks to visit, pull up, launch, or go "
            "to any website, search, video, channel, or article.\n\n"
            "If the user names a site by brand or short name (e.g. "
            "'twitch', 'github', 'reddit', 'twitter', 'amazon', "
            "'gmail'), you are responsible for constructing the "
            "canonical URL yourself — do NOT ask the user for a full "
            "URL. Examples:\n"
            "  twitch  -> https://twitch.tv\n"
            "  github  -> https://github.com\n"
            "  reddit  -> https://reddit.com\n"
            "  gmail   -> https://mail.google.com\n"
            "  youtube -> https://youtube.com\n\n"
            "For 'open <site> <something>' (e.g. 'open github "
            "microsoft'), navigate to the most likely page "
            "(https://github.com/microsoft). When in doubt, prefer "
            "a working search URL on that site over asking for "
            "clarification.\n\n"
            "Only http:// and https:// URLs are accepted; other "
            "schemes (file://, javascript:, etc.) are rejected by "
            "the executor."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": (
                        "Full canonical URL starting with http:// "
                        "or https://. You construct this from the "
                        "user's request — never pass a bare brand "
                        "name."
                    ),
                },
            },
            "required": ["url"],
        },
    },
}


OPEN_APP = {
    "type": "function",
    "function": {
        "name": "open_app",
        "description": (
            "Open a desktop application on the user's PC by name. "
            "Use this when the user asks to launch, start, or open "
            "any app installed on their machine — Spotify, Discord, "
            "Chrome, VS Code, Steam, Notepad, etc.\n\n"
            "Pass the common brand name; the executor resolves it "
            "via the Windows App Paths registry and Store-app "
            "handlers (same lookup the Run dialog uses). Examples:\n"
            "  Spotify -> spotify\n"
            "  Discord -> discord\n"
            "  Chrome  -> chrome\n"
            "  VS Code -> code\n"
            "  Notepad -> notepad\n"
            "  Steam   -> steam\n\n"
            "Disambiguation:\n"
            "- If the user is asking for a WEBSITE or web service "
            "  (e.g. 'open YouTube', 'open Gmail', 'open Twitter'), "
            "  use open_url instead — open_app is for desktop apps "
            "  only.\n"
            "- If both are plausible (e.g. 'open Spotify' could "
            "  mean the desktop app or spotify.com), prefer "
            "  open_app — the user usually wants the installed app "
            "  for media/audio things."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": (
                        "App name — usually a single word or short "
                        "phrase. Allowed characters: letters, "
                        "digits, spaces, period, hyphen, underscore."
                    ),
                },
            },
            "required": ["name"],
        },
    },
}


SYSTEM_VOLUME = {
    "type": "function",
    "function": {
        "name": "system_volume",
        "description": (
            "Adjust the user's system volume. Use this for any "
            "request to make the PC louder or quieter — 'volume "
            "up', 'turn it down', 'louder', 'quieter', 'mute', "
            "'unmute', 'silence the PC', etc.\n\n"
            "Three actions:\n"
            "  up    — raise the volume\n"
            "  down  — lower the volume\n"
            "  mute  — toggle mute (calling 'mute' again unmutes)\n\n"
            "For 'up' and 'down', choose a 'steps' value based on "
            "how much change the user wants. Each step is roughly "
            "a 2% change in master volume.\n"
            "  'volume up' / 'a bit louder'        -> steps: 3\n"
            "  'volume up a lot' / 'much louder'   -> steps: 8\n"
            "  'just a tiny bit louder'            -> steps: 1\n"
            "  'maximum volume' / 'as loud as it goes' -> steps: 50\n"
            "For 'mute', steps is ignored — it's a single toggle."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "One of: 'up', 'down', 'mute'.",
                    "enum": ["up", "down", "mute"],
                },
                "steps": {
                    "type": "integer",
                    "description": (
                        "Number of 2%-volume steps to apply "
                        "(1-50). Defaults to 3 if omitted. Ignored "
                        "for 'mute'."
                    ),
                },
            },
            "required": ["action"],
        },
    },
}


LOCK_PC = {
    "type": "function",
    "function": {
        "name": "lock_pc",
        "description": (
            "Lock the user's PC. The Windows lock screen appears "
            "immediately and the user must authenticate (password "
            "/ PIN / biometric) to come back. Open apps, downloads, "
            "music, and background tasks all keep running — this "
            "only secures the screen, it doesn't sleep or shut "
            "down.\n\n"
            "Use for any of these intents:\n"
            "  'lock my pc' / 'lock the computer' / 'lock screen'\n"
            "  'i'm stepping away' / 'i'll be right back'\n"
            "  'secure the screen'\n\n"
            "Do NOT use this if the user wants to sleep, hibernate, "
            "shut down, or sign out — those are different actions."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
}


SLEEP_PC = {
    "type": "function",
    "function": {
        "name": "sleep_pc",
        "description": (
            "Put the user's PC to sleep. Screen turns off, RAM is "
            "preserved, fans and disks spin down — typical low-"
            "power suspend. The user wakes it by pressing any key, "
            "moving the mouse, or pressing the power button.\n\n"
            "Use for:\n"
            "  'sleep' / 'go to sleep' / 'put my pc to sleep'\n"
            "  'shut the screen off and idle' / 'standby'\n\n"
            "Distinct from lock_pc — lock only secures the screen "
            "and keeps everything running; sleep actually suspends "
            "the machine. If the user says 'lock and sleep' or "
            "wants both, prefer sleep_pc (sleeping already requires "
            "auth on wake).\n\n"
            "Do NOT use this for shut down, restart, or hibernate "
            "— those will get dedicated tools later if needed."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
}


TOOL_DECLARATIONS = [
    OPEN_URL,
    OPEN_APP,
    SYSTEM_VOLUME,
    LOCK_PC,
    SLEEP_PC,
]
