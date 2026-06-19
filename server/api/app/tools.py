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
            "request to make the PC louder or quieter.\n\n"
            "Four actions:\n"
            "  up    — raise the volume by a number of steps (~2% each)\n"
            "  down  — lower the volume by a number of steps\n"
            "  mute  — toggle mute on/off\n"
            "  set   — set volume to an exact percentage (0-100)\n\n"
            "Use 'set' when the user says an exact number:\n"
            "  'set volume to 50%'  -> action='set', level=50\n"
            "  'volume at 20'       -> action='set', level=20\n\n"
            "Use 'up'/'down' for relative requests:\n"
            "  'volume up'          -> steps: 3\n"
            "  'much louder'        -> steps: 8\n"
            "  'just a tiny bit'    -> steps: 1\n"
            "  'maximum volume'     -> steps: 50\n\n"
            "For 'mute', steps and level are ignored."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "One of: 'up', 'down', 'mute', 'set'.",
                    "enum": ["up", "down", "mute", "set"],
                },
                "steps": {
                    "type": "integer",
                    "description": (
                        "Number of ~2% steps for 'up'/'down' (1-50). "
                        "Defaults to 3. Ignored for 'mute' and 'set'."
                    ),
                },
                "level": {
                    "type": "integer",
                    "description": (
                        "Target volume 0-100. Required for 'set', "
                        "ignored otherwise."
                    ),
                },
            },
            "required": ["action"],
        },
    },
}


MIC_MUTE = {
    "type": "function",
    "function": {
        "name": "mic_mute",
        "description": (
            "Mute, unmute, or toggle the user's default microphone. "
            "Use this for any request about the mic input:\n"
            "  'mute my mic' / 'disable the microphone' → action='mute'\n"
            "  'unmute the mic' / 'turn mic back on'    → action='unmute'\n"
            "  'toggle the microphone'                  → action='toggle'\n"
            "  'is my mic muted?'                       → action='get'\n\n"
            "This sets the system-level mute on the default Windows "
            "capture device — the same toggle as the taskbar volume mixer. "
            "Does NOT affect Violet's own wake-word listener; use the "
            "tray 'Wake Word' checkbox for that."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "One of: 'get', 'mute', 'unmute', 'toggle'.",
                    "enum": ["get", "mute", "unmute", "toggle"],
                },
            },
            "required": ["action"],
        },
    },
}


BRIGHTNESS = {
    "type": "function",
    "function": {
        "name": "brightness",
        "description": (
            "Control the screen brightness on the user's laptop display. "
            "Use this for any request about brightness:\n"
            "  'make the screen brighter' → action='up'\n"
            "  'dim the screen' / 'lower brightness' → action='down'\n"
            "  'set brightness to 40%' → action='set', level=40\n"
            "  'what's the brightness?' → action='get'\n\n"
            "Note: only controls the built-in laptop screen. External "
            "monitors connected via HDMI/DisplayPort are not affected."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "One of: 'get', 'set', 'up', 'down'.",
                    "enum": ["get", "set", "up", "down"],
                },
                "level": {
                    "type": "integer",
                    "description": (
                        "Target brightness 0–100. Required when "
                        "action is 'set', ignored otherwise."
                    ),
                },
                "step": {
                    "type": "integer",
                    "description": (
                        "Percentage points to add/subtract for 'up'/'down'. "
                        "Defaults to 10 if omitted. Clamped to 1–50."
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


SPOTIFY_PLAY = {
    "type": "function",
    "function": {
        "name": "spotify_play",
        "description": (
            "Search Spotify and immediately start playing the result. "
            "Use this whenever the user wants to play music:\n"
            "  'play Blinding Lights' → query='Blinding Lights', type='track'\n"
            "  'put on The Weeknd' → query='The Weeknd', type='artist'\n"
            "  'play the Inception soundtrack' → query='Inception', type='album'\n"
            "  'play a lo-fi playlist' → query='lo-fi', type='playlist'\n\n"
            "IMPORTANT: Spotify must be open on a device (PC, phone, etc.) "
            "for playback to work. If it isn't open, use open_app('spotify') "
            "first, wait a moment, then call spotify_play.\n\n"
            "Do NOT combine with media_control — spotify_play starts "
            "playback directly. Do NOT use for pausing, skipping, or "
            "volume — use spotify_control for those."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "What to search for — song name, artist, "
                        "album title, or playlist description. "
                        "Use the user's exact words."
                    ),
                },
                "type": {
                    "type": "string",
                    "description": (
                        "What kind of result to look for. "
                        "Defaults to 'track' if omitted."
                    ),
                    "enum": ["track", "artist", "album", "playlist"],
                },
            },
            "required": ["query"],
        },
    },
}


SPOTIFY_CONTROL = {
    "type": "function",
    "function": {
        "name": "spotify_control",
        "description": (
            "Control Spotify playback. Use this for pause, resume, "
            "skip, previous track, volume changes, or to find out "
            "what's currently playing.\n\n"
            "Actions:\n"
            "  pause        — pause whatever is playing\n"
            "  resume       — resume / unpause\n"
            "  next         — skip to the next track\n"
            "  previous     — go back to the previous track\n"
            "  volume       — set Spotify volume to an exact % "
                             "(requires volume_percent)\n"
            "  current_track — get the currently playing track info\n\n"
            "Use spotify_play (not resume) when the user wants to play "
            "something specific. Use resume only when they say "
            "'resume', 'unpause', or 'continue'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "pause",
                        "resume",
                        "next",
                        "previous",
                        "volume",
                        "current_track",
                    ],
                },
                "volume_percent": {
                    "type": "integer",
                    "description": (
                        "Target volume 0–100. Required when "
                        "action is 'volume', ignored otherwise."
                    ),
                },
            },
            "required": ["action"],
        },
    },
}


