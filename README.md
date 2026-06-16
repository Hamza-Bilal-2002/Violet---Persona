# Persona

### Real-Time AI Avatar Framework for Human-Like Digital Agents

Persona is a modular real-time AI avatar framework built with Three.js and VRM technology.

The project focuses on creating highly interactive digital humans capable of:

* Natural speech
* Facial expressions
* Lip synchronization
* Emotion-driven responses
* Gesture animations
* State-based behavior management
* Future AI integration with local and cloud LLMs

The framework is designed as the frontend avatar engine for enterprise AI assistants, virtual receptionists, customer support agents, educators, and digital humans.

---

## Features

### VRM Avatar System

* VRM 1.0 avatar support
* Automatic avatar loading
* Optimized rendering pipeline
* Mixamo animation compatibility

### Animation System

* FBX animation loading
* Runtime animation blending
* Smooth fade transitions
* Animation cooldown system
* Automatic idle recovery
* Gesture support

Supported animations:

* Idle
* Talking
* Thinking
* Happy
* Reacting
* Waving

### Expression System

Supports native VRM blendshapes:

* Happy
* Angry
* Sad
* Relaxed
* Surprised
* Blink

Viseme support:

* AA
* EE
* IH
* OH
* OU

### Dialogue System

* Queue-based speech management
* Priority message handling
* Interrupt support
* Automatic emotion control
* Animation synchronization
* Speech synthesis integration

### Lip Sync System

* Real-time viseme generation
* Expression blending
* Speech synchronized mouth movement

### Runtime Architecture

Modular architecture for scalability and maintainability.

```
frontend/
│
├── animations/
├── models/
│
└── js/
    ├── config/
    ├── core/
    ├── loaders/
    ├── managers/
    ├── runtime/
    ├── tests/
    ├── ui/
    └── utils/
```

---

## Technology Stack

### Rendering

* Three.js
* WebGL

### Avatar Framework

* VRM
* @pixiv/three-vrm

### Animation

* FBXLoader
* Mixamo

### UI

* Lil-GUI

### Speech

* Web Speech API

---

## Project Goals

Persona is being developed as a foundation for enterprise-grade AI avatars capable of real-time conversation and visual interaction.

Planned future integrations include:

### AI Intelligence

* OpenAI
* Ollama
* Qwen
* Llama
* DeepSeek

### Speech

* Whisper
* Kokoro TTS
* ElevenLabs
* XTTS

### Real-Time Lip Sync

* MuseTalk
* Wav2Lip
* LivePortrait

### Advanced Capabilities

* Emotion detection
* Sign language interpretation
* Vision understanding
* RAG integration
* Multi-agent workflows
* Real-time streaming

---

## Installation

Clone the repository:

```bash
git clone https://github.com/Hamza-Bilal-2002/Persona.git
```

Install dependencies:

```bash
npm install
```

Run development server:

```bash
npm run dev
```

---

## Current Status

Active Development

Current focus:

* Runtime architecture stabilization
* Animation system improvements
* Expression blending
* AI integration layer

---

## Author

Hamza Bilal

AI Engineer

GitHub:
https://github.com/Hamza-Bilal-2002

---

## License

This project is licensed under the MIT License.
