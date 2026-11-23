import type { AgentCommand } from "@kushex/contracts";
import { useEffect, useState, type KeyboardEvent } from "react";

/**
 * The commands to offer for the composer text: only while the message is a bare command token
 * (`/`, `/res`), so a `/` later in a sentence or in a URL opens nothing. Prefix matches come first;
 * from two typed letters on, commands whose name or description contains them follow.
 */
export function matchSlashCommands(text: string, commands: readonly AgentCommand[]): AgentCommand[] {
  if (!/^\/[a-z0-9-]*$/i.test(text)) return [];
  const query = text.slice(1).toLowerCase();
  const prefix = commands.filter((command) => command.name.slice(1).startsWith(query));
  const other = commands.filter(
    (command) =>
      !prefix.includes(command) &&
      query.length >= 2 &&
      (command.name.includes(query) || command.description.toLowerCase().includes(query)),
  );
  return [...prefix, ...other];
}

/** Menu state for the composer: which commands show, which is highlighted, and the keys that drive it. */
export function useSlashCommands(
  text: string,
  commands: readonly AgentCommand[] | undefined,
  choose: (text: string) => void,
) {
  const [active, setActive] = useState(0);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const matches = matchSlashCommands(text, commands ?? []);
  const open = matches.length > 0 && dismissedFor !== text;

  useEffect(() => setActive(0), [text]);

  const select = (command: AgentCommand) => {
    choose(`${command.name} `);
    setDismissedFor(null);
  };

  /** Returns true when the key was for the menu, so the composer must not also handle it (e.g. send). */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (!open) return false;
    switch (event.key) {
      case "ArrowDown":
        setActive((index) => (index + 1) % matches.length);
        break;
      case "ArrowUp":
        setActive((index) => (index - 1 + matches.length) % matches.length);
        break;
      case "Enter":
      case "Tab": {
        if (event.nativeEvent.isComposing || event.shiftKey) return false;
        const command = matches[Math.min(active, matches.length - 1)];
        if (command) select(command);
        break;
      }
      case "Escape":
        setDismissedFor(text);
        break;
      default:
        return false;
    }
    event.preventDefault();
    return true;
  };

  return { open, matches, active: Math.min(active, matches.length - 1), setActive, select, onKeyDown };
}

export const SLASH_MENU_ID = "kx-slash-commands";

/** The list above the message box. Mouse down (not click) keeps focus in the message box. */
export function SlashCommandMenu({
  matches,
  active,
  onHover,
  onSelect,
}: Readonly<{
  matches: readonly AgentCommand[];
  active: number;
  onHover: (index: number) => void;
  onSelect: (command: AgentCommand) => void;
}>) {
  return (
    <ul
      id={SLASH_MENU_ID}
      role="listbox"
      aria-label="Commands"
      className="kx:m-0 kx:list-none kx:max-h-60 kx:overflow-auto kx:px-1.5 kx:pt-1.5 kx:pb-0.5"
    >
      {matches.map((command, index) => (
        <li
          key={command.name}
          id={`${SLASH_MENU_ID}-${index}`}
          role="option"
          aria-selected={index === active}
          className={`kx:flex kx:cursor-pointer kx:items-baseline kx:gap-2 kx:rounded-lg kx:px-2 kx:py-1.5 kx:text-sm ${
            index === active ? "kx:bg-primary/10" : ""
          }`}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(command);
          }}
        >
          <span className="kx:shrink-0 kx:font-medium kx:text-primary">{command.name}</span>
          {command.argument && <span className="kx:shrink-0 kx:text-xs kx:text-text-muted">{command.argument}</span>}
          <span className="kx:min-w-0 kx:truncate kx:text-xs kx:text-text-muted">{command.description}</span>
        </li>
      ))}
    </ul>
  );
}
