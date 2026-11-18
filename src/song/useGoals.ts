import { useSyncExternalStore } from "react";
import { getGoals, subscribeGoals } from "./goals";

export function useGoals() {
  return useSyncExternalStore(subscribeGoals, getGoals, getGoals);
}