MEDIA_CONTROL = {
    "type": "function",
    "function": {
        "name": "media_control",
        "description": (
            "Send a media control keystroke to whatever media app "
            "is currently playing or has focus — Spotify, browser, "
            "YouTube, VLC, Windows Media Player, etc. Uses the "
            "system media keys, so the active media player decides "
            "how to respond.\n\n"
            "Four actions:\n"
            "  play_pause — toggles playback (play if paused, pause "
            "               if playing). Map 'play', 'pause', "
            "               'resume', 'stop the music', 'continue' "
            "               all to this.\n"
            "  next       — skip to the next track\n"
            "  previous   — go back to the previous track\n"
            "  stop       — stop playback entirely\n\n"
            "Tip: directly after spotify_search, call this with "
            "action='play_pause' to actually start the top result."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": (
                        "One of: 'play_pause', 'next', "
                        "'previous', 'stop'."
                    ),
                    "enum": [
                        "play_pause",
                        "next",
                        "previous",
                        "stop",
                    ],
                },
            },
            "required": ["action"],
        },
    },
}


SEND_WHATSAPP = {
    "type": "function",
    "function": {
        "name": "send_whatsapp",
        "description": (
            "Send a WhatsApp message to a contact by name or phone number. "
            "Use this whenever the user asks to send, text, or message someone "
            "on WhatsApp.\n\n"
            "Examples:\n"
            "  'send a WhatsApp to Mom saying I'll be late'\n"
            "    → to='Mom', message=\"I'll be late\"\n"
            "  'text Ahmed on WhatsApp: coming in 10 minutes'\n"
            "    → to='Ahmed', message='Coming in 10 minutes'\n"
            "  'message +92 300 1234567 I'm on my way'\n"
            "    → to='+923001234567', message=\"I'm on my way\"\n\n"
            "The executor will ask the user to confirm before sending. "
            "Always extract the message content verbatim from what the user said."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "to": {
                    "type": "string",
                    "description": (
                        "Contact name (e.g. 'Mom', 'Ahmed') or phone number "
                        "in international format (e.g. '+923001234567'). "
                        "Use the name exactly as the user said it."
                    ),
                },
                "message": {
                    "type": "string",
                    "description": "The message text to send. Extracted verbatim from user input.",
                },
            },
            "required": ["to", "message"],
        },
    },
}


# ---- memory tools (executed server-side, not on the user's PC) --------------
#
# Unlike every tool above (which the backend forwards to the renderer),
# these run inside the api against the long-term memory store. main.py
# dispatches any tool whose name is in SERVER_SIDE_TOOLS locally and
# never sends it to the client. Memory belongs to the assistant's brain,
# so when the dialogue model moves local, memory stays local with it.

REMEMBER = {
    "type": "function",
    "function": {
        "name": "remember",
        "description": (
            "Save a durable fact to long-term memory so you recall it in "
            "future conversations. Use this when the user explicitly asks "
            "you to remember something, or states a lasting fact about "
            "themselves, their preferences, people in their life, or "
            "ongoing projects.\n\n"
            "Do NOT use this for transient/command requests (volume, "
            "opening apps, one-off messages) or small talk — only durable "
            "facts worth recalling weeks later.\n\n"
            "Examples:\n"
            "  'remember I'm allergic to peanuts' → content='Allergic to "
            "peanuts', type='user'\n"
            "  'my sister's name is Sara' → content=\"Sister's name is "
            "Sara\", type='reference'\n"
            "  'always keep replies short' → content='Wants replies kept "
            "short', type='feedback'"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": (
                        "The fact to store, phrased as a concise standalone "
                        "statement (not 'remember that...', just the fact)."
                    ),
                },
                "type": {
                    "type": "string",
                    "description": (
                        "Category: 'user' (who they are/preferences), "
                        "'feedback' (how you should behave), 'project' "
                        "(ongoing work/goals), 'reference' (people, accounts, "
                        "external things)."
                    ),
                    "enum": ["user", "feedback", "project", "reference"],
                },
            },
            "required": ["content"],
        },
    },
}


FORGET = {
    "type": "function",
    "function": {
        "name": "forget",
        "description": (
            "Remove a fact from long-term memory. Use this when the user "
            "asks you to forget something specific. Describe what to forget "
            "in natural language; the best-matching memory is removed. For "
            "wiping ALL memory, tell the user to use the tray menu's "
            "'Reset memory' — this tool only removes a single best match."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "Description of the memory to forget, e.g. 'that I "
                        "like peanuts' or 'my old address'."
                    ),
                },
            },
            "required": ["query"],
        },
    },
}


RECALL = {
    "type": "function",
    "function": {
        "name": "recall",
        "description": (
            "Look up what you already know about a topic from long-term "
            "memory. Use this when the user asks 'what do you know about "
            "me', 'what do you remember about X', or when you need stored "
            "context you don't already have in view. Returns matching "
            "facts; weave them into your reply naturally."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "What to look up, e.g. 'my food preferences' or "
                        "'everything about me'."
                    ),
                },
            },
            "required": ["query"],
        },
    },
}


# Tools the api executes itself instead of forwarding to the renderer.
SERVER_SIDE_TOOLS = {"remember", "forget", "recall"}


TOOL_DECLARATIONS = [
    OPEN_URL,
    OPEN_APP,
    SYSTEM_VOLUME,
    BRIGHTNESS,
    MIC_MUTE,
    LOCK_PC,
    SLEEP_PC,
    SPOTIFY_PLAY,
    SPOTIFY_CONTROL,
    MEDIA_CONTROL,
    SEND_WHATSAPP,
    REMEMBER,
    FORGET,
    RECALL,
]
