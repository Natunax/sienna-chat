# Security

Sienna handles an API key that can spend money, so security reports are welcome.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue for a vulnerability.

Include what you found, how to reproduce it, and what an attacker could do with it. You will get an answer within a week.

## Scope

In scope, for example:

- the API key leaving the macOS Keychain other than to the chat engine process
- requests billed to anything other than the configured API key
- script execution or navigation in the app window through a model answer
- reading files outside the app's data folder and the chat's project folder
- the microphone staying on after dictation ends, audio leaving the Mac, or dictated text being sent without the user pressing send
- a file change or command running without approval in a mode that should ask, a risky command (see README) running without asking, or a change landing outside the project folder
- a web page in the side panel's browser reaching any of Sienna's commands, plugins, artifacts, files, the microphone or the camera
- a helper (subagent) making a change or running a command that would have asked, or been refused, had Claude made it

Out of scope: what the Claude models answer, and bugs in the Claude Agent SDK or Tauri themselves (report those upstream).
