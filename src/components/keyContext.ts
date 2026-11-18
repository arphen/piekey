import { createContext, useContext } from "react";
import type { KeyInfo } from "../core/contract";

export const KeyContext = createContext<KeyInfo | null>(null);

export function useKey(): KeyInfo {
  const key = useContext(KeyContext);
  if (!key) throw new Error("KeyContext missing");
  return key;
}

/** Show Roman numerals (relative to the key) above every chord symbol. */
export const RomanContext = createContext(false);
