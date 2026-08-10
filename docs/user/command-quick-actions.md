# Command quick actions

Command quick actions turn runnable command blocks in an agent's final reply into one-tap terminal actions. Enable them in **Settings → General** on web or desktop, or in an expanded environment row under **Settings → Environments** on mobile.

Command quick actions are unavailable when the T3 Code server runs natively on Windows. Servers running in WSL are supported because commands execute in a Linux environment.

T3 Code checks only fenced code blocks in the final assistant response. Detection is local and programmatic: it verifies shell syntax, checks that referenced executables exist, and confirms package scripts such as `bun run check` are defined before showing an action. It does not call an agent or text-generation model.

Selecting an action opens a project terminal and sends the stored command exactly as written. The action never starts another agent turn. When the command has finished, its available output is included as hidden context with the next message sent in that thread. If it is still running, the output remains queued for a later message.

On supported environments, commands run under terminal job control. If a command tries to read terminal input or change terminal settings, the inline result changes to **Input required**. Select **Open terminal** to continue the same suspended command in the thread terminal; its eventual output and exit code continue updating inline.

Validation is intentionally conservative and cannot predict external failures such as missing credentials, unavailable networks, or services that change after the action appears.
